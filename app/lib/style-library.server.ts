import type {
  WritingExample,
  WritingExampleSource,
  WritingProfile,
  WritingStyleContext,
} from "./product-types";
import { buildDeterministicWritingProfile, type ProfileSample } from "./style-profile";

type ExampleRow = {
  id: unknown;
  title: unknown;
  content: unknown;
  tags: unknown;
  source: unknown;
  character_count: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const ALLOWED_SOURCES = new Set<WritingExampleSource>(["paste", "upload", "finalized"]);

function sourceValue(value: unknown): WritingExampleSource {
  return typeof value === "string" && ALLOWED_SOURCES.has(value as WritingExampleSource)
    ? value as WritingExampleSource
    : "paste";
}

function profileFromRow(row: Record<string, unknown> | null): WritingProfile | null {
  if (!row?.profile) return null;
  try {
    return JSON.parse(String(row.profile)) as WritingProfile;
  } catch {
    return null;
  }
}

export async function hashWritingExample(content: string) {
  const bytes = new TextEncoder().encode(content.normalize("NFKC").replace(/\s+/g, " ").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listWritingExamples(DB: D1Database, userId: string) {
  const [examplesResult, profileRow] = await Promise.all([
    DB.prepare(
      `SELECT id, title, content, tags, source, character_count, created_at, updated_at
       FROM writing_examples
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 50`,
    ).bind(userId).all(),
    DB.prepare(
      `SELECT profile, example_count, updated_at
       FROM writing_profiles
       WHERE user_id = ?
       LIMIT 1`,
    ).bind(userId).first(),
  ]);

  const examples = examplesResult.results.map((raw) => {
    const row = raw as ExampleRow;
    return {
      id: String(row.id),
      title: String(row.title),
      tags: String(row.tags || ""),
      source: sourceValue(row.source),
      characterCount: Number(row.character_count || 0),
      excerpt: String(row.content || "").slice(0, 420),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    } satisfies WritingExample;
  });

  return {
    examples,
    profile: profileFromRow(profileRow as Record<string, unknown> | null),
    exampleCount: examples.length,
    profileUpdatedAt: profileRow?.updated_at ? String(profileRow.updated_at) : null,
  };
}

export async function loadProfileSamples(DB: D1Database, userId: string) {
  const result = await DB.prepare(
    `SELECT title, content, tags, source
     FROM writing_examples
     WHERE user_id = ?
     ORDER BY CASE source WHEN 'finalized' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 12`,
  ).bind(userId).all();
  return result.results.map((row) => ({
    title: String(row.title || ""),
    content: String(row.content || ""),
    tags: String(row.tags || ""),
    source: sourceValue(row.source),
  }));
}

export async function saveWritingProfile(
  DB: D1Database,
  userId: string,
  profile: WritingProfile,
  exampleCount: number,
) {
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO writing_profiles (user_id, profile, example_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       profile = excluded.profile,
       example_count = excluded.example_count,
       updated_at = excluded.updated_at`,
  ).bind(userId, JSON.stringify(profile), exampleCount, now, now).run();
  return now;
}

export async function rebuildDeterministicProfile(DB: D1Database, userId: string) {
  const samples = await loadProfileSamples(DB, userId);
  const profile = buildDeterministicWritingProfile(samples as ProfileSample[]);
  await saveWritingProfile(DB, userId, profile, samples.length);
  return { profile, exampleCount: samples.length };
}

function tokens(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  for (const word of value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) result.add(word);
  return [...result].slice(0, 80);
}

export async function buildWritingStyleContext(
  DB: D1Database,
  userId: string,
  topic: string,
  purpose: "generation" | "profile" = "generation",
) {
  const [profileRow, samples] = await Promise.all([
    DB.prepare("SELECT profile FROM writing_profiles WHERE user_id = ? LIMIT 1").bind(userId).first(),
    loadProfileSamples(DB, userId),
  ]);
  const profile = profileFromRow(profileRow as Record<string, unknown> | null);

  if (purpose === "profile") {
    return {
      profile,
      examples: samples.slice(0, 10).map((sample) => ({
        ...sample,
        content: sample.content.slice(0, 2800),
      })),
    };
  }

  const topicTokens = tokens(topic);
  const ranked = samples.map((sample, index) => {
    const title = sample.title.toLowerCase();
    const tags = sample.tags.toLowerCase();
    const content = sample.content.toLowerCase();
    const score = topicTokens.reduce((total, token) => (
      total + (title.includes(token) ? 8 : 0) + (tags.includes(token) ? 5 : 0) + (content.includes(token) ? 1 : 0)
    ), sample.source === "finalized" ? 5 : Math.max(0, 3 - index));
    return { sample, score };
  }).sort((left, right) => right.score - left.score);

  return {
    profile,
    examples: ranked.slice(0, 3).map(({ sample }) => ({
      title: sample.title,
      tags: sample.tags,
      source: sample.source,
      excerpt: sample.content.slice(0, 1400),
    })),
  } satisfies WritingStyleContext;
}
