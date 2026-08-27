import { ensureDatabase, getUserId, json } from "../../../lib/storage.server";

type Context = { params: Promise<{ id: string }> | { id: string } };

async function getId(context: Context) {
  const params = await context.params;
  return params.id;
}

export async function GET(request: Request, context: Context) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const id = await getId(context);
    const row = await DB.prepare(
      `SELECT id, title, status, snapshot, created_at, updated_at
       FROM articles WHERE id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(id, userId)
      .first();
    if (!row) return json({ error: "文章不存在" }, { status: 404 });
    return json({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      snapshot: JSON.parse(String(row.snapshot)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取失败" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const id = await getId(context);
    const body = (await request.json()) as {
      title?: string;
      status?: string;
      snapshot?: unknown;
    };
    if (!body.snapshot) return json({ error: "缺少文章内容" }, { status: 400 });
    const now = new Date().toISOString();
    const result = await DB.prepare(
      `UPDATE articles
       SET title = ?, status = ?, snapshot = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        body.title?.trim() || "未命名文章",
        body.status ?? "draft",
        JSON.stringify(body.snapshot),
        now,
        id,
        userId,
      )
      .run();
    if (!result.meta.changes) return json({ error: "文章不存在" }, { status: 404 });
    return json({ ok: true, updatedAt: now });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const id = await getId(context);
    await DB.prepare("DELETE FROM articles WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}

