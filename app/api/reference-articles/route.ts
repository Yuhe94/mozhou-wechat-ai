import type { ReferenceArticle } from "../../lib/product-types";

const MAX_ARTICLES = 5;
const MAX_ARTICLE_BYTES = 2_500_000;
const MAX_ARTICLE_CHARACTERS = 10_000;
const MIN_ARTICLE_CHARACTERS = 40;
const FETCH_TIMEOUT_MS = 15_000;

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanInline(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeJavascriptString(value: string) {
  return decodeEntities(
    value
      .replace(/\\x([0-9a-f]{2})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\(['"\\/])/g, "$1")
      .replace(/\\n|\\r|\\t/g, " "),
  ).trim();
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const after = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"));
  const before = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"));
  return cleanInline(after?.[1] ?? before?.[1] ?? "");
}

function scriptValue(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`(?:var\\s+)?${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1\\s*;`, "i"));
  return decodeJavascriptString(match?.[2] ?? "");
}

function jsonStringValues(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = html.matchAll(new RegExp(`"${escaped}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, "gi"));
  const values: string[] = [];
  for (const match of matches) {
    if (!match[1]) continue;
    try {
      const value = JSON.parse(match[1]) as unknown;
      if (typeof value === "string") values.push(value);
    } catch {
      continue;
    }
  }
  return values;
}

function jsonStringValue(html: string, name: string) {
  return jsonStringValues(html, name)[0] ?? "";
}

function textFromHtml(fragment: string) {
  const text = decodeEntities(
    fragment
      .replace(/<(script|style|svg|noscript|nav|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|section|div|li|blockquote|h[1-6]|article)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  );
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_ARTICLE_CHARACTERS);
}

function fragmentAfterMarker(html: string, marker: RegExp, ending: RegExp) {
  const match = marker.exec(html);
  if (!match) return "";
  const openEnd = html.indexOf(">", match.index);
  if (openEnd < 0) return "";
  const after = html.slice(openEnd + 1);
  const end = after.search(ending);
  return after.slice(0, end > 0 ? end : Math.min(after.length, MAX_ARTICLE_BYTES));
}

function jsonLdArticle(html: string): { text: string; headline: string; author: string } | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let found: { text: string; headline: string; author: string } | null = null;

  function visit(value: unknown) {
    if (found || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const body = typeof record.articleBody === "string" ? record.articleBody : "";
    if (body) {
      const authorValue = record.author;
      const author =
        typeof authorValue === "string"
          ? authorValue
          : authorValue && typeof authorValue === "object" && typeof (authorValue as Record<string, unknown>).name === "string"
            ? String((authorValue as Record<string, unknown>).name)
            : "";
      found = {
        text: textFromHtml(body),
        headline: typeof record.headline === "string" ? cleanInline(record.headline) : "",
        author: cleanInline(author),
      };
      return;
    }
    Object.values(record).forEach(visit);
  }

  for (const script of scripts) {
    try {
      visit(JSON.parse(script[1]));
    } catch {
      try {
        visit(JSON.parse(decodeEntities(script[1])));
      } catch {
        continue;
      }
    }
  }
  return found as { text: string; headline: string; author: string } | null;
}

function articleBody(html: string, structuredText = "") {
  const candidates = [
    structuredText,
    textFromHtml(fragmentAfterMarker(html, /id=["']js_content["']/i, /<div[^>]+id=["'](?:js_sponsor_ad_area|js_pc_qr_code)["']|<script/i)),
    textFromHtml(fragmentAfterMarker(html, /(?:id|class)=["'][^"']*(?:article-content|article_body|article-body|post-content|entry-content|rich_media_content|main-content)[^"']*["']/i, /<footer|<aside|<script|<div[^>]+class=["'][^"']*(?:comment|recommend|related)[^"']*["']/i)),
    textFromHtml(fragmentAfterMarker(html, /<article(?:\s|>)/i, /<\/article>/i)),
    textFromHtml(fragmentAfterMarker(html, /<main(?:\s|>)/i, /<\/main>|<footer/i)),
  ];
  const embedded = ["articleBody", "text_raw", "content"]
    .flatMap((name) => jsonStringValues(html, name))
    .map(textFromHtml)
    .filter((text) => text.length >= MIN_ARTICLE_CHARACTERS)
    .sort((left, right) => right.length - left.length);
  candidates.push(...embedded);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) candidates.push(textFromHtml(bodyMatch[1]));
  return candidates.find((candidate) => candidate.length >= MIN_ARTICLE_CHARACTERS) ?? "";
}

function blockedIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function validateArticleUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("链接格式不正确");
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("仅支持公开 HTTP/HTTPS 文章链接");
  if (url.username || url.password) throw new Error("链接不能包含账号或密码");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("链接端口不受支持");

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const blockedName =
    !hostname ||
    hostname === "localhost" ||
    hostname.includes(":") ||
    [".localhost", ".local", ".internal", ".home", ".lan", ".test", ".invalid", ".example", ".onion"].some((suffix) => hostname.endsWith(suffix));
  if (blockedName || blockedIpv4(hostname)) throw new Error("仅支持可公开访问的文章链接");
  url.hash = "";
  return url;
}

async function fetchArticlePage(input: URL) {
  let current = input;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("读取超时，请稍后重试或粘贴正文");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("文章页面跳转失败");
      current = validateArticleUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`文章页面返回 ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("链接不是可读取的网页文章");
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_ARTICLE_BYTES) throw new Error("文章页面体积过大");
    const html = (await response.text()).slice(0, MAX_ARTICLE_BYTES);
    return { html, finalUrl: current.toString() };
  }
  throw new Error("文章页面跳转次数过多");
}

async function readArticle(value: string): Promise<ReferenceArticle> {
  const input = validateArticleUrl(value);
  const { html, finalUrl } = await fetchArticlePage(input);
  const structured = jsonLdArticle(html);
  const title =
    cleanInline(html.match(/<h1[^>]+id=["']activity-name["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
    structured?.headline ||
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    cleanInline(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
    cleanInline(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    scriptValue(html, "msg_title") ||
    cleanInline(jsonStringValue(html, "title"));
  const account =
    scriptValue(html, "nickname") ||
    structured?.author ||
    metaContent(html, "author") ||
    metaContent(html, "og:site_name") ||
    cleanInline(html.match(/class=["'][^"']*profile_nickname[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? "") ||
    input.hostname;
  const description = metaContent(html, "og:description") || metaContent(html, "description");
  const text = articleBody(html, structured?.text ?? "");

  if (text.length < MIN_ARTICLE_CHARACTERS) {
    throw new Error("未读取到有效正文，页面可能需要登录、已受限或依赖脚本加载");
  }
  return {
    url: finalUrl,
    title: title || `来自 ${input.hostname} 的参考内容`,
    account: account || input.hostname,
    description,
    text,
    characterCount: text.length,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { urls?: unknown } | null;
  if (!Array.isArray(body?.urls)) {
    return Response.json({ error: "请提供公开文章链接列表" }, { status: 400 });
  }

  const rawUrls = body.urls.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const uniqueUrls = [...new Set(rawUrls.map((url) => url.trim()))].slice(0, MAX_ARTICLES);
  if (!uniqueUrls.length) return Response.json({ error: "请至少粘贴一个文章链接" }, { status: 400 });

  const results = await Promise.allSettled(uniqueUrls.map(readArticle));
  const articles: ReferenceArticle[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") articles.push(result.value);
    else errors.push({ url: uniqueUrls[index], error: result.reason instanceof Error ? result.reason.message : "读取失败" });
  });

  if (!articles.length) {
    return Response.json({ error: errors[0]?.error || "未能读取文章", articles, errors }, { status: 422 });
  }
  return Response.json({ articles, errors, importedAt: new Date().toISOString() });
}
