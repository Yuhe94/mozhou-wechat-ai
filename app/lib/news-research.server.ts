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
const TOUTIAO_SEARCH_URL = "https://so.toutiao.com/search";
const WECHAT_SEARCH_URL = "https://weixin.sogou.com/weixin";

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
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&hellip;/gi, "…")
    .replace(/&middot;/gi, "·");
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

async function fetchPlatformText(url: string, referer: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        referer,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
      },
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
      for (const latinRun of token.match(/[a-z0-9-]{2,}/gi) ?? []) fragments.add(latinRun);
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

function hotspotOrigin(brief: Brief) {
  const match = brief.sourcesText.match(/热点来源：\s*([^｜\n]+)｜(https?:\/\/[^\s]+)/);
  return match ? { source: match[1].trim(), url: match[2].trim() } : null;
}

function resolvedToutiaoArticleUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "article.zlink.toutiao.com") {
      const target = url.searchParams.get("h5_url");
      if (target && /^https?:\/\//i.test(target)) return new URL(target).toString();
    }
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function parseToutiaoSearchResults(html: string, topic: string): ResearchSeed[] {
  const articles = [...html.matchAll(/\bcr-params=(['"])([\s\S]*?)\1/gi)].flatMap((match) => {
    try {
      const record = JSON.parse(decodeEntities(match[2])) as Record<string, unknown>;
      const title = typeof record.title === "string" ? cleanText(record.title) : "";
      const rawUrl = typeof record.url === "string" ? record.url : "";
      const url = resolvedToutiaoArticleUrl(rawUrl);
      if (!title || !url || /\/search(?:\?|$)/.test(url)) return [];
      return [{ title, url, region: "cn" as const, retrieval: "snippet" as const }];
    } catch {
      return [];
    }
  });
  return rankRegionalArticles(articles, [topic], 6).map((article) => ({
    source: {
      title: article.title,
      url: article.url,
      domain: new URL(article.url).hostname,
      query: `今日头条站内：${topic}`,
      channel: "platform" as const,
      region: "cn" as const,
      retrieval: "snippet" as const,
    },
  }));
}

export function parseWechatSearchResults(html: string, topic: string): ResearchSeed[] {
  const articles = [...html.matchAll(/<li[^>]+id=["']sogou_vr_11002601_box_[^"']+["'][^>]*>([\s\S]*?)<\/li>/gi)].flatMap((match) => {
    const card = match[1];
    const titleMatch = card.match(/<h3>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
    const title = cleanText(titleMatch?.[2] ?? "");
    const summary = cleanText(card.match(/<p[^>]+class=["'][^"']*txt-info[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const account = cleanText(card.match(/<span[^>]+class=["'][^"']*all-time-y2[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const href = decodeEntities(titleMatch?.[1] ?? "");
    if (!title || !href || summary.length < 40) return [];
    let url: string;
    try { url = new URL(href, "https://weixin.sogou.com").toString(); } catch { return []; }
    return [{
      title: account ? `${title}｜${account}` : title,
      url,
      text: summary,
      region: "cn" as const,
      retrieval: "snippet" as const,
    }];
  });
  return rankRegionalArticles(articles, [topic], 4).map((article) => ({
    source: {
      title: article.title,
      url: article.url,
      domain: "weixin.sogou.com",
      query: `微信公众号公开文章：${topic}`,
      channel: "wechat" as const,
      region: "cn" as const,
      retrieval: "snippet" as const,
    },
    text: article.text,
  }));
}

async function wechatSeeds(topic: string) {
  const url = new URL(WECHAT_SEARCH_URL);
  url.searchParams.set("type", "2");
  url.searchParams.set("query", topic.slice(0, 120));
  const html = await fetchPlatformText(url.toString(), "https://weixin.sogou.com/");
  if (/antispider|请输入验证码|用户您好，您的访问过于频繁/i.test(html)) throw new Error("公众号文章检索触发访客验证");
  return parseWechatSearchResults(html, topic);
}

function parseWeiboSearchResults(html: string, topic: string): ResearchSeed[] {
  const articles = [...html.matchAll(/<a[^>]+href=["']((?:https?:)?\/\/weibo\.com\/\d+\/[a-z0-9]+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap((match) => {
    const title = cleanText(match[2]);
    const url = match[1].startsWith("//") ? `https:${match[1]}` : match[1];
    if (title.length < 4) return [];
    return [{ title, url, region: "cn" as const, retrieval: "snippet" as const }];
  });
  return rankRegionalArticles(articles, [topic], 4).map((article) => ({
    source: {
      title: article.title,
      url: article.url,
      domain: "weibo.com",
      query: `微博站内：${topic}`,
      channel: "platform" as const,
      region: "cn" as const,
      retrieval: "snippet" as const,
    },
  }));
}

async function toutiaoPlatformSeeds(topic: string) {
  const url = new URL(TOUTIAO_SEARCH_URL);
  url.searchParams.set("keyword", topic.slice(0, 120));
  const html = await fetchPlatformText(url.toString(), "https://www.toutiao.com/");
  return parseToutiaoSearchResults(html, topic);
}

async function platformSeeds(brief: Brief) {
  if (brief.creationMode !== "hotspot") return { seeds: [] as ResearchSeed[], warnings: [] as string[] };
  const origin = hotspotOrigin(brief);
  const warnings: string[] = [];
  if (!origin) {
    warnings.push("未记录热搜来源平台，已按热点标题补充检索");
    return { seeds: await toutiaoPlatformSeeds(brief.topic).catch(() => []), warnings };
  }
  if (/今日头条|头条/.test(origin.source) || /toutiao\.com/i.test(origin.url)) {
    const seeds = await toutiaoPlatformSeeds(brief.topic).catch(() => []);
    if (!seeds.length) warnings.push("今日头条站内未返回可读取的相关文章");
    return { seeds, warnings };
  }
  if (/微博/.test(origin.source) || /weibo\.com/i.test(origin.url)) {
    let seeds: ResearchSeed[] = [];
    try {
      const html = await fetchPlatformText(origin.url, "https://s.weibo.com/");
      if (/Sina Visitor System|passport\.weibo\.com|visitor/i.test(html)) {
        warnings.push("微博讨论页要求访客验证，服务端无法直接读取讨论正文");
      } else {
        seeds = parseWeiboSearchResults(html, brief.topic);
      }
    } catch {
      warnings.push("微博讨论页暂时无法读取");
    }
    if (seeds.length < 2) {
      const supplement = await toutiaoPlatformSeeds(brief.topic).catch(() => []);
      if (supplement.length) warnings.push("已用今日头条站内相关文章补充微博词条材料");
      seeds = [...seeds, ...supplement];
    }
    return { seeds, warnings };
  }
  const seeds = await toutiaoPlatformSeeds(brief.topic).catch(() => []);
  if (seeds.length) warnings.push(`暂不支持直接解析“${origin.source}”，已用今日头条站内相关文章补充`);
  return { seeds, warnings };
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
  const platformPromise = platformSeeds(brief).then((result) => {
    warnings.push(...result.warnings);
    return result.seeds;
  }).catch(() => {
    warnings.push("热搜来源平台暂时无法读取");
    return [] as ResearchSeed[];
  });
  const wechatPromise = wechatSeeds(brief.topic).then((seeds) => {
    if (seeds.length) warnings.push("公众号搜索结果当前提供公开摘要；能读取正文的文章才会计入成稿门禁");
    return seeds;
  }).catch((error) => {
    warnings.push(error instanceof Error ? error.message : "公众号文章检索暂时不可用");
    return [] as ResearchSeed[];
  });
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

  const [platform, wechat, official, searched] = await Promise.all([platformPromise, wechatPromise, officialPromise, searchPromise]);
  const seen = new Set<string>();
  const seeds = [...platform, ...wechat, ...official, ...searched]
    .filter((seed) => !seen.has(seed.source.url) && Boolean(seen.add(seed.source.url)))
    .slice(0, MAX_DISCOVERY_RESULTS);
  const channelLabels: Record<NonNullable<ResearchSource["channel"]>, string> = {
    user: "用户资料",
    platform: "热搜平台相关文章",
    wechat: "公众号文章",
    official: "地区官方源",
    brave: "Brave News",
    gdelt: "GDELT 国际索引",
  };
  const channels = [...new Set(seeds.map((seed) => seed.source.channel).filter(Boolean).map((channel) => channelLabels[channel!]))];
  return { seeds, region: preferences.region, channels, warnings };
}
