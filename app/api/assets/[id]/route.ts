import { ensureDatabase, getBindings, getUserId, json } from "../../../lib/storage.server";

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: Context) {
  try {
    const DB = await ensureDatabase();
    const { UPLOADS } = getBindings();
    if (!UPLOADS) return json({ error: "素材存储尚未绑定" }, { status: 503 });
    const userId = getUserId(request.headers);
    const params = await context.params;
    const row = await DB.prepare(
      `SELECT object_key, filename, content_type
       FROM assets WHERE id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(params.id, userId)
      .first();
    if (!row) return json({ error: "素材不存在" }, { status: 404 });
    const object = await UPLOADS.get(String(row.object_key));
    if (!object) return json({ error: "素材文件不存在" }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": String(row.content_type),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(row.filename))}`,
        "cache-control": "private, max-age=31536000, immutable",
        etag: object.httpEtag,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取素材失败" }, { status: 500 });
  }
}

