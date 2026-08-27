import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "墨舟｜微信公众号 AI 创作工作台";
const description =
  "从选题、大纲、正文和配图到人工发布交付包的一站式微信公众号创作工作台。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title,
    description,
    applicationName: "墨舟",
    openGraph: {
      type: "website",
      locale: "zh_CN",
      title,
      description,
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "墨舟——微信公众号 AI 创作工作台，从选题到发布包",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
