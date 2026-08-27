import type { Hotspot } from "../../lib/product-types";

const WEIBO_API_URL = "https://weibo.com/ajax/side/hotSearch";
const WEIBO_PAGE_URL = "https://s.weibo.com/top/summary?cate=realtimehot";
const TOUTIAO_HOT_URL = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc";

function cleanText(value: string) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatHeat(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)} 万热度`;
  return `${Math.round(number)} 热度`;
}

function absoluteUrl(value: string, origin: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${origin}${value}`;
  return "";
}

function parseWeiboJson(payload: unknown): Hotspot[] {
  const root = payload as { data?: { realtime?: Array<Record<string, unknown>> } };
  const rows = root?.data?.realtime;
  if (!Array.isArray(rows)) return [];

  const seen = new Set<string>();
  return rows
    .map((row) => {
      const title = cleanText(String(row.word ?? row.note ?? ""));
      const scheme = typeof row.scheme === "string" ? row.scheme : "";
      const label = cleanText(String(row.label_name ?? row.icon_desc ?? ""));
      return {
        title,
        summary: label && label !== title ? label : "微博用户正在讨论的实时话题",
        heat: formatHeat(row.raw_hot ?? row.num),
        url: absoluteUrl(scheme, "https://weibo.com") || `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`,
      };
    })
    .filter((item) => item.title && !seen.has(item.title) && Boolean(seen.add(item.title)))
    .slice(0, 12)
    .map((item, index) => ({ ...item, id: `weibo-${index + 1}`, rank: index + 1, source: "微博热搜" }));
}

function parseWeiboHtml(html: string): Hotspot[] {
  const seen = new Set<string>();
  return [...html.matchAll(/<td[^>]+class=["']td-02["'][^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => {
      const cell = match[1];
      const anchor = cell.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      const title = cleanText(anchor?.[2] ?? "");
      const heat = cell.match(/<span[^>]*>([0-9]+)<\/span>/i)?.[1];
      const href = cleanText(anchor?.[1] ?? "");
      return {
        title,
        summary: "微博用户正在讨论的实时话题",
        heat: formatHeat(heat),
        url: absoluteUrl(href, "https://s.weibo.com") || `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`,
      };
    })
    .filter((item) => item.title && !seen.has(item.title) && Boolean(seen.add(item.title)))
    .slice(0, 12)
    .map((item, index) => ({ ...item, id: `weibo-${index + 1}`, rank: index + 1, source: "微博热搜" }));
}

function parseToutiaoJson(payload: unknown): Hotspot[] {
  const root = payload as { data?: Array<Record<string, unknown>> };
  if (!Array.isArray(root?.data)) return [];

  const seen = new Set<string>();
  return root.data
    .map((row) => {
      const title = cleanText(String(row.Title ?? row.title ?? row.QueryWord ?? ""));
      const rawUrl = String(row.Url ?? row.url ?? "");
      const clusterId = String(row.ClusterIdStr ?? row.ClusterId ?? row.id ?? "");
      const label = cleanText(String(row.Label ?? row.label ?? ""));
      return {
        title,
        summary: label && label !== title ? label : "今日头条用户正在关注的热点事件",
        heat: formatHeat(row.HotValue ?? row.hot_value ?? row.hotScore),
        url:
          absoluteUrl(rawUrl, "https://www.toutiao.com") ||
          (clusterId ? `https://www.toutiao.com/trending/${clusterId}/` : `https://so.toutiao.com/search?keyword=${encodeURIComponent(title)}`),
      };
    })
    .filter((item) => item.title && !seen.has(item.title) && Boolean(seen.add(item.title)))
    .slice(0, 12)
    .map((item, index) => ({ ...item, id: `toutiao-${index + 1}`, rank: index + 1, source: "今日头条热榜" }));
}

async function fetchSource(url: string, referer: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      referer,
      "user-agent": "Mozilla/5.0 (compatible; MozhouHotspotReader/1.1; +https://github.com/Yuhe94/mozhou-wechat-ai)",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`热点来源返回 ${response.status}`);
  return response.text();
}

async function getWeiboHotspots() {
  try {
    const text = await fetchSource(WEIBO_API_URL, "https://weibo.com/");
    const hotspots = parseWeiboJson(JSON.parse(text));
    if (hotspots.length) return hotspots;
  } catch {
    // The public JSON endpoint sometimes asks for a visitor session; use the official list page next.
  }
  const html = await fetchSource(WEIBO_PAGE_URL, "https://s.weibo.com/");
  return parseWeiboHtml(html);
}

async function getToutiaoHotspots() {
  const text = await fetchSource(TOUTIAO_HOT_URL, "https://www.toutiao.com/");
  return parseToutiaoJson(JSON.parse(text));
}

function interleave(lists: Hotspot[][]) {
  const merged: Hotspot[] = [];
  const longest = Math.max(...lists.map((list) => list.length), 0);
  for (let index = 0; index < longest; index += 1) {
    lists.forEach((list) => {
      if (list[index]) merged.push(list[index]);
    });
  }
  return merged.slice(0, 16).map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function GET() {
  const results = await Promise.allSettled([getWeiboHotspots(), getToutiaoHotspots()]);
  const lists = results
    .filter((result): result is PromiseFulfilledResult<Hotspot[]> => result.status === "fulfilled" && result.value.length > 0)
    .map((result) => result.value);
  const hotspots = interleave(lists);

  if (!hotspots.length) {
    const reason = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : "来源暂不可用"))
      .join("；");
    return Response.json({ error: `暂时无法获取微博与今日头条热榜：${reason || "请稍后重试"}` }, { status: 502 });
  }

  const sources = [...new Set(hotspots.map((item) => item.source))];
  return Response.json(
    { hotspots, fetchedAt: new Date().toISOString(), source: sources.join(" + "), sources },
    { headers: { "cache-control": "public, s-maxage=180, stale-while-revalidate=600" } },
  );
}
