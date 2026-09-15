import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function request(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, init),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render(pathname = "/") {
  return request(pathname, { headers: { accept: "text/html" } });
}

test("server-renders the Mozhou writing workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>墨舟｜微信公众号 AI 创作工作台<\/title>/i);
  assert.match(html, /微信公众号 AI 创作工作台/);
  assert.match(html, /创作简报/);
  assert.match(html, /参考改写/);
  assert.match(html, /社会热点/);
  assert.match(html, /400–600 字/);
  assert.match(html, /生成研究角度/);
  assert.match(html, /手机预览/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/);
});

test("rejects private-network reference article URLs before fetching", async () => {
  const response = await request("/api/reference-articles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls: ["http://127.0.0.1/private-article"] }),
  });
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.match(payload.error, /仅支持可公开访问的文章链接/);
  assert.deepEqual(payload.articles, []);
});

test("rejects private-network custom AI endpoints before connecting", async () => {
  const response = await request("/api/provider-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mozhou-text-provider": "custom",
      "x-mozhou-text-base-url": "https://127.0.0.1/v1",
      "x-mozhou-text-model": "private-model",
      "x-mozhou-text-api-key": "test-key",
    },
    body: "{}",
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /API 地址必须指向公网服务/);
});

test("uses a native guarded POST for OpenAI-compatible providers", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init };
    return Response.json({ choices: [{ message: { content: "正常" } }] });
  };
  try {
    const response = await request("/api/provider-test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mozhou-text-provider": "custom",
        "x-mozhou-text-base-url": "https://provider.example.com/v1",
        "x-mozhou-text-model": "compatible-model",
        "x-mozhou-text-api-key": "test-key",
      },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(captured.url, "https://provider.example.com/v1/chat/completions");
    assert.equal(captured.init.method, "POST");
    assert.equal(captured.init.redirect, "manual");
    assert.equal(captured.init.headers.authorization, "Bearer test-key");
    assert.equal(JSON.parse(captured.init.body).model, "compatible-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves complete successful provider responses larger than the error preview limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: `completion-${"x".repeat(6_000)}`,
      choices: [{ message: { content: "正常" } }],
    });
  try {
    const response = await request("/api/provider-test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mozhou-text-provider": "custom",
        "x-mozhou-text-base-url": "https://provider.example.com/v1",
        "x-mozhou-text-model": "compatible-model",
        "x-mozhou-text-api-key": "test-key",
      },
      body: "{}",
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns upstream HTTP errors without exposing API keys", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: { message: "Invalid key sk-supersecret1234" } }, { status: 401 });
  try {
    const response = await request("/api/provider-test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mozhou-text-provider": "custom",
        "x-mozhou-text-base-url": "https://provider.example.com/v1",
        "x-mozhou-text-model": "compatible-model",
        "x-mozhou-text-api-key": "test-key",
      },
      body: "{}",
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /HTTP 401/);
    assert.match(payload.error, /sk-\*\*\*/);
    assert.doesNotMatch(payload.error, /supersecret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renders a short article without an empty subtitle", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: false, root: new URL("../", import.meta.url).pathname, logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { buildArticleHtml, buildArticleMarkdown } = await vite.ssrLoadModule("/app/lib/publish-package.client.ts");
    const snapshot = { title: "一条简单消息", digest: "简短说明", theme: "paper", aiDisclosure: false, sections: [{ id: "section-1", heading: "", paragraphs: ["第一段直接说明事件。", "第二段补充必要背景。"] }] };
    const html = buildArticleHtml(snapshot, true);
    const markdown = buildArticleMarkdown(snapshot);
    assert.doesNotMatch(html, /<h2/);
    assert.doesNotMatch(markdown, /^## /m);
    assert.match(html, /第一段直接说明事件/);
  } finally {
    await vite.close();
  }
});

test("hard-normalizes short articles and removes duplicate image slots", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: false, root: new URL("../", import.meta.url).pathname, logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { normalizeReaderDraft } = await vite.ssrLoadModule("/app/lib/article-draft.ts");
    const draft = normalizeReaderDraft({
      title: "「塔克拉玛干」发现了大型地下水水源？先等等",
      digest: "一条『简讯』",
      sections: [
        { id: "a", heading: "第一部分", paragraphs: ["第一段说明「消息来源」。", "配图：塔克拉玛干沙漠"], imageSlot: "IMG-01" },
        { id: "b", heading: "第二部分", paragraphs: ["第二段补充已有背景。"], imageSlot: "IMG-01" },
        { id: "c", heading: "第三部分", paragraphs: ["第三段给出有限判断。"], imageSlot: "IMG-02" },
      ],
    }, "400–600 字");
    assert.equal(draft.title, "“塔克拉玛干”发现了大型地下水水源？");
    assert.equal(draft.digest, "一条“简讯”");
    assert.equal(draft.sections.length, 2);
    assert.ok(draft.sections.every((section) => section.heading === ""));
    assert.equal(draft.sections.flatMap((section) => section.paragraphs).length, 2);
    assert.deepEqual(draft.sections.flatMap((section) => section.imageSlot ? [section.imageSlot] : []), ["IMG-01"]);
    assert.doesNotMatch(JSON.stringify(draft), /配图：/);
    assert.doesNotMatch(JSON.stringify(draft), /[「」『』]/);
    assert.match(JSON.stringify(draft), /“消息来源”/);
    assert.match(JSON.stringify(draft), /第三段给出有限判断/);
  } finally {
    await vite.close();
  }
});

test("renumbers duplicate image slots in longer articles", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: false, root: new URL("../", import.meta.url).pathname, logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { normalizeReaderDraft } = await vite.ssrLoadModule("/app/lib/article-draft.ts");
    const draft = normalizeReaderDraft({ sections: [
      { id: "a", heading: "一", paragraphs: ["甲"], imageSlot: "IMG-01" },
      { id: "b", heading: "二", paragraphs: ["乙"], imageSlot: "IMG-01" },
      { id: "c", heading: "三", paragraphs: ["丙"], imageSlot: "IMG-03" },
    ] }, "1200–1600 字");
    assert.deepEqual(draft.sections.flatMap((section) => section.imageSlot ? [section.imageSlot] : []), ["IMG-01", "IMG-02"]);
  } finally {
    await vite.close();
  }
});

test("recognizes an internal research draft before it can reach readers", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: false, root: new URL("../", import.meta.url).pathname, logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { looksLikeInternalWorkingDraft } = await vite.ssrLoadModule("/app/lib/article-draft.ts");
    assert.equal(looksLikeInternalWorkingDraft({
      title: "热搜“4点”内部核查",
      digest: "本轮可核查的资料存在分歧",
      sections: [
        { heading: "待核与不宜采用的信息", paragraphs: ["待核一：原始研究出处。"] },
        { heading: "供终审编辑重组的判断", paragraphs: ["以下只供编辑使用。"] },
      ],
    }), true);
    assert.equal(looksLikeInternalWorkingDraft({
      title: "糖尿病风险因素不能只看四个标签",
      digest: "饮食、运动与体重需要结合个人情况理解。",
      sections: [{ heading: "", paragraphs: ["这是一篇直接面向读者的短文。"] }],
    }), false);
  } finally {
    await vite.close();
  }
});

test("creates an editable narrative route with a non-fixed research task count", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: false,
    root: new URL("../", import.meta.url).pathname,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { buildDemoOutline, buildDemoResearchPlan } = await vite.ssrLoadModule("/app/lib/demo-engine.ts");
    const brief = { creationMode: "hotspot", topic: "涨工资的三重信号", audience: "普通职工", goal: "解释适用范围", tone: "自然", length: "800–1200 字", callToAction: "核对自身情况", sourcesText: "" };
    const angle = { id: "angle-1", title: "谁真正被覆盖", hook: "哪些人能直接受益", thesis: "三类政策对象不同", readerGain: "判断是否与自己有关", evidenceNeeds: ["适用范围"] };
    const plan = buildDemoResearchPlan(brief, angle);
    const outline = buildDemoOutline(angle, brief);
    assert.match(plan.centralQuestion, /涨工资的三重信号/);
    assert.match(plan.narrativeRoute, /一句话或一个动作/);
    assert.equal(outline.length, 3);
    assert.equal(outline[2].bullets.length, 1);
    assert.ok(outline.flatMap((item) => item.searchQueries).every((query) => !/[a-z]{4}/i.test(query)));
  } finally {
    await vite.close();
  }
});

test("accepts independent evidence instead of requiring a hotspot-platform channel label", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: false,
    root: new URL("../", import.meta.url).pathname,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { assessResearchEvidence } = await vite.ssrLoadModule("/app/lib/research-evidence.ts");
    const source = (title, url, domain, retrieval, text, channel = "brave") => ({
      source: { title, url, domain, query: "雷军 宇树机器人", channel, region: "cn", retrieval },
      text,
    });
    const fulltext = assessResearchEvidence([
      source("雷军到访宇树科技", "https://a.example/1", "a.example", "fulltext", "雷军到访宇树科技并参观机器人演示。".repeat(14)),
      source("宇树回应雷军来访", "https://b.example/2", "b.example", "fulltext", "双方围绕机器人产品与行业发展进行了交流。".repeat(14)),
    ], true);
    assert.equal(fulltext.ready, true);
    assert.equal(fulltext.evidenceMode, "fulltext");

    const snippets = assessResearchEvidence([
      source("报道一", "https://one.example/1", "one.example", "snippet", "多家媒体报道雷军到访宇树科技，并观看机器人展示。".repeat(4)),
      source("报道二", "https://two.example/2", "two.example", "snippet", "公开信息显示雷军参观了宇树科技，现场展示涉及机器人动作。".repeat(4)),
      source("报道三", "https://three.example/3", "three.example", "snippet", "雷军到访宇树科技的消息引发了机器人行业关注。".repeat(4)),
    ], true);
    assert.equal(snippets.ready, true);
    assert.equal(snippets.evidenceMode, "corroborated-snippets");

    const wechatAccounts = assessResearchEvidence([
      source("法国队轮换观察｜体育花简", "https://weixin.sogou.com/link?a", "weixin.sogou.com", "snippet", "法国队公布轮换安排，姆巴佩和登贝莱的角色再次成为讨论焦点。".repeat(4), "wechat"),
      source("姆巴佩与登贝莱谁是核心｜K唐伯虎", "https://weixin.sogou.com/link?b", "weixin.sogou.com", "snippet", "围绕法国队进攻核心的讨论同时涉及姆巴佩和登贝莱近期表现。".repeat(4), "wechat"),
      source("金球奖评选中的队友竞争｜足球达人堂", "https://weixin.sogou.com/link?c", "weixin.sogou.com", "snippet", "多篇评论从金球奖评选机制分析两名法国队球员的竞争关系。".repeat(4), "wechat"),
    ], true);
    assert.equal(wechatAccounts.ready, true);
    assert.equal(wechatAccounts.evidenceMode, "corroborated-snippets");
    assert.equal(wechatAccounts.independentSourceCount, 3);
  } finally {
    await vite.close();
  }
});

test("layers a matching mainland official source into research discovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("YAOWENLIEBIAO.json")) {
      return Response.json([{ TITLE: "中国将在2027年接任金砖主席国", URL: "https://www.gov.cn/zhengce/202609/content_123.htm", DOCRELPUBTIME: "2026-09-13" }]);
    }
    if (url.includes("api.gdeltproject.org")) return Response.json({ articles: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: false,
    root: new URL("../", import.meta.url).pathname,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { discoverResearchSources, parseWechatSearchResults } = await vite.ssrLoadModule("/app/lib/news-research.server.ts");
    const wechat = parseWechatSearchResults(
      '<ul><li id="sogou_vr_11002601_box_0"><div class="txt-box"><h3><a href="/link?url=abc&amp;type=2">Bin回应AL夺冠：赛后采访原话</a></h3><p class="txt-info">主持人在赛后采访中询问决赛失利，选手回应了比赛结果、对手表现以及接下来的备战安排。</p><span class="all-time-y2">电竞观察</span></div></li></ul>',
      "Bin回应AL夺冠",
    );
    assert.equal(wechat[0].source.channel, "wechat");
    assert.equal(wechat[0].source.retrieval, "snippet");
    assert.match(wechat[0].source.title, /电竞观察/);
    const discovery = await discoverResearchSources(
      { creationMode: "original", topic: "中国将于2027年接任金砖主席国", audience: "普通读者", goal: "解释轮值意义", tone: "克制", length: "400–600 字", callToAction: "继续观察官方信息", sourcesText: "" },
      [{ id: "research-1", heading: "轮值制度", purpose: "核对安排", bullets: ["官方资料"], searchQueries: ["中国 2027 金砖 主席国", "China BRICS chair 2027"] }],
      { provider: "public", region: "cn", braveApiKey: "" },
    );
    assert.equal(discovery.seeds[0].source.channel, "official");
    assert.equal(discovery.seeds[0].source.region, "cn");
    assert.equal(discovery.seeds[0].source.retrieval, "fulltext");
    assert.deepEqual(discovery.channels, ["地区官方源"]);
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
  }
});

test("returns to Toutiao search and prioritizes related hotspot articles", async () => {
  const originalFetch = globalThis.fetch;
  const encoded = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const result = (title, url, abstract = "") => `<article cr-params="${encoded(JSON.stringify({ title, url, abstract, cell_type: 67 }))}"></article>`;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("so.toutiao.com/search")) {
      return new Response([
        result("Bin赛后回应AL夺冠，原话与争议焦点", "https://article.zlink.toutiao.com/J4dQM?h5_url=https%3A%2F%2Fnews-one.cn%2Fbin-response", "赛后采访中，Bin谈到AL夺冠以及双方在决赛中的表现，也回应了外界关心的备战安排，相关内容随后引发讨论。"),
        result("AL夺冠后Bin回应引发讨论", "https://news-two.cn/al-champion"),
      ].join(""), { headers: { "content-type": "text/html" } });
    }
    if (url.includes("YAOWENLIEBIAO.json")) return Response.json([]);
    if (url.includes("api.gdeltproject.org")) return Response.json({ articles: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: false,
    root: new URL("../", import.meta.url).pathname,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { discoverResearchSources } = await vite.ssrLoadModule("/app/lib/news-research.server.ts");
    const discovery = await discoverResearchSources(
      { creationMode: "hotspot", topic: "Bin回应AL夺冠", audience: "普通读者", goal: "还原事件", tone: "自然", length: "400–600 字", callToAction: "了解背景", sourcesText: "热点来源：今日头条热榜｜https://www.toutiao.com/trending/123" },
      [{ id: "research-1", heading: "原话", purpose: "核对上下文", bullets: ["采访"], searchQueries: ["Bin 回应 AL 夺冠", "Bin AL championship response"] }],
      { provider: "public", region: "cn", braveApiKey: "" },
    );
    assert.equal(discovery.seeds.length, 2);
    assert.equal(discovery.seeds[0].source.channel, "platform");
    assert.equal(discovery.seeds[0].source.url, "https://news-one.cn/bin-response");
    assert.match(discovery.seeds[0].text, /赛后采访/);
    assert.deepEqual(discovery.channels, ["热搜平台相关文章"]);
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
  }
});

test("ships the required creation, rewriting, hotspot, storage, and export surfaces", async () => {
  const root = new URL("../", import.meta.url);
  const [workspace, generator, demoEngine, providerRoute, providerAdapter, aiSettings, newsResearch, hotspots, references, packager, productTypes, schema, hosting] = await Promise.all([
    readFile(new URL("app/workspace.tsx", root), "utf8"),
    readFile(new URL("app/api/generate/route.ts", root), "utf8"),
    readFile(new URL("app/lib/demo-engine.ts", root), "utf8"),
    readFile(new URL("app/api/provider-test/route.ts", root), "utf8"),
    readFile(new URL("app/lib/ai-provider.server.ts", root), "utf8"),
    readFile(new URL("app/lib/ai-settings.ts", root), "utf8"),
    readFile(new URL("app/lib/news-research.server.ts", root), "utf8"),
    readFile(new URL("app/api/hotspots/route.ts", root), "utf8"),
    readFile(new URL("app/api/reference-articles/route.ts", root), "utf8"),
    readFile(new URL("app/lib/publish-package.client.ts", root), "utf8"),
    readFile(new URL("app/lib/product-types.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(workspace, /generateTopics/);
  assert.match(workspace, /generateOutline/);
  assert.match(workspace, /generateDraft/);
  assert.match(workspace, /generateImages/);
  assert.match(workspace, /chooseHotspot/);
  assert.match(workspace, /热点摘要：/);
  assert.match(workspace, /resetGeneratedContent/);
  assert.match(workspace, /exportPublicationPackage/);
  assert.match(workspace, /referenceArticle/);
  assert.match(workspace, /referenceUrls/);
  assert.match(workspace, /\/api\/reference-articles/);
  assert.match(workspace, /AI 模型设置/);
  assert.match(workspace, /\/api\/provider-test/);
  assert.match(workspace, /generationHeaders/);
  assert.match(workspace, /联网新闻研究/);
  assert.match(workspace, /Brave News \+ 区域官方源/);
  assert.match(workspace, /联网研究记录/);
  assert.match(workspace, /增加材料任务/);
  assert.match(workspace, /删除第 \$\{index \+ 1\} 项材料任务/);
  assert.match(workspace, /增加正文模块/);
  assert.match(workspace, /删除第 \$\{index \+ 1\} 个正文模块/);
  assert.match(generator, /generateCompatibleText/);
  assert.match(generator, /generateCompatibleImage/);
  assert.match(generator, /参考原文改写/);
  assert.match(generator, /parseStructuredOutput/);
  assert.match(generator, /normalizeBriefForGeneration/);
  assert.match(generator, /topic 字段是文章唯一核心/);
  assert.match(demoEngine, /事实边界与制度背景/);
  assert.match(demoEngine, /buildDemoResearchPlan/);
  assert.match(demoEngine, /不做百科式背景罗列/);
  assert.doesNotMatch(demoEngine, /发生了什么：先把背景与已知信息说清楚/);
  assert.doesNotMatch(demoEngine, /AI 应该负责什么|别急着追工具|AI 内容方案/);
  assert.match(generator, /模型返回的 JSON 内容不完整/);
  assert.match(providerRoute, /连接检测助手/);
  assert.match(providerAdapter, /chat\/completions/);
  assert.match(providerAdapter, /images\/generations/);
  assert.match(providerAdapter, /response_format/);
  assert.match(providerAdapter, /thinking/);
  assert.match(providerAdapter, /redirect: "manual"/);
  assert.match(providerAdapter, /API 地址必须指向公网服务/);
  assert.match(aiSettings, /deepseek-v4-flash/);
  assert.match(aiSettings, /kimi-k3/);
  assert.match(aiSettings, /gpt-image-2/);
  assert.match(aiSettings, /newsSearchProvider/);
  assert.match(aiSettings, /x-mozhou-news-region/);
  assert.match(newsResearch, /api\.search\.brave\.com\/res\/v1\/news\/search/);
  assert.match(newsResearch, /api\.gdeltproject\.org\/api\/v2\/doc\/doc/);
  assert.match(newsResearch, /www\.gov\.cn\/yaowen\/liebiao\/YAOWENLIEBIAO\.json/);
  assert.match(newsResearch, /www\.info\.gov\.hk\/gia\/rss\/general_zh\.xml/);
  assert.match(newsResearch, /www\.ey\.gov\.tw\/NewOpenData\/JSON\/154/);
  assert.match(newsResearch, /GDELT 需要英文检索词/);
  assert.match(newsResearch, /Brave News 暂不可用，已改用 GDELT 补充/);
  assert.match(newsResearch, /so\.toutiao\.com\/search/);
  assert.match(newsResearch, /weixin\.sogou\.com\/weixin/);
  assert.match(newsResearch, /热搜平台相关文章/);
  assert.match(newsResearch, /公众号文章/);
  assert.match(newsResearch, /微博讨论页要求访客验证/);
  assert.match(hotspots, /weibo\.com\/ajax\/side\/hotSearch/);
  assert.match(hotspots, /s\.weibo\.com\/top\/summary/);
  assert.match(hotspots, /toutiao\.com\/hot-event\/hot-board/);
  assert.match(hotspots, /Promise\.allSettled/);
  assert.match(references, /MAX_ARTICLES = 5/);
  assert.match(references, /id=\["'\]js_content/);
  assert.match(references, /application\\\/ld\\\+json/);
  assert.match(references, /text_raw/);
  assert.match(references, /blockedIpv4/);
  assert.match(references, /redirect: "manual"/);
  assert.match(references, /Promise\.allSettled/);
  assert.match(productTypes, /CreationMode/);
  assert.match(productTypes, /interface ReferenceArticle/);
  assert.doesNotMatch(productTypes, /topic: "AI 如何改变中小企业的内容运营"/);
  assert.match(packager, /referenceMaterialText/);
  assert.match(packager, /IMG-01/);
  assert.match(packager, /zipSync/);
  assert.match(packager, /来源与版权清单/);
  assert.match(schema, /articles/);
  assert.match(schema, /assets/);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, "UPLOADS");
  assert.match(hostingConfig.project_id, /^appgprj_/);
  await access(new URL("drizzle/0000_minor_firelord.sql", root));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});

test("ships a persistent writing-example library and injects its style into generation", async () => {
  const root = new URL("../", import.meta.url);
  const [workspace, generator, libraryRoute, contextRoute, styleProfile, schema, migration] = await Promise.all([
    readFile(new URL("app/workspace.tsx", root), "utf8"),
    readFile(new URL("app/api/generate/route.ts", root), "utf8"),
    readFile(new URL("app/api/style-library/route.ts", root), "utf8"),
    readFile(new URL("app/api/style-library/context/route.ts", root), "utf8"),
    readFile(new URL("app/lib/style-profile.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0001_curvy_iron_patriot.sql", root), "utf8"),
  ]);

  assert.match(workspace, /写作范例库/);
  assert.match(workspace, /收录并学习/);
  assert.match(workspace, /将人工定稿收入范例库/);
  assert.match(workspace, /purpose=profile/);
  assert.match(workspace, /styleContext/);
  assert.match(generator, /style-profile/);
  assert.match(generator, /资深公众号主编/);
  assert.match(generator, /在当今快速发展的时代/);
  assert.match(generator, /相关范例片段/);
  assert.match(generator, /FINAL_EDIT_SYSTEM/);
  assert.match(generator, /READER_ARTICLE_RULES/);
  assert.match(generator, /editorPass: "final"/);
  assert.match(generator, /禁止使用“发生了什么”“为什么值得关注”/);
  assert.match(generator, /readerDraftIssues/);
  assert.match(generator, /上一版仍未通过成稿检查/);
  assert.match(generator, /400–600 字短讯必须取消全部小标题/);
  assert.match(generator, /normalizeReaderDraft/);
  assert.match(generator, /AI_KEY_REQUIRED/);
  assert.match(generator, /AI_DRAFT_FAILED/);
  assert.match(generator, /AI_FINAL_EDIT_FAILED/);
  assert.match(generator, /AI_FINAL_QUALITY_FAILED/);
  assert.doesNotMatch(generator, /buildDemoDraft/);
  assert.doesNotMatch(generator, /draft: workingDraft/);
  assert.match(generator, /discoverResearchSources/);
  assert.match(generator, /researchReport/);
  assert.match(generator, /collectOnlineResearch/);
  assert.match(generator, /assessResearchEvidence/);
  assert.match(generator, /needsResearch: true/);
  assert.match(generator, /researchMode: "insufficient"/);
  assert.match(generator, /把检索失败和资料不足写进了面向读者的正文/);
  assert.match(generator, /作者确定的核心追问与叙事路线/);
  assert.match(generator, /不是套用“背景—原因—影响—建议”的固定目录/);
  assert.match(generator, /outline 为 2–5 项，任务之间不要同构/);
  assert.match(workspace, /联网研究并生成读者成稿/);
  assert.match(workspace, /资料还不够，本次没有生成正文/);
  assert.match(workspace, /多来源摘要交叉/);
  assert.match(workspace, /先定这篇文章怎么走，再决定查什么/);
  assert.match(workspace, /唯一核心追问/);
  assert.match(workspace, /主动舍弃/);
  assert.match(workspace, /联网检索词/);
  assert.match(workspace, /选择研究角度，不是文章标题/);
  assert.match(libraryRoute, /rebuildDeterministicProfile/);
  assert.match(contextRoute, /buildWritingStyleContext/);
  assert.match(styleProfile, /titlePatterns/);
  assert.match(styleProfile, /avoidExpressions/);
  assert.match(schema, /writingExamples/);
  assert.match(schema, /writingProfiles/);
  assert.match(migration, /CREATE TABLE `writing_examples`/);
  assert.match(migration, /CREATE TABLE `writing_profiles`/);
  assert.match(migration, /PRAGMA optimize/);
});
