import type { WritingExampleSource, WritingProfile } from "../../lib/product-types";
import { normalizeWritingProfile } from "../../lib/style-profile";
import {
  hashWritingExample,
  listWritingExamples,
  rebuildDeterministicProfile,
  saveWritingProfile,
} from "../../lib/style-library.server";
import { ensureDatabase, getUserId, json } from "../../lib/storage.server";

export async function GET(request: Request) {
  try {
    const DB = await ensureDatabase();
    return json(await listWritingExamples(DB, getUserId(request.headers)));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取范例库失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const body = (await request.json()) as {
      title?: string;
      content?: string;
      tags?: string;
      source?: WritingExampleSource;
    };
    const content = body.content?.replace(/\r\n/g, "\n").trim() ?? "";
    if (content.length < 100) return json({ error: "范文至少需要 100 字" }, { status: 400 });
    if (content.length > 30000) return json({ error: "单篇范文最多收录 30000 字" }, { status: 400 });
    const source: WritingExampleSource = ["paste", "upload", "finalized"].includes(body.source ?? "")
      ? body.source as WritingExampleSource
      : "paste";
    const title = body.title?.trim().slice(0, 120) || content.split("\n").find(Boolean)?.slice(0, 40) || "未命名范文";
    const tags = body.tags?.trim().slice(0, 160) ?? "";
    const contentHash = await hashWritingExample(content);
    const existing = await DB.prepare(
      "SELECT id FROM writing_examples WHERE user_id = ? AND content_hash = ? LIMIT 1",
    ).bind(userId, contentHash).first();
    if (existing) return json({ error: "这篇范文已经收录过了" }, { status: 409 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await DB.prepare(
      `INSERT INTO writing_examples
       (id, user_id, title, content, content_hash, tags, source, character_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, title, content, contentHash, tags, source, content.length, now, now).run();
    await rebuildDeterministicProfile(DB, userId);
    return json(await listWritingExamples(DB, userId), { status: 201 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "收录范文失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const DB = await ensureDatabase();
    const userId = getUserId(request.headers);
    const body = (await request.json()) as { profile?: WritingProfile };
    const library = await listWritingExamples(DB, userId);
    if (!body.profile) return json({ error: "缺少风格画像" }, { status: 400 });
    const fallback = library.profile ?? (await rebuildDeterministicProfile(DB, userId)).profile;
    const profile = normalizeWritingProfile(body.profile, fallback);
    const profileUpdatedAt = await saveWritingProfile(DB, userId, profile, library.exampleCount);
    return json({ profile, exampleCount: library.exampleCount, profileUpdatedAt });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "保存风格画像失败" }, { status: 500 });
  }
}
