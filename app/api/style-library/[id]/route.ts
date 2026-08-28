import { listWritingExamples, rebuildDeterministicProfile } from "../../../lib/style-library.server";
import { ensureDatabase, getUserId, json } from "../../../lib/storage.server";

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function DELETE(request: Request, context: Context) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const params = await context.params;
    const result = await DB.prepare(
      "DELETE FROM writing_examples WHERE id = ? AND user_id = ?",
    ).bind(params.id, userId).run();
    if (!result.meta.changes) return json({ error: "范文不存在" }, { status: 404 });
    await rebuildDeterministicProfile(DB, userId);
    return json(await listWritingExamples(DB, userId));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "删除范文失败" }, { status: 500 });
  }
}
