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
const TEXT_REQUEST_TIMEOUT_MS = 180_000;
const IMAGE_REQUEST_TIMEOUT_MS = 240_000;
const MAX_ERROR_BODY_CHARACTERS = 4_000;
const MAX_SUCCESS_BODY_CHARACTERS = 4_000_000;

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

function apiEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizedMessage(value: string) {
  return value
    .replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/gi, "sk-***")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function providerMessage(value: unknown) {
  if (!isRecord(value)) return "";
  const nested = isRecord(value.error) ? value.error : undefined;
  const message = nested?.message ?? value.message;
  return typeof message === "string" ? sanitizedMessage(message) : "";
}

async function postProviderJson(
  label: string,
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} 请求超时，请稍后重试`);
    }
    const detail = error instanceof Error ? sanitizedMessage(error.message) : "未知网络错误";
    throw new Error(`${label} 网络请求失败${detail ? `：${detail}` : ""}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${label} API 地址返回跳转，已阻止携带密钥继续请求`);
  }

  const responseText = await response.text();
  if (response.ok && responseText.length > MAX_SUCCESS_BODY_CHARACTERS) {
    throw new Error(`${label} 返回的数据过大`);
  }
  let data: unknown;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      const detail = sanitizedMessage(responseText.slice(0, MAX_ERROR_BODY_CHARACTERS));
      throw new Error(`${label} 返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
    }
    throw new Error(`${label} 返回了无法解析的数据`);
  }

  if (!response.ok) {
    const detail = providerMessage(data);
    throw new Error(`${label} 返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return data;
}

function completionText(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.choices)) return "";
  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  const content = first.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export async function generateCompatibleText(
  config: TextProviderConfig,
  instructions: string,
  input: string,
  maxTokens = 5000,
  jsonMode = false,
) {
  if (!config.apiKey) throw new Error(`尚未配置 ${config.label} API Key`);
  const completion = await postProviderJson(config.label, apiEndpoint(config.baseUrl, "chat/completions"), config.apiKey, {
    model: config.model,
    messages: [
      { role: config.provider === "openai" ? "developer" : "system", content: instructions },
      { role: "user", content: input },
    ],
    ...(config.provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(jsonMode && config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
  }, TEXT_REQUEST_TIMEOUT_MS);
  const content = completionText(completion);
  if (!content.trim()) throw new Error("模型未返回文字内容");
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
  const result = await postProviderJson(config.label, apiEndpoint(config.baseUrl, "images/generations"), config.apiKey, {
    model: config.model,
    prompt,
    size: "1536x1024",
  }, IMAGE_REQUEST_TIMEOUT_MS);
  const image = isRecord(result) && Array.isArray(result.data) && isRecord(result.data[0]) ? result.data[0] : undefined;
  const base64 = typeof image?.b64_json === "string" ? image.b64_json : "";
  const imageUrl = typeof image?.url === "string" ? image.url : "";
  if (base64) {
    if (base64.length > 20_000_000) throw new Error("图片服务返回的文件过大");
    return `data:image/png;base64,${base64}`;
  }
  if (imageUrl) {
    const safeImageUrl = validateBaseUrl(imageUrl, undefined, true);
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
