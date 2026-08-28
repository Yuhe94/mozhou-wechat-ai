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
  assert.match(html, /生成选题角度/);
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

test("ships the required creation, rewriting, hotspot, storage, and export surfaces", async () => {
  const root = new URL("../", import.meta.url);
  const [workspace, generator, providerRoute, providerAdapter, aiSettings, hotspots, references, packager, productTypes, schema, hosting] = await Promise.all([
    readFile(new URL("app/workspace.tsx", root), "utf8"),
    readFile(new URL("app/api/generate/route.ts", root), "utf8"),
    readFile(new URL("app/api/provider-test/route.ts", root), "utf8"),
    readFile(new URL("app/lib/ai-provider.server.ts", root), "utf8"),
    readFile(new URL("app/lib/ai-settings.ts", root), "utf8"),
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
  assert.match(workspace, /exportPublicationPackage/);
  assert.match(workspace, /referenceArticle/);
  assert.match(workspace, /referenceUrls/);
  assert.match(workspace, /\/api\/reference-articles/);
  assert.match(workspace, /AI 模型设置/);
  assert.match(workspace, /\/api\/provider-test/);
  assert.match(workspace, /generationHeaders/);
  assert.match(generator, /generateCompatibleText/);
  assert.match(generator, /generateCompatibleImage/);
  assert.match(generator, /参考原文改写/);
  assert.match(providerRoute, /连接检测助手/);
  assert.match(providerAdapter, /chat\/completions/);
  assert.match(providerAdapter, /images\/generations/);
  assert.match(providerAdapter, /redirect: "manual"/);
  assert.match(providerAdapter, /API 地址必须指向公网服务/);
  assert.match(aiSettings, /deepseek-v4-flash/);
  assert.match(aiSettings, /kimi-k3/);
  assert.match(aiSettings, /gpt-image-2/);
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
