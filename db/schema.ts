import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default(""),
    status: text("status").notNull().default("draft"),
    snapshot: text("snapshot").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_articles_user_updated").on(table.userId, table.updatedAt)],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_assets_user_created").on(table.userId, table.createdAt)],
);

export const writingExamples = sqliteTable(
  "writing_examples",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    tags: text("tags").notNull().default(""),
    source: text("source").notNull().default("paste"),
    characterCount: integer("character_count").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_writing_examples_user_updated").on(table.userId, table.updatedAt),
    uniqueIndex("idx_writing_examples_user_hash").on(table.userId, table.contentHash),
  ],
);

export const writingProfiles = sqliteTable("writing_profiles", {
  userId: text("user_id").primaryKey(),
  profile: text("profile").notNull(),
  exampleCount: integer("example_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
