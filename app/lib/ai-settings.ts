export type TextProviderId = "openai" | "deepseek" | "kimi" | "custom";
export type ImageProviderId = "openai" | "custom" | "local";

export interface AiSettings {
  textProvider: TextProviderId;
  textModel: string;
  textBaseUrl: string;
  textApiKey: string;
  imageProvider: ImageProviderId;
  imageModel: string;
  imageBaseUrl: string;
  imageApiKey: string;
  rememberKeys: boolean;
}

export const TEXT_PROVIDER_PRESETS: Record<
  TextProviderId,
  { label: string; baseUrl: string; model: string; models: string[] }
> = {
  openai: {
    label: "OpenAI / ChatGPT API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  kimi: {
    label: "Kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k3",
    models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code-highspeed"],
  },
  custom: {
    label: "自定义兼容接口",
    baseUrl: "",
    model: "your-model-name",
    models: [],
  },
};

export const IMAGE_PROVIDER_PRESETS: Record<
  ImageProviderId,
  { label: string; baseUrl: string; model: string }
> = {
  openai: {
    label: "OpenAI 图片 API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-2",
  },
  custom: {
    label: "自定义图片接口",
    baseUrl: "",
    model: "your-image-model",
  },
  local: {
    label: "本地排版图",
    baseUrl: "",
    model: "local-editorial-canvas",
  },
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  textProvider: "openai",
  textModel: TEXT_PROVIDER_PRESETS.openai.model,
  textBaseUrl: TEXT_PROVIDER_PRESETS.openai.baseUrl,
  textApiKey: "",
  imageProvider: "local",
  imageModel: IMAGE_PROVIDER_PRESETS.local.model,
  imageBaseUrl: "",
  imageApiKey: "",
  rememberKeys: false,
};

export function generationHeaders(settings: AiSettings) {
  const sharedOpenAiKey =
    settings.imageProvider === "openai" && settings.textProvider === "openai" ? settings.textApiKey : "";
  return {
    "x-mozhou-text-provider": settings.textProvider,
    "x-mozhou-text-model": settings.textModel.trim(),
    "x-mozhou-text-base-url": settings.textBaseUrl.trim(),
    "x-mozhou-text-api-key": settings.textApiKey.trim(),
    "x-mozhou-image-provider": settings.imageProvider,
    "x-mozhou-image-model": settings.imageModel.trim(),
    "x-mozhou-image-base-url": settings.imageBaseUrl.trim(),
    "x-mozhou-image-api-key": settings.imageApiKey.trim() || sharedOpenAiKey.trim(),
  };
}
