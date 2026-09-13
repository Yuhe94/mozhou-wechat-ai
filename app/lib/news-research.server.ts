import type { Brief, OutlineItem, ResearchSource } from "./product-types";

export type NewsRegion = "auto" | "cn" | "hk" | "tw" | "all";
export type NewsSearchProvider = "auto" | "brave" | "public";

export type ResearchSeed = {
  source: ResearchSource;
  text?: string;
};

export type ResearchDiscovery = {
  seeds: ResearchSeed[];
  region: NewsRegion;
  channels: string[];
  warnings: string[];
};

type ResearchPreferences = {
  provider: NewsSearchProvider;
  region: NewsRegion;
  braveApiKey: string;
};

type NewsEnvironment = {
  BRAVE_SEARCH_API_KEY?: string;
};

type RegionalArticle = {
  title: string;
  url: string;
  publishedAt?: string;
  text?: string;
  region: "cn" | "hk" | "tw";
  retrieval: "fulltext" | "snippet";
};

const FETCH_TIMEOUT_MS = 12_000;
const MAX_DISCOVERY_RESULTS = 10;
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const BRAVE_URL = "https://api.search.brave.com/res/v1/news/search";
const CHINA_GOV_NEWS_URL = "https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json";
const HONG_KONG_FEEDS = [
  "https://www.info.gov.hk/gia/rss/general_zh.xml",
  "https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml",
  "https://rthk.hk/rthk/news/rss/c_expressnews_greaterchina.xml",
  "https://rthk.hk/rthk/news/rss/c_expressnews_cfinance.xml",
];
const TAIWAN_EXECUTIVE_YUAN_URL = "https://www.ey.gov.tw/NewOpenData/JSON/154";

const STOP_FRAGMENTS = new Set([
  "中国", "中國", "目前", "关于", "關於", "相关", "相關", "新闻", "新聞", "事件", "影响", "影響",
  "如何", "怎么", "怎麼", "什么", "什麼", "最新", "一个", "一個", "将于", "將於", "进行", "進行",
]);

function limitedHeader(headers: Headers, name: string, maximum: number) {
  return (headers.get(name) ?? "").trim().slice(0, maximum);
}

export function researchPreferences(headers: Headers, environment: NewsEnvironment): ResearchPreferences {
  const rawProvider = limitedHeader(headers, "x-mozhou-news-search-provider", 20);
  const rawRegion = limitedHeader(headers, "x-mozhou-news-region", 12);
  const provider: NewsSearchProvider = ["auto", "brave", "public"].includes(rawProvider)
    ? rawProvider as NewsSearchProvider
    : "auto";
  const region: NewsRegion = ["auto", "cn", "hk", "tw", "all"].includes(rawRegion)
    ? rawRegion as NewsRegion
    : "auto";
  return {
    provider,
    region,
    braveApiKey: limitedHeader(headers, "x-mozhou-news-search-api-key", 1000) || environment.BRAVE_SEARCH_API_KEY || "",
  };
}

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanText(value: string) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchText(url: string, accept: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept, "user-agent": "MozhouResearchAssistant/1.2" },
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} 返回 ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function queryFragments(queries: string[]) {
  const fragments = new Set<string>();
  for (const query of queries) {
    const normalized = query.toLowerCase().replace(/[“”"'()（）【】《》：:，,。.!！？?]/g, " ");
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      if (/^[a-z0-9-]{3,}$/i.test(token)) fragments.add(token);
      const chineseRuns = token.match(/[\u3400-\u9fff]{2,}/g) ?? [];
      for (const run of chineseRuns) {
        if (run.length <= 6 && !STOP_FRAGMENTS.has(run)) fragments.add(run);
        for (let size = 2; size <= Math.min(4, run.length); size += 1) {
          for (let index = 0; index <= run.length - size; index += 1) {
            const fragment = run.slice(index, index + size);
            if (!STOP_FRAGMENTS.has(fragment)) fragments.add(fragment);
          }
        }
      }
    }
  }
  return [...fragments].sort((left, right) => right.length - left.length).slice(0, 36);
}

function relevanceScore(article: RegionalArticle, fragments: string[]) {
  const haystack = `${article.title}\n${article.text ?? ""}`.toLowerCase();
  return fragments.reduce((score, fragment) => score + (haystack.includes(fragment) ? Math.min(fragment.length, 5) : 0), 0);
}

function rankRegionalArticles(articles: RegionalArticle[], queries: string[], limit = 3) {
  const fragments = queryFragments(queries);
  if (!fragments.length) return [];
  return articles
    .map((article) => ({ article, score: relevanceScore(article, fragments) }))
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.article)
    .filter((article, index, all) => all.findIndex((candidate) => candidate.url === article.url) === index)
    .slice(0, limit);
}

function rssTag(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return cleanText(match?.[1] ?? "");
}

function parseRss(xml: string, region: "hk"): RegionalArticle[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const item = match[1];
    const title = rssTag(item, "title");
    const url = rssTag(item, "link") || rssTag(item, "guid");
    if (!title || !/^https?:\/\//i.test(url)) return [];
    return [{
      title,
      url,
      publishedAt: rssTag(item, "pubDate") || undefined,
      text: rssTag(item, "description").slice(0, 2400),
      region,
      retrieval: url.includes("info.gov.hk") ? "fulltext" as const : "snippet" as const,
    }];
  });
}

async function chinaOfficialArticles(): Promise<RegionalArticle[]> {
  const payload = JSON.parse(await fetchText(CHINA_GOV_NEWS_URL, "application/json")) as Array<Record<string, unknown>>;
  return payload.flatMap((item) => {
    const title = typeof item.TITLE === "string" ? cleanText(item.TITLE) : "";
    const url = typeof item.URL === "string" ? item.URL : "";
    if (!title || !/^https?:\/\//i.test(url)) return [];
    return [{
      title,
      url,
      publishedAt: typeof item.DOCRELPUBTIME === "string" ? item.DOCRELPUBTIME : undefined,
      region: "cn" as const,
      retrieval: "fulltext" as const,
    }];
  });
}

async function hongKongOfficialArticles(): Promise<RegionalArticle[]> {
  const results = await Promise.allSettled(HONG_KONG_FEEDS.map((url) => fetchText(url, "application/rss+xml,application/xml,text/xml")));
  return results.flatMap((result) => result.status === "fulfilled" ? parseRss(result.value, "hk") : []);
}

async function taiwanOfficialArticles(): Promise<RegionalArticle[]> {
  const payload = JSON.parse(await fetchText(TAIWAN_EXECUTIVE_YUAN_URL, "application/json")) as Array<Record<string, unknown>>;
  return payload.flatMap((item) => {
    const title = typeof item["標題"] === "string" ? cleanText(String(item["標題"])) : "";
    const text = typeof item["內容"] === "string" ? cleanText(String(item["內容"])) : "";
    if (!title || !text) return [];
    return [{
      title,
      url: TAIWAN_EXECUTIVE_YUAN_URL,
      publishedAt: typeof item["上版日期"] === "string" ? String(item["上版日期"]) : undefined,
      text: text.slice(0, 3500),
      region: "tw" as const,
      retrieval: "fulltext" as const,
    }];
  });
}

function inferredRegions(topic: string, preference: NewsRegion): Array<"cn" | "hk" | "tw"> {
  if (preference === "all") return ["cn", "hk", "tw"];
  if (preference !== "auto") return [preference];
  const regions = new Set<"cn" | "hk" | "tw">();
  if (/香港|港府|港股|港币|港幣|港交所|金管局|中环|中環|港人|立法会|立法會|李家超|特区政府|特區政府/.test(topic)) regions.add("hk");
  if (/台湾|台灣|台北|臺北|新北|高雄|台中|臺中|台南|臺南|台积电|台積電|立法院|行政院|民进党|民進黨|国民党|國民黨|赖清德|賴清德|两岸|兩岸/.test(topic)) regions.add("tw");
  if (!regions.size || /大陆|大陸|内地|中國|中国|国务院|國務院/.test(topic)) regions.add("cn");
  return [...regions];
}

async function regionalSeeds(regions: Array<"cn" | "hk" | "tw">, queries: string[]) {
  const loaders = regions.map(async (region) => {
    const articles = region === "cn"
      ? await chinaOfficialArticles()
      : region === "hk"
        ? await hongKongOfficialArticles()
        : await taiwanOfficialArticles();
    return rankRegionalArticles(articles, queries, region === "hk" ? 3 : 2);
  });
  const results = await Promise.allSettled(loaders);
  const unavailableRegions = results.flatMap((result, index) => result.status === "rejected" ? [regions[index]] : []);
  const articles = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return {
    seeds: articles.map((article) => ({
      source: {
        title: article.title,
        url: article.url,
        domain: new URL(article.url).hostname,
        publishedAt: article.publishedAt,
        query: queries.slice(0, 3).join(" ｜ "),
        channel: "official" as const,
        region: article.region,
        retrieval: article.retrieval,
      },
      text: article.text,
    })),
    unavailableRegions,
  };
}

function sourceRegionFromCountry(country: string | undefined): ResearchSource["region"] {
  const normalized = (country ?? "").toLowerCase();
  if (["cn", "china"].includes(normalized)) return "cn";
  if (["hk", "hong kong"].includes(normalized)) return "hk";
  if (["tw", "taiwan"].includes(normalized)) return "tw";
  return "global";
}

async function braveSeeds(query: string, preferences: ResearchPreferences, regions: Array<"cn" | "hk" | "tw">) {
  const targets = preferences.region === "all"
    ? [{ country: "ALL", language: "zh-hans" }, { country: "ALL", language: "zh-hant" }]
    : regions.map((region) => ({
        country: region.toUpperCase(),
        language: region === "cn" ? "zh-hans" : "zh-hant",
      }));
  const responses = await Promise.all(targets.map(async (target) => {
    const url = new URL(BRAVE_URL);
    url.searchParams.set("q", query.slice(0, 380));
    url.searchParams.set("count", "10");
    url.searchParams.set("freshness", "pm");
    url.searchParams.set("country", target.country);
    url.searchParams.set("search_lang", target.language);
    url.searchParams.set("safesearch", "moderate");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "x-subscription-token": preferences.braveApiKey,
        },
      });
      if (!response.ok) throw new Error(`Brave News 返回 ${response.status}`);
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      return { payload, target };
    } finally {
      clearTimeout(timeout);
    }
  }));
  return responses.flatMap(({ payload, target }) => (Array.isArray(payload.results) ? payload.results : []).flatMap((item) => {
    const title = typeof item.title === "string" ? cleanText(item.title) : "";
    const urlValue = typeof item.url === "string" ? item.url : "";
    let url: URL;
    try { url = new URL(urlValue); } catch { return []; }
    if (!title || !["http:", "https:"].includes(url.protocol)) return [];
    const description = typeof item.description === "string" ? cleanText(item.description) : "";
    return [{
      source: {
        title,
        url: url.toString(),
        domain: url.hostname,
        publishedAt: typeof item.page_age === "string" ? item.page_age : undefined,
        query,
        channel: "brave" as const,
        region: sourceRegionFromCountry(typeof item.country === "string" ? item.country : target.country),
        retrieval: "snippet" as const,
      },
      text: description.length >= 80 ? description.slice(0, 1200) : undefined,
    }];
  }));
}

async function gdeltSeeds(queries: string[]) {
  const englishQueries = queries.filter((query) => /[a-z]{3}/i.test(query));
  if (!englishQueries.length) throw new Error("GDELT 需要英文检索词");
  const combined = englishQueries
    .slice(0, 3)
    .map((query) => `(${query.replace(/[()"']/g, " ").replace(/\s+/g, " ").trim()})`)
    .join(" OR ")
    .slice(0, 180);
  const url = new URL(GDELT_URL);
  url.searchParams.set("query", combined);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "10");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "hybridrel");
  url.searchParams.set("timespan", "3months");
  const payload = JSON.parse(await fetchText(url.toString(), "application/json")) as { articles?: Array<Record<string, unknown>> };
  return (Array.isArray(payload.articles) ? payload.articles : []).flatMap((item) => {
    const title = typeof item.title === "string" ? cleanText(item.title) : "";
    const urlValue = typeof item.url === "string" ? item.url : "";
    let articleUrl: URL;
    try { articleUrl = new URL(urlValue); } catch { return []; }
    if (!title || !["http:", "https:"].includes(articleUrl.protocol)) return [];
    return [{
      source: {
        title,
        url: articleUrl.toString(),
        domain: typeof item.domain === "string" ? item.domain : articleUrl.hostname,
        publishedAt: typeof item.seendate === "string" ? item.seendate : undefined,
        query: englishQueries.join(" ｜ "),
        channel: "gdelt" as const,
        region: sourceRegionFromCountry(typeof item.sourcecountry === "string" ? item.sourcecountry : undefined),
        retrieval: "snippet" as const,
      },
    }];
  });
}

export async function discoverResearchSources(
  brief: Brief,
  outline: OutlineItem[],
  preferences: ResearchPreferences,
): Promise<ResearchDiscovery> {
  const queries = [...new Set([
    ...outline.flatMap((item) => item.searchQueries ?? []),
    brief.topic,
  ].map((query) => query.trim()).filter(Boolean))].slice(0, 6);
  const regions = inferredRegions([brief.topic, ...queries].join(" "), preferences.region);
  const warnings: string[] = [];
  const regionLabels = { cn: "大陆", hk: "香港", tw: "台湾" } as const;
  const officialPromise = regionalSeeds(regions, queries).then((result) => {
    if (result.unavailableRegions.length) {
      warnings.push(`${result.unavailableRegions.map((region) => regionLabels[region]).join("、")}官方源暂时不可用`);
    }
    return result.seeds;
  }).catch(() => {
    warnings.push("区域官方源暂时不可用");
    return [] as ResearchSeed[];
  });

  let searchPromise: Promise<ResearchSeed[]>;
  const useBrave = preferences.provider !== "public" && Boolean(preferences.braveApiKey);
  if (useBrave) {
    searchPromise = braveSeeds(brief.topic, preferences, regions).catch(async (error) => {
      warnings.push(error instanceof Error ? `${error.message}，已改用 GDELT 补充` : "Brave News 暂不可用，已改用 GDELT 补充");
      return gdeltSeeds(queries).catch(() => []);
    });
  } else {
    if (preferences.provider === "brave") warnings.push("尚未配置 Brave Search API Key");
    searchPromise = gdeltSeeds(queries).catch((error) => {
      warnings.push(error instanceof Error ? error.message : "GDELT 暂不可用");
      return [] as ResearchSeed[];
    });
  }

  const [official, searched] = await Promise.all([officialPromise, searchPromise]);
  const seen = new Set<string>();
  const seeds = [...official, ...searched]
    .filter((seed) => !seen.has(seed.source.url) && Boolean(seen.add(seed.source.url)))
    .slice(0, MAX_DISCOVERY_RESULTS);
  const channelLabels: Record<NonNullable<ResearchSource["channel"]>, string> = {
    user: "用户资料",
    official: "地区官方源",
    brave: "Brave News",
    gdelt: "GDELT 国际索引",
  };
  const channels = [...new Set(seeds.map((seed) => seed.source.channel).filter(Boolean).map((channel) => channelLabels[channel!]))];
  return { seeds, region: preferences.region, channels, warnings };
}
