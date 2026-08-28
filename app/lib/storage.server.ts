import { env } from "cloudflare:workers";

type Bindings = {
  DB?: D1Database;
  UPLOADS?: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_TEXT_MODEL?: string;
  KIMI_API_KEY?: string;
  KIMI_TEXT_MODEL?: string;
};

export function getBindings(): Bindings {
  return env as unknown as Bindings;
}

export function getUserId(headers: Headers): string {
  return headers.get("oai-authenticated-user-id") ?? "local-preview-user";
}

export async function ensureDatabase() {
  const { DB } = getBindings();
  if (!DB) throw new Error("数据库尚未绑定");

  await DB.batch([
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_articles_user_updated
      ON articles(user_id, updated_at DESC)
    `),
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `),
    DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_assets_user_created
      ON assets(user_id, created_at DESC)
    `),
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS writing_examples (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'paste',
        character_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_writing_examples_user_updated
      ON writing_examples(user_id, updated_at DESC)
    `),
    DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_writing_examples_user_hash
      ON writing_examples(user_id, content_hash)
    `),
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS writing_profiles (
        user_id TEXT PRIMARY KEY NOT NULL,
        profile TEXT NOT NULL,
        example_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
  ]);

  return DB;
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function safeFilename(value: string) {
  return value
    .normalize("NFKC")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "asset";
}
