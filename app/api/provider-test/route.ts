import { generateCompatibleText, textProviderConfig } from "../../lib/ai-provider.server";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export async function POST(request: Request) {
  try {
    const config = textProviderConfig(request.headers, {});
    if (!config.apiKey) return json({ error: `请先填写 ${config.label} API Key` }, { status: 400 });
    await generateCompatibleText(config, "你是 API 连接检测助手。", "只回复两个字：正常", 32);
    return json({ ok: true, provider: config.label, model: config.model });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "连接测试失败" }, { status: 400 });
  }
}
