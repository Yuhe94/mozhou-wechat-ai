import { ensureDatabase, getUserId, json } from "../../lib/storage.server";
import { createBlankSnapshot } from "../../lib/product-types";

export async function GET(request: Request) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const result = await DB.prepare(
      `SELECT id, title, status, snapshot, created_at, updated_at
       FROM articles
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 20`,
    )
      .bind(userId)
      .all();

    const articles = result.results.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      snapshot: JSON.parse(String(row.snapshot)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
    return json({ articles });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "读取文章失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      snapshot?: unknown;
    };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const snapshot = body.snapshot ?? createBlankSnapshot();
    const title = body.title?.trim() || "未命名文章";

    await DB.prepare(
      `INSERT INTO articles
       (id, user_id, title, status, snapshot, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    )
      .bind(id, userId, title, JSON.stringify(snapshot), now, now)
      .run();

    return json({ id, title, status: "draft", snapshot, createdAt: now, updatedAt: now }, { status: 201 });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "创建文章失败" },
      { status: 500 },
    );
  }
}

