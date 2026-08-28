import { buildWritingStyleContext } from "../../../lib/style-library.server";
import { ensureDatabase, getUserId, json } from "../../../lib/storage.server";

export async function GET(request: Request) {
  try {
    const DB = await ensureDatabase();
    const url = new URL(request.url);
    const purpose = url.searchParams.get("purpose") === "profile" ? "profile" : "generation";
    const topic = url.searchParams.get("topic")?.slice(0, 300) ?? "";
    return json(await buildWritingStyleContext(DB, getUserId(request.headers), topic, purpose));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取写作风格失败" }, { status: 500 });
  }
}
