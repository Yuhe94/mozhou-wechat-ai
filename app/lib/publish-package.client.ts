import { strToU8, zipSync } from "fflate";
import { referenceMaterialText } from "./product-types";
import type { ArticleSnapshot, QualityCheck, ThemeId } from "./product-types";

const themeTokens: Record<ThemeId, { accent: string; ink: string; muted: string; paper: string }> = {
  paper: { accent: "#d95532", ink: "#25231f", muted: "#777067", paper: "#fffdf8" },
  ink: { accent: "#98bd48", ink: "#f5f0e7", muted: "#bbb5ab", paper: "#202423" },
  sage: { accent: "#ae543e", ink: "#24372f", muted: "#697b72", paper: "#f4f8f3" },
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeName(value: string) {
  return value
    .normalize("NFKC")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "墨舟文章";
}

export function articleCharacterCount(snapshot: ArticleSnapshot) {
  return snapshot.sections.reduce(
    (sum, section) => sum + section.heading.length + section.paragraphs.join("").length,
    0,
  );
}

export function getQualityChecks(snapshot: ArticleSnapshot): QualityCheck[] {
  const imageSlots = snapshot.sections.flatMap((section) => (section.imageSlot ? [section.imageSlot] : []));
  const inlineImages = snapshot.images.filter((image) => image.kind === "inline");
  const sources = snapshot.brief.sourcesText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("可粘贴"));
  const count = articleCharacterCount(snapshot);
  const expectedMinimum = Number.parseInt(snapshot.brief.length.match(/\d+/)?.[0] ?? "400", 10);
  const rewriteLength = referenceMaterialText(snapshot.brief).length;
  const importedReferenceCount = snapshot.brief.referenceArticles?.length ?? 0;
  return [
    {
      id: "title",
      label: "标题与摘要",
      detail: !snapshot.title
        ? "缺少文章标题"
        : snapshot.title.length > 32
          ? `标题 ${snapshot.title.length} 字，建议压缩到 32 字以内`
          : `标题 ${snapshot.title.length} 字，摘要 ${snapshot.digest.length} 字`,
      status: !snapshot.title ? "block" : snapshot.title.length > 32 || snapshot.digest.length > 128 ? "warning" : "pass",
    },
    {
      id: "body",
      label: "正文完整性",
      detail:
        count < 400
          ? `当前约 ${count} 字，低于最低 400 字`
          : count < expectedMinimum
            ? `当前约 ${count} 字，尚未达到所选篇幅 ${snapshot.brief.length}`
            : `正文约 ${count} 字，已达到所选篇幅 ${snapshot.brief.length}`,
      status: count < 400 ? "block" : count < expectedMinimum ? "warning" : "pass",
    },
    ...(snapshot.brief.creationMode === "rewrite"
      ? [
          {
            id: "reference",
            label: "参考材料",
            detail:
              rewriteLength >= 100
                ? importedReferenceCount
                  ? `已载入 ${importedReferenceCount} 篇链接文章，共 ${rewriteLength} 字参考材料`
                  : `已保留 ${rewriteLength} 字手动粘贴材料用于人工核对`
                : "参考材料不足 100 字",
            status: rewriteLength >= 100 ? ("pass" as const) : ("block" as const),
          },
        ]
      : []),
    {
      id: "images",
      label: "图片插槽",
      detail: `${imageSlots.length} 个正文插槽，${inlineImages.filter((image) => image.url).length} 张正文图已就绪`,
      status:
        imageSlots.length === 0 ||
        imageSlots.some((slot) => !inlineImages.find((image) => image.slot === slot && image.url)) ||
        !snapshot.images.find((image) => image.kind === "cover" && image.url)
          ? "block"
          : "pass",
    },
    {
      id: "sources",
      label: "来源记录",
      detail: sources.length ? `已记录 ${sources.length} 条参考资料` : "尚未添加可核验来源，发布前请人工复核事实",
      status: sources.length ? "pass" : "warning",
    },
    {
      id: "disclosure",
      label: "AI 辅助标识",
      detail: snapshot.aiDisclosure ? "发布说明包含 AI 辅助生成提示" : "尚未启用 AI 辅助生成提示",
      status: snapshot.aiDisclosure ? "pass" : "warning",
    },
  ];
}

export function buildArticleHtml(snapshot: ArticleSnapshot, includeSlots = true) {
  const token = themeTokens[snapshot.theme];
  const body = snapshot.sections
    .map((section) => {
      const paragraphs = section.paragraphs
        .map(
          (paragraph) =>
            `<p style="margin:0 0 1.15em;font-size:16px;line-height:1.9;letter-spacing:.04em;color:${token.ink};">${escapeHtml(paragraph)}</p>`,
        )
        .join("");
      const slot =
        includeSlots && section.imageSlot
          ? `<section data-image-slot="${section.imageSlot}" style="margin:28px 0;padding:18px;border:1px dashed ${token.accent};border-radius:10px;text-align:center;color:${token.accent};background:${token.paper};"><strong style="font-size:14px;letter-spacing:.12em;">${section.imageSlot}</strong><br><span style="font-size:12px;opacity:.72;">请上传同名图片后删除本提示框</span></section>`
          : "";
      return `<h2 style="margin:2em 0 .8em;padding-left:12px;border-left:4px solid ${token.accent};font-size:22px;line-height:1.45;color:${token.ink};">${escapeHtml(section.heading)}</h2>${paragraphs}${slot}`;
    })
    .join("");

  const disclosure = snapshot.aiDisclosure
    ? `<p style="margin:36px 0 0;font-size:12px;line-height:1.7;color:${token.muted};">本文由 AI 辅助整理与生成，经作者人工编辑与审核。</p>`
    : "";
  return `<section style="max-width:677px;margin:0 auto;padding:8px 4px 40px;background:${token.paper};"><h1 style="margin:0 0 16px;font-size:28px;line-height:1.35;letter-spacing:.02em;color:${token.ink};">${escapeHtml(snapshot.title)}</h1><p style="margin:0 0 28px;padding:14px 16px;border-radius:8px;background:${token.accent}12;font-size:14px;line-height:1.7;color:${token.muted};">${escapeHtml(snapshot.digest)}</p>${body}${disclosure}</section>`;
}

export function buildArticleMarkdown(snapshot: ArticleSnapshot) {
  const sections = snapshot.sections
    .map((section) => {
      const slot = section.imageSlot ? `\n\n> 【${section.imageSlot}】请上传 images/${section.imageSlot}-*.png 后删除此提示。` : "";
      return `## ${section.heading}\n\n${section.paragraphs.join("\n\n")}${slot}`;
    })
    .join("\n\n");
  return `# ${snapshot.title}\n\n> ${snapshot.digest}\n\n${sections}\n\n${snapshot.aiDisclosure ? "_本文由 AI 辅助整理与生成，经作者人工编辑与审核。_\n" : ""}`;
}

export async function copyRichText(snapshot: ArticleSnapshot) {
  const html = buildArticleHtml(snapshot, true);
  const text = buildArticleMarkdown(snapshot);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function exportPublicationPackage(snapshot: ArticleSnapshot) {
  const checks = getQualityChecks(snapshot);
  if (checks.some((check) => check.status === "block")) {
    throw new Error("仍有阻断项，请完成检查后再导出");
  }
  const title = safeName(snapshot.title);
  const date = new Date().toISOString().slice(0, 10);
  const root = `${title}-${date}`;
  const files: Record<string, Uint8Array> = {};
  const inlineImages = snapshot.images.filter((image) => image.kind === "inline");
  const cover = snapshot.images.find((image) => image.kind === "cover");
  const sources = snapshot.brief.sourcesText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("可粘贴"));

  const instructions = `# 发布说明\n\n- 标题：${snapshot.title}\n- 摘要：${snapshot.digest}\n- 封面：03-封面-cover.png\n- 正文图片：${inlineImages.length} 张\n- 文章版本：V${snapshot.version}\n- 生成模式：${snapshot.generationMode === "ai" ? "OpenAI API" : "演示生成"}\n\n## 人工发布步骤\n\n1. 打开 01-正文-含插图位.html，全选并复制正文到微信公众号后台。\n2. 上传 03-封面-cover.png 作为封面。\n3. 从上到下找到 IMG-01、IMG-02 等提示框，上传 images/ 中的同名图片。\n4. 删除图片位置提示框，检查图注、标题和摘要。\n5. 使用微信后台手机预览，确认无误后发布。\n\n## 发布前提醒\n\n- 微信后台的实时字段限制与预览结果优先。\n- 请人工复核数字、人物身份、政策和专业建议。\n${snapshot.aiDisclosure ? "- 已建议保留：本文由 AI 辅助整理与生成，经作者人工编辑与审核。\n" : "- 当前未启用 AI 辅助标识，请确认是否符合适用规则。\n"}`;

  const manifest = `# 插图清单\n\n${inlineImages
    .map((image) => `## ${image.slot}\n\n- 文件：images/${image.filename}\n- 位置：正文 ${image.slot} 提示框\n- 作用：${image.title}\n- 图注：${image.caption || "无"}\n- 来源：${image.source === "ai" ? "AI 生成" : "本地生成"}\n`)
    .join("\n")}`;
  const copyrightCsv = [
    ["类型", "编号/名称", "来源", "说明"],
    ...snapshot.images.map((image) => ["图片", image.slot, image.source === "ai" ? "AI 生成" : "本地生成", image.prompt]),
    ...sources.map((source, index) => ["资料", `SOURCE-${String(index + 1).padStart(2, "0")}`, source, "用户提供"]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  files[`${root}/00-发布说明.md`] = strToU8(instructions);
  files[`${root}/01-正文-含插图位.html`] = strToU8(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title>${buildArticleHtml(snapshot, true)}`);
  files[`${root}/02-正文-纯文本.md`] = strToU8(buildArticleMarkdown(snapshot));
  files[`${root}/04-插图清单.md`] = strToU8(manifest);
  files[`${root}/05-来源与版权清单.csv`] = strToU8(`\uFEFF${copyrightCsv}`);
  if (cover?.url) files[`${root}/03-封面-cover.png`] = await fetchBytes(cover.url);
  for (const image of inlineImages) {
    if (image.url) files[`${root}/images/${image.filename}`] = await fetchBytes(image.url);
  }

  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${root}-发布包.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
