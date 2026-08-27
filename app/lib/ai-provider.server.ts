import OpenAI from "openai";
import {
  IMAGE_PROVIDER_PRESETS,
  TEXT_PROVIDER_PRESETS,
  type ImageProviderId,
  type TextProviderId,
} from "./ai-settings";

export type ProviderEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_TEXT_MODEL?: string;
  KIMI_API_KEY?: string;
  KIMI_TEXT_MODEL?: string;
};

export type TextProviderConfig = {
  provider: TextProviderId;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type ImageProviderConfig = {
  provider: ImageProviderId;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

const TEXT_PROVIDERS = new Set<TextProviderId>(["openai", "deepseek", "kimi", "custom"]);
const IMAGE_PROVIDERS = new Set<ImageProviderId>(["openai", "custom", "local"]);
const KNOWN_HOSTS: Record<Exclude<TextProviderId, "custom"> | "image-openai", string[]> = {
  openai: ["api.openai.com"],
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.ai", "api.moonshot.cn"],
  "image-openai": ["api.openai.com"],
};

function limitedHeader(headers: Headers, name: string, maximum: number) {
  return (headers.get(name) ?? "").trim().slice(0, maximum);
}

function blockedIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const numbers = parts.map(Number);
  const [a, b] = numbers;
  if (numbers.some((part) => part > 255)) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function validateBaseUrl(value: string, allowedHosts?: string[], allowQuery = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("API 地址格式不正确");
  }
  if (url.protocol !== "https:") throw new Error("API 地址必须使用 HTTPS");
  if (url.username || url.password) throw new Error("API 地址不能包含账号或密码");
  if (url.port && url.port !== "443") throw new Error("API 地址不能使用异常端口");
  if (!allowQuery && (url.search || url.hash)) throw new Error("API 地址不能包含查询参数或锚点");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (allowedHosts && !allowedHosts.includes(hostname)) throw new Error("所选服务商的 API 地址与官方域名不匹配");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.includes(":") ||
    blockedIpv4(hostname) ||
    [".localhost", ".local", ".internal", ".home", ".lan", ".test", ".invalid", ".onion"].some((suffix) =>
      hostname.endsWith(suffix),
    )
  ) {
    throw new Error("API 地址必须指向公网服务");
  }
  return url.toString().replace(/\/$/, "");
}

function environmentTextKey(provider: TextProviderId, environment: ProviderEnvironment) {
  if (provider === "openai") return environment.OPENAI_API_KEY ?? "";
  if (provider === "deepseek") return environment.DEEPSEEK_API_KEY ?? "";
  if (provider === "kimi") return environment.KIMI_API_KEY ?? "";
  return "";
}

function environmentTextModel(provider: TextProviderId, environment: ProviderEnvironment) {
  if (provider === "openai") return environment.OPENAI_TEXT_MODEL ?? "";
  if (provider === "deepseek") return environment.DEEPSEEK_TEXT_MODEL ?? "";
  if (provider === "kimi") return environment.KIMI_TEXT_MODEL ?? "";
  return "";
}

export function textProviderConfig(headers: Headers, environment: ProviderEnvironment): TextProviderConfig {
  const requested = limitedHeader(headers, "x-mozhou-text-provider", 24) || "openai";
  if (!TEXT_PROVIDERS.has(requested as TextProviderId)) throw new Error("不支持所选写作服务");
  const provider = requested as TextProviderId;
  const preset = TEXT_PROVIDER_PRESETS[provider];
  const rawBaseUrl = limitedHeader(headers, "x-mozhou-text-base-url", 500) || preset.baseUrl;
  const allowedHosts = provider === "custom" ? undefined : KNOWN_HOSTS[provider];
  return {
    provider,
    label: preset.label,
    apiKey: limitedHeader(headers, "x-mozhou-text-api-key", 1000) || environmentTextKey(provider, environment),
    baseUrl: validateBaseUrl(rawBaseUrl, allowedHosts),
    model:
      limitedHeader(headers, "x-mozhou-text-model", 160) || environmentTextModel(provider, environment) || preset.model,
  };
}

export function imageProviderConfig(headers: Headers, environment: ProviderEnvironment): ImageProviderConfig {
  const requested = limitedHeader(headers, "x-mozhou-image-provider", 24) || "openai";
  if (!IMAGE_PROVIDERS.has(requested as ImageProviderId)) throw new Error("不支持所选配图服务");
  const provider = requested as ImageProviderId;
  const preset = IMAGE_PROVIDER_PRESETS[provider];
  if (provider === "local") {
    return { provider, label: preset.label, apiKey: "", baseUrl: "", model: preset.model };
  }
  const rawBaseUrl = limitedHeader(headers, "x-mozhou-image-base-url", 500) || preset.baseUrl;
  return {
    provider,
    label: preset.label,
    apiKey:
      limitedHeader(headers, "x-mozhou-image-api-key", 1000) || (provider === "openai" ? environment.OPENAI_API_KEY ?? "" : ""),
    baseUrl: validateBaseUrl(rawBaseUrl, provider === "openai" ? KNOWN_HOSTS["image-openai"] : undefined),
    model:
      limitedHeader(headers, "x-mozhou-image-model", 160) ||
      (provider === "openai" ? environment.OPENAI_IMAGE_MODEL ?? "" : "") ||
      preset.model,
  };
}

export async function generateCompatibleText(
  config: TextProviderConfig,
  instructions: string,
  input: string,
  maxTokens = 5000,
) {
  if (!config.apiKey) throw new Error(`尚未配置 ${config.label} API Key`);
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, fetch: noRedirectFetch });
  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: config.provider === "openai" ? "developer" : "system", content: instructions },
      { role: "user", content: input },
    ],
    ...(config.provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
  });
  const content = completion.choices[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型未返回文字内容");
  return content;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function generateCompatibleImage(config: ImageProviderConfig, prompt: string) {
  if (config.provider === "local") return null;
  if (!config.apiKey) throw new Error(`尚未配置 ${config.label} API Key`);
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, fetch: noRedirectFetch });
  const result = await client.images.generate({
    model: config.model,
    prompt,
    size: "1536x1024",
  });
  const image = result.data?.[0];
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  if (image?.url) {
    const safeImageUrl = validateBaseUrl(image.url, undefined, true);
    const response = await fetch(safeImageUrl, { redirect: "error" });
    if (!response.ok) throw new Error("图片服务返回的文件无法下载");
    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) throw new Error("图片服务返回了非图片内容");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 15_000_000) throw new Error("图片服务返回的文件过大");
    return `data:${contentType};base64,${bytesToBase64(bytes)}`;
  }
  throw new Error("图片服务未返回图像数据");
}

const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });
