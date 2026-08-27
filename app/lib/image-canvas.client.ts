import type { ThemeId } from "./product-types";

const palettes: Record<ThemeId, { background: string; ink: string; accent: string; soft: string }> = {
  paper: { background: "#F3EBDD", ink: "#1E1D1A", accent: "#E25A36", soft: "#E4D3B8" },
  ink: { background: "#171A19", ink: "#F5F0E8", accent: "#D9FF78", soft: "#303735" },
  sage: { background: "#DDE7DE", ink: "#193029", accent: "#BD573E", soft: "#B8CDBD" },
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    if (ctx.measureText(current + char).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function createEditorialImage(options: {
  title: string;
  subtitle: string;
  kind: "cover" | "inline";
  theme: ThemeId;
  sequence?: number;
}) {
  const width = options.kind === "cover" ? 1200 : 1200;
  const height = options.kind === "cover" ? 500 : 800;
  const palette = palettes[options.theme];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法生成图片");

  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.95;
  ctx.fillStyle = palette.soft;
  ctx.beginPath();
  ctx.arc(width * 0.86, height * 0.18, height * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = palette.accent;
  ctx.fillRect(64, 62, options.kind === "cover" ? 112 : 88, 10);
  ctx.fillRect(width - 112, height - 90, 48, 48);

  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.18;
  for (let x = 64; x < width; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = palette.ink;
  ctx.font = `600 ${options.kind === "cover" ? 64 : 72}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  const lines = wrapText(ctx, options.title, width * 0.68).slice(0, options.kind === "cover" ? 2 : 3);
  const lineHeight = options.kind === "cover" ? 82 : 94;
  const titleY = options.kind === "cover" ? 148 : 210;
  lines.forEach((line, index) => ctx.fillText(line, 64, titleY + index * lineHeight));

  ctx.font = `400 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  ctx.globalAlpha = 0.7;
  ctx.fillText(options.subtitle.slice(0, 36), 68, height - 72);
  ctx.globalAlpha = 1;

  const label = options.kind === "cover" ? "MOZHOU · FEATURE" : `MOZHOU · IMG-${String(options.sequence ?? 1).padStart(2, "0")}`;
  ctx.font = `600 18px ui-monospace, SFMono-Regular, monospace`;
  ctx.fillText(label, width - ctx.measureText(label).width - 66, 70);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片生成失败"))), "image/png", 0.94);
  });
}

