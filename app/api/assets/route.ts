import {
  ensureDatabase,
  getBindings,
  getUserId,
  json,
  safeFilename,
} from "../../lib/storage.server";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const DB = await ensureDatabase();
    const { UPLOADS } = getBindings();
    if (!UPLOADS) return json({ error: "素材存储尚未绑定" }, { status: 503 });
    const userId = getUserId(request.headers);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "请选择文件" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return json({ error: "文件不能超过 10 MB" }, { status: 413 });

    const id = crypto.randomUUID();
    const filename = safeFilename(file.name);
    const key = `${userId}/${id}-${filename}`;
    const now = new Date().toISOString();
    await UPLOADS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { owner: userId, originalName: filename },
    });
    await DB.prepare(
      `INSERT INTO assets
       (id, user_id, object_key, filename, content_type, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, userId, key, filename, file.type || "application/octet-stream", file.size, now)
      .run();
    return json({
      id,
      filename,
      contentType: file.type,
      size: file.size,
      url: `/api/assets/${id}`,
      createdAt: now,
    }, { status: 201 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 500 });
  }
}

