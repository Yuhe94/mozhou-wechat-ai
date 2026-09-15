"use client";

/* eslint-disable @next/next/no-img-element -- Editor previews intentionally render user-provided blob and R2 URLs. */

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Flame,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Newspaper,
  PenLine,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditorialImage } from "./lib/image-canvas.client";
import { looksLikeInternalWorkingDraft } from "./lib/article-draft";
import {
  DEFAULT_AI_SETTINGS,
  generationHeaders,
  IMAGE_PROVIDER_PRESETS,
  TEXT_PROVIDER_PRESETS,
  type AiSettings,
  type ImageProviderId,
  type NewsRegionId,
  type NewsSearchProviderId,
  type TextProviderId,
} from "./lib/ai-settings";
import {
  articleCharacterCount,
  buildArticleHtml,
  copyRichText,
  exportPublicationPackage,
  getQualityChecks,
} from "./lib/publish-package.client";
import {
  createBlankSnapshot,
  referenceMaterialText,
  WORKFLOW_STEPS,
  type ArticleSnapshot,
  type CreationMode,
  type GeneratedImage,
  type Hotspot,
  type OutlineItem,
  type ReferenceArticle,
  type ResearchPlan,
  type ResearchReport,
  type ResearchSource,
  type StoredArticle,
  type ThemeId,
  type TopicAngle,
  type WritingExample,
  type WritingExampleSource,
  type WritingProfile,
  type WritingStyleContext,
  type WorkflowStep,
} from "./lib/product-types";

type SaveState = "loading" | "saving" | "saved" | "offline";
type HotspotState = "idle" | "loading" | "loaded" | "error";
type ReferenceImportError = { url: string; error: string };
type ProviderTestState = { status: "idle" | "testing" | "success" | "error"; text: string };
type StyleLibraryData = {
  examples: WritingExample[];
  profile: WritingProfile | null;
  exampleCount: number;
  profileUpdatedAt: string | null;
};
type NewWritingExample = {
  title: string;
  content: string;
  tags: string;
  source: WritingExampleSource;
};

type GenerationErrorPayload = {
  error?: string;
  code?: "AI_KEY_REQUIRED" | "AI_DRAFT_FAILED";
  researchSources?: ResearchSource[];
  researchReport?: ResearchReport;
};

class GenerationRequestError extends Error {
  payload: GenerationErrorPayload;

  constructor(message: string, payload: GenerationErrorPayload) {
    super(message);
    this.name = "GenerationRequestError";
    this.payload = payload;
  }
}

const EMPTY_STYLE_LIBRARY: StyleLibraryData = {
  examples: [],
  profile: null,
  exampleCount: 0,
  profileUpdatedAt: null,
};

const stepOrder = WORKFLOW_STEPS.map((step) => step.id);
const AI_SETTINGS_KEY = "mozhou-ai-settings-v1";
const AI_SECRETS_KEY = "mozhou-ai-secrets-v1";

function loadAiSettings() {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(AI_SETTINGS_KEY) || "{}") as Partial<AiSettings>;
    const textProvider = stored.textProvider && stored.textProvider in TEXT_PROVIDER_PRESETS ? stored.textProvider : "openai";
    const imageProvider = stored.imageProvider && stored.imageProvider in IMAGE_PROVIDER_PRESETS ? stored.imageProvider : "local";
    const base = { ...DEFAULT_AI_SETTINGS, ...stored, textProvider, imageProvider };
    const secretStore = base.rememberKeys ? window.localStorage : window.sessionStorage;
    const secrets = JSON.parse(secretStore.getItem(AI_SECRETS_KEY) || "{}") as Partial<AiSettings>;
    return {
      ...base,
      textApiKey: secrets.textApiKey || "",
      imageApiKey: secrets.imageApiKey || "",
      newsSearchApiKey: secrets.newsSearchApiKey || "",
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function storeAiSettings(settings: AiSettings) {
  const publicSettings = { ...settings, textApiKey: "", imageApiKey: "", newsSearchApiKey: "" };
  window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(publicSettings));
  const secrets = JSON.stringify({
    textApiKey: settings.textApiKey,
    imageApiKey: settings.imageApiKey,
    newsSearchApiKey: settings.newsSearchApiKey,
  });
  if (settings.rememberKeys) {
    window.localStorage.setItem(AI_SECRETS_KEY, secrets);
    window.sessionStorage.removeItem(AI_SECRETS_KEY);
  } else {
    window.sessionStorage.setItem(AI_SECRETS_KEY, secrets);
    window.localStorage.removeItem(AI_SECRETS_KEY);
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getStepMax(snapshot: ArticleSnapshot) {
  if (snapshot.sections.length) return snapshot.images.length ? 5 : 4;
  if (snapshot.outline.length) return 3;
  if (snapshot.topics.length) return 2;
  return 1;
}

function editableModuleId(prefix: "research" | "section") {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function fileToBlob(dataUrl: string) {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function uploadBlob(blob: Blob, filename: string) {
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: blob.type || "image/png" }));
  const response = await fetch("/api/assets", { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error || "图片保存失败");
  return (await response.json()) as { url: string };
}

function selectedAngle(snapshot: ArticleSnapshot) {
  return snapshot.topics.find((topic) => topic.id === snapshot.selectedTopicId) ?? snapshot.topics[0];
}

function resetGeneratedContent(
  snapshot: ArticleSnapshot,
  brief: ArticleSnapshot["brief"],
): ArticleSnapshot {
  return {
    ...snapshot,
    brief,
    topics: [],
    selectedTopicId: null,
    researchPlan: undefined,
    outline: [],
    researchSources: [],
    researchReport: undefined,
    title: "",
    digest: "",
    sections: [],
    images: [],
    step: "brief",
    generationMode: "demo",
  };
}

function withoutNonPublishableDraft(snapshot: ArticleSnapshot): ArticleSnapshot {
  const placeholder = snapshot.generationMode === "demo" && (
    /正式动笔前，还需要补齐这些事实/.test(snapshot.title)
    || /按照背景、核心问题、现实影响和后续判断四个层次/.test(snapshot.digest)
  );
  if (!placeholder && !looksLikeInternalWorkingDraft(snapshot)) return snapshot;
  return {
    ...snapshot,
    title: "",
    digest: "",
    sections: [],
    images: [],
    step: snapshot.outline.length ? "outline" : "brief",
  };
}

export default function Workspace({ displayName }: { displayName: string }) {
  const [snapshot, setSnapshot] = useState<ArticleSnapshot>(() => createBlankSnapshot());
  const [articleId, setArticleId] = useState<string | null>(null);
  const [articles, setArticles] = useState<StoredArticle[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [hotspotState, setHotspotState] = useState<HotspotState>("idle");
  const [hotspotUpdatedAt, setHotspotUpdatedAt] = useState<string | null>(null);
  const [referenceErrors, setReferenceErrors] = useState<ReferenceImportError[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerTest, setProviderTest] = useState<ProviderTestState>({ status: "idle", text: "" });
  const [styleLibrary, setStyleLibrary] = useState<StyleLibraryData>(EMPTY_STYLE_LIBRARY);
  const [styleLibraryOpen, setStyleLibraryOpen] = useState(false);
  const [styleBusy, setStyleBusy] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxStep = getStepMax(snapshot);
  const angle = selectedAngle(snapshot);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadAiSettings();
      setAiSettings(loaded);
      setSettingsDraft(loaded);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const updateSnapshot = useCallback((updater: (current: ArticleSnapshot) => ArticleSnapshot) => {
    setSnapshot((current) => ({
      ...updater(current),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/articles", { cache: "no-store" });
        if (!response.ok) throw new Error("无法连接内容存储");
        const data = (await response.json()) as { articles: StoredArticle[] };
        if (cancelled) return;
        setArticles(data.articles);
        if (data.articles[0]) {
          setArticleId(data.articles[0].id);
          setSnapshot(withoutNonPublishableDraft(data.articles[0].snapshot));
        } else {
          const initial = { ...createBlankSnapshot(), updatedAt: new Date().toISOString() };
          const created = await fetch("/api/articles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "AI 内容工作流", snapshot: initial }),
          });
          if (!created.ok) throw new Error("无法创建首篇文章");
          const article = (await created.json()) as StoredArticle;
          setArticleId(article.id);
          setArticles([article]);
          setSnapshot(article.snapshot);
        }
        setSaveState("saved");
      } catch {
        setSaveState("offline");
        setNotice({ type: "error", text: "已进入本地演示模式；刷新前请先导出发布包。" });
      } finally {
        setHydrated(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !articleId) return;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const response = await fetch(`/api/articles/${articleId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: snapshot.title || snapshot.brief.topic || "未命名文章",
            status: snapshot.step === "check" ? "ready" : "draft",
            snapshot,
          }),
        });
        if (!response.ok) throw new Error("保存失败");
        setSaveState("saved");
        setArticles((current) =>
          current.map((item) =>
            item.id === articleId
              ? { ...item, title: snapshot.title || snapshot.brief.topic, snapshot, updatedAt: snapshot.updatedAt }
              : item,
          ),
        );
      } catch {
        setSaveState("offline");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [articleId, hydrated, snapshot]);

  const runGeneration = async <T,>(payload: unknown) => {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", ...generationHeaders(aiSettings) },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({})) as T & GenerationErrorPayload;
    if (!response.ok) throw new GenerationRequestError(data.error || "生成失败", data);
    return data as T;
  };

  const loadStyleLibrary = useCallback(async () => {
    const response = await fetch("/api/style-library", { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error || "无法读取范例库");
    const data = (await response.json()) as StyleLibraryData;
    setStyleLibrary(data);
    return data;
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadStyleLibrary().catch(() => undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadStyleLibrary]);

  const loadWritingStyleContext = async (topic: string): Promise<WritingStyleContext> => {
    try {
      const response = await fetch(`/api/style-library/context?topic=${encodeURIComponent(topic)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("读取风格失败");
      return (await response.json()) as WritingStyleContext;
    } catch {
      return { profile: styleLibrary.profile, examples: [] };
    }
  };

  const summarizeStyleProfile = async () => {
    const contextResponse = await fetch("/api/style-library/context?purpose=profile", { cache: "no-store" });
    if (!contextResponse.ok) throw new Error("无法读取风格样本");
    const context = (await contextResponse.json()) as {
      examples: Array<{ title: string; content: string; tags: string }>;
    };
    if (!context.examples.length) throw new Error("请先收录至少一篇范文");
    const generated = await runGeneration<{
      profile: WritingProfile;
      warning?: string;
    }>({ action: "style-profile", samples: context.examples });
    const saved = await fetch("/api/style-library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: generated.profile }),
    });
    if (!saved.ok) throw new Error((await saved.json()).error || "风格画像保存失败");
    const data = (await saved.json()) as Pick<StyleLibraryData, "profile" | "exampleCount" | "profileUpdatedAt">;
    setStyleLibrary((current) => ({ ...current, ...data }));
    return generated.warning;
  };

  const refreshStyleProfile = async () => {
    setStyleBusy("profile");
    try {
      const warning = await summarizeStyleProfile();
      setNotice({ type: "success", text: warning || "已用当前写作模型重新总结个人写作画像。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "风格画像总结失败" });
    } finally {
      setStyleBusy(null);
    }
  };

  const addWritingExample = async (example: NewWritingExample) => {
    setStyleBusy("add");
    try {
      const response = await fetch("/api/style-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(example),
      });
      if (!response.ok) throw new Error((await response.json()).error || "范文收录失败");
      const library = (await response.json()) as StyleLibraryData;
      setStyleLibrary(library);
      let warning: string | undefined;
      try {
        warning = await summarizeStyleProfile();
      } catch {
        warning = "范文已收录，并已生成本地风格画像；可稍后使用当前模型深度总结。";
      }
      setNotice({ type: "success", text: warning || `范文已收录，写作画像已更新为 ${library.exampleCount} 篇样本。` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "范文收录失败" });
    } finally {
      setStyleBusy(null);
    }
  };

  const deleteWritingExample = async (id: string) => {
    setStyleBusy(id);
    try {
      const response = await fetch(`/api/style-library/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error || "删除失败");
      setStyleLibrary((await response.json()) as StyleLibraryData);
      setNotice({ type: "success", text: "范文已移除，写作画像已重新计算。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "删除范文失败" });
    } finally {
      setStyleBusy(null);
    }
  };

  const addCurrentDraftToStyleLibrary = async () => {
    const content = [
      snapshot.title,
      snapshot.digest,
      ...snapshot.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ].filter(Boolean).join("\n\n");
    await addWritingExample({
      title: snapshot.title || snapshot.brief.topic || "当前定稿",
      content,
      tags: snapshot.brief.topic,
      source: "finalized",
    });
  };

  const openAiSettings = () => {
    setSettingsDraft(aiSettings);
    setProviderTest({ status: "idle", text: "" });
    setSettingsOpen(true);
    setMobileNav(false);
  };

  const saveAiSettings = () => {
    if (!settingsDraft.textBaseUrl.trim() || !settingsDraft.textModel.trim()) {
      setProviderTest({ status: "error", text: "请填写写作 API 地址和模型名称" });
      return;
    }
    if (
      settingsDraft.imageProvider !== "local" &&
      (!settingsDraft.imageBaseUrl.trim() || !settingsDraft.imageModel.trim())
    ) {
      setProviderTest({ status: "error", text: "请填写图片 API 地址和模型名称" });
      return;
    }
    if (settingsDraft.newsSearchProvider === "brave" && !settingsDraft.newsSearchApiKey.trim()) {
      setProviderTest({ status: "error", text: "选择 Brave News 时需要填写 Brave Search API Key" });
      return;
    }
    storeAiSettings(settingsDraft);
    setAiSettings(settingsDraft);
    setSettingsOpen(false);
    const newsMode = settingsDraft.newsSearchProvider === "brave" ? "Brave News + 区域官方源" : settingsDraft.newsSearchProvider === "public" ? "区域官方源 + GDELT" : "自动分层检索";
    setNotice({ type: "success", text: `已保存：${TEXT_PROVIDER_PRESETS[settingsDraft.textProvider].label} · ${newsMode}` });
  };

  const testProviderConnection = async () => {
    setProviderTest({ status: "testing", text: "正在发送最小测试请求…" });
    try {
      const response = await fetch("/api/provider-test", {
        method: "POST",
        headers: { "content-type": "application/json", ...generationHeaders(settingsDraft) },
        body: "{}",
      });
      const data = (await response.json()) as { ok?: boolean; provider?: string; model?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "连接测试失败");
      setProviderTest({ status: "success", text: `${data.provider} · ${data.model} 连接正常` });
    } catch (error) {
      setProviderTest({ status: "error", text: error instanceof Error ? error.message : "连接测试失败" });
    }
  };

  const loadHotspots = useCallback(async () => {
    setHotspotState("loading");
    try {
      const response = await fetch("/api/hotspots", { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "热点获取失败");
      const data = (await response.json()) as { hotspots: Hotspot[]; fetchedAt: string };
      setHotspots(data.hotspots);
      setHotspotUpdatedAt(data.fetchedAt);
      setHotspotState("loaded");
    } catch (error) {
      setHotspotState("error");
      setNotice({ type: "error", text: error instanceof Error ? error.message : "暂时无法获取社会热点" });
    }
  }, []);

  const setCreationMode = (mode: CreationMode) => {
    updateSnapshot((current) =>
      resetGeneratedContent(current, { ...current.brief, creationMode: mode }),
    );
    if (mode === "hotspot" && hotspotState === "idle") void loadHotspots();
  };

  const chooseHotspot = (hotspot: Hotspot) => {
    updateSnapshot((current) => {
      const sourceLine = `热点来源：${hotspot.source}｜${hotspot.url}`;
      const summaryLine = hotspot.summary.trim() ? `热点摘要：${hotspot.summary.trim()}` : "";
      const retainedSources = current.brief.sourcesText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("可粘贴") && !line.startsWith("热点来源：") && !line.startsWith("热点摘要："));
      const brief = {
        ...current.brief,
        creationMode: "hotspot" as const,
        topic: hotspot.title,
        audience: "关注该热点及其影响的普通读者",
        goal: `帮助读者理解「${hotspot.title}」的已知信息、背景和关注价值`,
        callToAction: "引导读者核对可靠来源，并基于已知信息形成理性判断",
        sourcesText: [summaryLine, sourceLine, ...retainedSources].filter(Boolean).join("\n"),
      };
      return resetGeneratedContent(current, brief);
    });
    setNotice({ type: "success", text: `已选择热点「${hotspot.title}」，可继续补充你的观点。` });
  };

  const importReferenceArticles = async () => {
    const urls = (snapshot.brief.referenceUrls ?? "")
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!urls.length) {
      setNotice({ type: "error", text: "请先粘贴至少一个公开文章链接。" });
      return;
    }
    setReferenceErrors([]);
    setBusy("references");
    try {
      const response = await fetch("/api/reference-articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = (await response.json()) as {
        articles?: ReferenceArticle[];
        errors?: ReferenceImportError[];
        error?: string;
      };
      setReferenceErrors(data.errors ?? []);
      if (!response.ok || !data.articles?.length) throw new Error(data.error || "未能读取文章链接");
      updateSnapshot((current) => {
        const references = [...(current.brief.referenceArticles ?? []), ...data.articles!];
        const referenceArticles = [...new Map(references.map((article) => [article.url, article])).values()].slice(0, 5);
        const existingSources = current.brief.sourcesText.startsWith("可粘贴") ? [] : current.brief.sourcesText.split("\n").filter(Boolean);
        const importedSources = data.articles!.map((article) => `链接参考：${article.title}｜${article.account}｜${article.url}`);
        return resetGeneratedContent(current, {
            ...current.brief,
            creationMode: "rewrite",
            referenceArticles,
            referenceUrls: [
              ...referenceArticles.map((article) => article.url),
              ...(data.errors ?? []).map((item) => item.url),
            ].join("\n"),
            sourcesText: [...new Set([...existingSources, ...importedSources])].join("\n"),
          });
      });
      const failed = data.errors?.length ?? 0;
      setNotice({
        type: "success",
        text: failed
          ? `成功读取 ${data.articles.length} 篇，另有 ${failed} 篇受限或已失效。`
          : `已读取 ${data.articles.length} 篇公开文章，并加入本次改写参考。`,
      });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "文章链接读取失败" });
    } finally {
      setBusy(null);
    }
  };

  const removeReferenceArticle = (url: string) => {
    updateSnapshot((current) =>
      resetGeneratedContent(current, {
        ...current.brief,
        referenceArticles: (current.brief.referenceArticles ?? []).filter((article) => article.url !== url),
        referenceUrls: (current.brief.referenceUrls ?? "")
          .split("\n")
          .filter((line) => !line.includes(url))
          .join("\n"),
        sourcesText: current.brief.sourcesText
          .split("\n")
          .filter((line) => !line.includes(url))
          .join("\n"),
      }),
    );
  };

  const generateTopics = async () => {
    const mode = snapshot.brief.creationMode ?? "original";
    if (mode === "rewrite" && referenceMaterialText(snapshot.brief).length < 100) {
      setNotice({ type: "error", text: "请先粘贴至少 100 字的参考正文，或读取足量的公开文章内容。" });
      return;
    }
    if (mode !== "rewrite" && !snapshot.brief.topic.trim()) {
      setNotice({ type: "error", text: "先写下一个明确主题，再生成研究角度。" });
      return;
    }
    setBusy("topics");
    try {
      const styleContext = await loadWritingStyleContext(snapshot.brief.topic || referenceMaterialText(snapshot.brief).slice(0, 120));
      const data = await runGeneration<{ mode: "ai" | "demo"; topics: TopicAngle[]; warning?: string }>({
        action: "topics",
        brief: snapshot.brief,
        styleContext,
      });
      updateSnapshot((current) => ({
        ...current,
        topics: data.topics,
        selectedTopicId: data.topics[0]?.id ?? null,
        researchPlan: undefined,
        outline: [],
        researchSources: [],
        researchReport: undefined,
        title: "",
        digest: "",
        sections: [],
        images: [],
        step: "topics",
        generationMode: data.mode,
      }));
      setNotice({ type: "success", text: data.warning || "已生成 3 个内部研究角度；它们不是文章标题。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "研究角度生成失败" });
    } finally {
      setBusy(null);
    }
  };

  const generateOutline = async () => {
    if (!angle) return;
    setBusy("outline");
    try {
      const styleContext = await loadWritingStyleContext(`${snapshot.brief.topic} ${angle.title}`);
      const data = await runGeneration<{ mode: "ai" | "demo"; researchPlan?: ResearchPlan; outline: OutlineItem[]; warning?: string }>({
        action: "outline",
        brief: snapshot.brief,
        angle,
        styleContext,
      });
      updateSnapshot((current) => ({
        ...current,
        researchPlan: data.researchPlan,
        outline: data.outline,
        researchSources: [],
        researchReport: undefined,
        step: "outline",
        generationMode: data.mode,
      }));
      setNotice({ type: "success", text: data.warning || "研究提纲已生成，可以修改问题、证据和联网检索词。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "研究提纲生成失败" });
    } finally {
      setBusy(null);
    }
  };

  const generateDraft = async () => {
    if (!angle || !snapshot.outline.length) return;
    setBusy("draft");
    try {
      const styleContext = await loadWritingStyleContext(`${snapshot.brief.topic} ${angle.title}`);
      const data = await runGeneration<{
        mode: "ai" | "demo";
        editorPass?: "final" | "working-draft";
        researchMode?: "online" | "brief-only" | "insufficient";
        needsResearch?: boolean;
        draft?: Pick<ArticleSnapshot, "title" | "digest" | "sections">;
        researchSources?: ResearchSource[];
        researchReport?: ResearchReport;
        warning?: string;
      }>({ action: "draft", brief: snapshot.brief, angle, researchPlan: snapshot.researchPlan, outline: snapshot.outline, styleContext });
      if (data.needsResearch || !data.draft) {
        updateSnapshot((current) => ({
          ...current,
          researchSources: data.researchSources ?? [],
          researchReport: data.researchReport,
          step: "outline",
          generationMode: data.mode,
        }));
        setNotice({ type: "error", text: data.warning || "资料不足，本次没有生成正文。" });
        return;
      }
      updateSnapshot((current) => ({
        ...current,
        ...data.draft,
        researchSources: data.researchSources ?? [],
        researchReport: data.researchReport,
        images: [],
        step: "draft",
        generationMode: data.mode,
      }));
      setNotice({
        type: data.editorPass === "working-draft" || data.researchMode === "brief-only" ? "error" : "success",
        text: data.warning || "双轮编辑已完成：作者工作稿已重写为面向读者的成稿。",
      });
    } catch (error) {
      if (error instanceof GenerationRequestError) {
        if (error.payload.researchSources?.length || error.payload.researchReport) {
          updateSnapshot((current) => ({
            ...withoutNonPublishableDraft(current),
            researchSources: error.payload.researchSources ?? current.researchSources,
            researchReport: error.payload.researchReport ?? current.researchReport,
            step: "outline",
          }));
        }
        if (error.payload.code === "AI_KEY_REQUIRED") {
          updateSnapshot((current) => withoutNonPublishableDraft(current));
          setSettingsDraft(aiSettings);
          setProviderTest({ status: "idle", text: "" });
          setSettingsOpen(true);
        }
      }
      setNotice({ type: "error", text: error instanceof Error ? error.message : "正文生成失败" });
    } finally {
      setBusy(null);
    }
  };

  const createAndStoreImage = async (image: Omit<GeneratedImage, "url" | "source">, index: number) => {
    const api = await runGeneration<{ mode: "ai" | "demo"; dataUrl: string | null; warning?: string }>({
      action: "image",
      prompt: image.prompt,
      kind: image.kind,
    });
    const blob = api.dataUrl
      ? fileToBlob(api.dataUrl)
      : await createEditorialImage({
          title: image.title,
          subtitle: image.kind === "cover" ? snapshot.digest : image.caption,
          kind: image.kind,
          theme: snapshot.theme,
          sequence: index,
        });
    try {
      const stored = await uploadBlob(blob, image.filename);
      return {
        asset: { ...image, url: stored.url, source: api.mode === "ai" ? "ai" : "local" } as GeneratedImage,
        warning: api.warning,
      };
    } catch {
      return {
        asset: { ...image, url: URL.createObjectURL(blob), source: api.mode === "ai" ? "ai" : "local" } as GeneratedImage,
        warning: api.warning,
      };
    }
  };

  const generateImages = async () => {
    if (!snapshot.sections.length) return;
    setBusy("images");
    try {
      const seenInlineSlots = new Set<string>();
      const inlinePlans: Array<Omit<GeneratedImage, "url" | "source">> = snapshot.sections
        .filter((section) => {
          if (!section.imageSlot || seenInlineSlots.has(section.imageSlot)) return false;
          seenInlineSlots.add(section.imageSlot);
          return true;
        })
        .map((section) => ({
          id: section.imageSlot!.toLowerCase(),
          slot: section.imageSlot!,
          kind: "inline" as const,
          filename: `${section.imageSlot}-${(section.heading.trim() || snapshot.brief.topic).slice(0, 12).replace(/\s+/g, "-")}.png`,
          title: section.heading.trim() || snapshot.brief.topic,
          caption: `配图：${section.heading.trim() || snapshot.brief.topic}`,
          prompt: `微信公众号正文插图，表达“${section.heading.trim() || snapshot.brief.topic}”。围绕${snapshot.brief.topic}，${snapshot.brief.tone}，不出现文字。`,
        }));
      const planned: Array<Omit<GeneratedImage, "url" | "source">> = [
        {
          id: "cover",
          slot: "COVER",
          kind: "cover",
          filename: "cover.png",
          title: snapshot.title,
          caption: "文章封面",
          prompt: `编辑设计风格的公众号封面，主题为：${snapshot.title}。${snapshot.brief.tone}，留白充足，具有清晰的视觉中心。`,
        },
        ...inlinePlans,
      ];
      const results = await Promise.all(planned.map((image, index) => createAndStoreImage(image, index)));
      const generated = results.map((result) => result.asset);
      const warning = results.find((result) => result.warning)?.warning;
      updateSnapshot((current) => ({ ...current, images: generated, step: "visuals" }));
      setNotice({ type: "success", text: warning || `封面和 ${generated.length - 1} 张正文图已就绪。` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "配图生成失败" });
    } finally {
      setBusy(null);
    }
  };

  const createNewArticle = async () => {
    const next = createBlankSnapshot();
    setBusy("new");
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next.brief.topic, snapshot: next }),
      });
      if (!response.ok) throw new Error("创建失败");
      const article = (await response.json()) as StoredArticle;
      setArticles((current) => [article, ...current]);
      setArticleId(article.id);
      setSnapshot(article.snapshot);
      setNotice({ type: "success", text: "已创建一篇新文章。" });
    } catch {
      setArticleId(null);
      setSnapshot(next);
      setNotice({ type: "error", text: "已创建本地草稿，当前不会自动保存。" });
    } finally {
      setBusy(null);
    }
  };

  const openArticle = (article: StoredArticle) => {
    setArticleId(article.id);
    setSnapshot(withoutNonPublishableDraft(article.snapshot));
    setMobileNav(false);
  };

  const moveOutline = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= snapshot.outline.length) return;
    updateSnapshot((current) => {
      const next = [...current.outline];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, outline: next };
    });
  };

  const handleSourceFile = async (file: File) => {
    setBusy("upload");
    try {
      let extracted = "";
      if (/\.(md|txt)$/i.test(file.name) || file.type.startsWith("text/")) extracted = await file.text();
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).error || "上传失败");
      updateSnapshot((current) =>
        resetGeneratedContent(current, {
          ...current.brief,
          sourcesText: [
            current.brief.sourcesText.startsWith("可粘贴") ? "" : current.brief.sourcesText,
            `文件：${file.name}`,
            extracted.slice(0, 12000),
          ]
            .filter(Boolean)
            .join("\n"),
        }),
      );
      setNotice({ type: "success", text: `${file.name} 已加入参考资料。` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "资料上传失败" });
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const checks = useMemo(() => getQualityChecks(snapshot), [snapshot]);
  const canExport = !checks.some((check) => check.status === "block");

  const handleCopy = async () => {
    try {
      await copyRichText(snapshot);
      setNotice({ type: "success", text: "公众号富文本已复制，图片插槽会保留。" });
    } catch {
      setNotice({ type: "error", text: "复制失败，请使用导出发布包。" });
    }
  };

  const handleExport = async () => {
    setBusy("export");
    try {
      await exportPublicationPackage(snapshot);
      setNotice({ type: "success", text: "发布交付包已下载。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "导出失败" });
    } finally {
      setBusy(null);
    }
  };

  const setStep = (step: WorkflowStep) => {
    const index = stepOrder.indexOf(step);
    if (index <= maxStep) {
      setSnapshot((current) => ({ ...current, step }));
      setMobileNav(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="打开导航">
            <Menu size={19} />
          </button>
          <div className="brand-mark" aria-hidden="true">墨</div>
          <div className="brand-copy">
            <strong>墨舟</strong>
            <span>微信公众号 AI 创作工作台</span>
          </div>
          <div className="workspace-switcher">
            <span className="workspace-avatar">M</span>
            <span>我的创作空间</span>
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="topbar-actions">
          <button className="model-status-button" onClick={openAiSettings} aria-label="打开 AI 模型设置">
            <Sparkles size={14} />
            <span><strong>{TEXT_PROVIDER_PRESETS[aiSettings.textProvider].label}</strong><small>{aiSettings.textModel}</small></span>
          </button>
          <span className={`save-state save-${saveState}`}>
            {saveState === "saving" && <LoaderCircle size={13} className="spin" />}
            {saveState === "saved" && <CircleCheck size={13} />}
            {saveState === "offline" && <CircleAlert size={13} />}
            {saveState === "loading" ? "正在载入" : saveState === "saving" ? "正在保存" : saveState === "saved" ? "已自动保存" : "本地演示"}
          </span>
          <button className="button secondary compact" onClick={() => setStep("check")} disabled={!snapshot.sections.length}>
            <CheckCircle2 size={16} /> 发布检查
          </button>
          <button className="button primary compact" onClick={handleExport} disabled={!canExport || busy === "export"}>
            {busy === "export" ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
            导出发布包
          </button>
          <div className="user-avatar" title={displayName}>{displayName.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>

      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="mobile-sidebar-head mobile-only">
          <strong>创作流程</strong>
          <button className="icon-button" onClick={() => setMobileNav(false)} aria-label="关闭导航"><X size={19} /></button>
        </div>
        <button className="button new-article" onClick={createNewArticle} disabled={busy === "new"}>
          <Plus size={17} /> 新建文章
        </button>
        <nav className="workflow-nav" aria-label="文章创作流程">
          <p className="nav-eyebrow">当前文章</p>
          {WORKFLOW_STEPS.map((item, index) => {
            const active = snapshot.step === item.id;
            const accessible = index <= maxStep;
            const complete = index < stepOrder.indexOf(snapshot.step) || (index < maxStep && !active);
            return (
              <button
                key={item.id}
                className={`workflow-item ${active ? "active" : ""} ${accessible ? "" : "locked"}`}
                onClick={() => setStep(item.id)}
                disabled={!accessible}
              >
                <span className="step-marker">{complete ? <Check size={13} /> : item.index}</span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            );
          })}
        </nav>
        <div className="recent-list">
          <div className="recent-title"><span>最近文章</span><MoreHorizontal size={16} /></div>
          {articles.slice(0, 5).map((article) => (
            <button key={article.id} className={`recent-item ${article.id === articleId ? "selected" : ""}`} onClick={() => openArticle(article)}>
              <FileText size={15} />
              <span><strong>{article.title || article.snapshot.brief.topic}</strong><small>{formatTime(article.updatedAt)}</small></span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button onClick={() => { setStyleLibraryOpen(true); setMobileNav(false); }}><Clipboard size={16} /> 写作范例库 <span className="sidebar-count">{styleLibrary.exampleCount}</span></button>
          <button><BookOpen size={16} /> 使用指南</button>
          <button onClick={openAiSettings}><Settings2 size={16} /> AI 模型设置</button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-backdrop mobile-only" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}

      <main className="workspace-main">
        <section className="editor-pane">
          <StageHeader snapshot={snapshot} aiSettings={aiSettings} styleCount={styleLibrary.exampleCount} />
          {snapshot.step === "brief" && (
            <BriefStage
              snapshot={snapshot}
              busy={busy}
              onChange={(field, value) =>
                updateSnapshot((current) =>
                  resetGeneratedContent(current, { ...current.brief, [field]: value }),
                )
              }
              onGenerate={generateTopics}
              onUpload={() => fileInputRef.current?.click()}
              onMode={setCreationMode}
              hotspots={hotspots}
              hotspotState={hotspotState}
              hotspotUpdatedAt={hotspotUpdatedAt}
              onLoadHotspots={() => void loadHotspots()}
              onChooseHotspot={chooseHotspot}
              onImportReferences={() => void importReferenceArticles()}
              onRemoveReference={removeReferenceArticle}
              referenceErrors={referenceErrors}
            />
          )}
          {snapshot.step === "topics" && (
            <TopicsStage
              snapshot={snapshot}
              busy={busy}
              onSelect={(id) => updateSnapshot((current) => ({ ...current, selectedTopicId: id }))}
              onBack={() => setStep("brief")}
              onGenerate={generateOutline}
              onRegenerate={generateTopics}
            />
          )}
          {snapshot.step === "outline" && (
            <OutlineStage
              snapshot={snapshot}
              busy={busy}
              onPlan={(field, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  researchPlan: {
                    centralQuestion: current.researchPlan?.centralQuestion ?? "",
                    readerTension: current.researchPlan?.readerTension ?? "",
                    narrativeRoute: current.researchPlan?.narrativeRoute ?? "",
                    exclusion: current.researchPlan?.exclusion ?? "",
                    [field]: value,
                  },
                }))
              }
              onHeading={(index, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: current.outline.map((item, itemIndex) => itemIndex === index ? { ...item, heading: value } : item),
                }))
              }
              onPurpose={(index, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: current.outline.map((item, itemIndex) => itemIndex === index ? { ...item, purpose: value } : item),
                }))
              }
              onEvidence={(index, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: current.outline.map((item, itemIndex) => itemIndex === index
                    ? { ...item, bullets: value.split(/\n+/).map((line) => line.trim()).filter(Boolean) }
                    : item),
                }))
              }
              onQueries={(index, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: current.outline.map((item, itemIndex) => itemIndex === index
                    ? { ...item, searchQueries: value.split(/\n+/).map((line) => line.trim()).filter(Boolean) }
                    : item),
                }))
              }
              onMove={moveOutline}
              onAdd={() =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: [
                    ...current.outline,
                    {
                      id: editableModuleId("research"),
                      heading: "",
                      purpose: "",
                      bullets: [],
                      searchQueries: [],
                    },
                  ],
                }))
              }
              onRemove={(index) =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: current.outline.filter((_, itemIndex) => itemIndex !== index),
                }))
              }
              onBack={() => setStep("topics")}
              onGenerate={generateDraft}
              onRegenerate={generateOutline}
            />
          )}
          {snapshot.step === "draft" && (
            <DraftStage
              snapshot={snapshot}
              busy={busy}
              onTitle={(value) => updateSnapshot((current) => ({ ...current, title: value }))}
              onDigest={(value) => updateSnapshot((current) => ({ ...current, digest: value }))}
              onSection={(index, field, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  sections: current.sections.map((section, sectionIndex) =>
                    sectionIndex === index
                      ? field === "heading"
                        ? { ...section, heading: value }
                        : { ...section, paragraphs: value.split(/\n\s*\n/).filter(Boolean) }
                      : section,
                  ),
                }))
              }
              onAddSection={() =>
                updateSnapshot((current) => ({
                  ...current,
                  sections: [
                    ...current.sections,
                    { id: editableModuleId("section"), heading: "", paragraphs: [""] },
                  ],
                }))
              }
              onRemoveSection={(index) =>
                updateSnapshot((current) => {
                  const removedSlot = current.sections[index]?.imageSlot;
                  return {
                    ...current,
                    sections: current.sections.filter((_, sectionIndex) => sectionIndex !== index),
                    images: removedSlot
                      ? current.images.filter((image) => image.slot !== removedSlot)
                      : current.images,
                  };
                })
              }
              onBack={() => setStep("outline")}
              onGenerateImages={generateImages}
              onRegenerate={generateDraft}
              onAddStyle={() => void addCurrentDraftToStyleLibrary()}
            />
          )}
          {snapshot.step === "visuals" && (
            <VisualsStage
              snapshot={snapshot}
              busy={busy}
              onTheme={(theme) => updateSnapshot((current) => ({ ...current, theme }))}
              onRegenerate={generateImages}
              onBack={() => setStep("draft")}
              onContinue={() => updateSnapshot((current) => ({ ...current, step: "check" }))}
            />
          )}
          {snapshot.step === "check" && (
            <CheckStage
              snapshot={snapshot}
              checks={checks}
              busy={busy}
              onDisclosure={(checked) => updateSnapshot((current) => ({ ...current, aiDisclosure: checked }))}
              onCopy={handleCopy}
              onExport={handleExport}
              onBack={() => setStep("visuals")}
            />
          )}
        </section>

        <PreviewPane snapshot={snapshot} />
      </main>

      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => event.target.files?.[0] && void handleSourceFile(event.target.files[0])}
      />
      {settingsOpen && (
        <AiSettingsDialog
          settings={settingsDraft}
          testState={providerTest}
          onChange={(patch) => {
            setSettingsDraft((current) => ({ ...current, ...patch }));
            setProviderTest({ status: "idle", text: "" });
          }}
          onTest={() => void testProviderConnection()}
          onClose={() => setSettingsOpen(false)}
          onSave={saveAiSettings}
        />
      )}
      {styleLibraryOpen && (
        <StyleLibraryDialog
          library={styleLibrary}
          busy={styleBusy}
          canAddCurrent={snapshot.sections.length > 0 && articleCharacterCount(snapshot) >= 100}
          onAdd={(example) => addWritingExample(example)}
          onAddCurrent={() => void addCurrentDraftToStyleLibrary()}
          onDelete={(id) => void deleteWritingExample(id)}
          onRefresh={() => void refreshStyleProfile()}
          onClose={() => setStyleLibraryOpen(false)}
        />
      )}
      {notice && (
        <div className={`toast ${notice.type}`} role="status">
          {notice.type === "success" ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

function StyleLibraryDialog({
  library,
  busy,
  canAddCurrent,
  onAdd,
  onAddCurrent,
  onDelete,
  onRefresh,
  onClose,
}: {
  library: StyleLibraryData;
  busy: string | null;
  canAddCurrent: boolean;
  onAdd: (example: NewWritingExample) => Promise<void>;
  onAddCurrent: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState<WritingExampleSource>("paste");
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const readExampleFile = async (file: File) => {
    if (!/\.(txt|md)$/i.test(file.name) && !file.type.startsWith("text/")) return;
    const text = await file.text();
    setContent(text.slice(0, 30000));
    setTitle((current) => current || file.name.replace(/\.(txt|md)$/i, ""));
    setSource("upload");
  };

  const submit = async () => {
    if (content.trim().length < 100 || busy) return;
    await onAdd({ title, tags, content, source });
  };

  const sourceLabel: Record<WritingExampleSource, string> = {
    paste: "粘贴收录",
    upload: "文件上传",
    finalized: "人工定稿",
  };
  const profileRules = library.profile
    ? [...library.profile.titlePatterns, ...library.profile.openingPatterns, ...library.profile.editorRules].slice(0, 6)
    : [];

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog style-library-dialog" role="dialog" aria-modal="true" aria-labelledby="style-library-title">
        <header className="settings-header">
          <div><span>VOICE MEMORY</span><h2 id="style-library-title">写作范例库</h2><p>从你认可的文章中提炼标题、开场、结构和节奏，生成时自动调用相关范例。</p></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭写作范例库"><X size={19} /></button>
        </header>

        <div className="style-library-summary">
          <div><span>已收录</span><strong>{library.exampleCount}</strong><small>篇范文</small></div>
          <div className="style-profile-copy"><span>当前写作画像</span><strong>{library.profile?.summary || "收录第一篇范文后，系统会开始形成你的写作画像。"}</strong><small>{library.profileUpdatedAt ? `更新于 ${formatTime(library.profileUpdatedAt)}` : "尚未生成"}</small></div>
          <button className="button secondary compact" onClick={onRefresh} disabled={!library.exampleCount || busy === "profile"}>{busy === "profile" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} 深度总结画像</button>
        </div>

        <div className="settings-scroll style-library-scroll">
          {profileRules.length > 0 && (
            <section className="style-profile-panel">
              <div className="settings-section-title"><span>01</span><div><h3>模型下一篇会执行的习惯</h3><p>画像来自全部范例的共同规律，不会照搬某一篇文章。</p></div></div>
              <div className="style-rule-list">{profileRules.map((rule) => <span key={rule}>{rule}</span>)}</div>
            </section>
          )}

          <section className="style-add-panel">
            <div className="settings-section-title"><span>{profileRules.length ? "02" : "01"}</span><div><h3>收录一篇认可的范文</h3><p>支持粘贴正文，或上传 TXT / Markdown 文件；至少 100 字。</p></div></div>
            <div className="style-form-grid">
              <label className="settings-field"><span>文章标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：一篇我希望长期学习的文章" /></label>
              <label className="settings-field"><span>主题标签（可选）</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="商业观察、个人成长、社会热点" /></label>
            </div>
            <label className="style-content-field"><span>范文正文</span><textarea value={content} onChange={(event) => { setContent(event.target.value); setSource("paste"); }} rows={9} placeholder="粘贴完整正文。系统只学习共同的编辑习惯，不把范文事实当成新文章素材。" /></label>
            <div className="style-add-actions">
              <input ref={uploadRef} type="file" className="sr-only" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => event.target.files?.[0] && void readExampleFile(event.target.files[0])} />
              <button className="button ghost" onClick={() => uploadRef.current?.click()}><Upload size={15} /> 上传 TXT / MD</button>
              <span>{content.trim().length} 字</span>
              <button className="button primary" onClick={() => void submit()} disabled={content.trim().length < 100 || busy === "add"}>{busy === "add" ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} 收录并学习</button>
            </div>
            <div className="style-privacy-note"><CircleCheck size={15} /><span>范文持久保存在你的个人范例库。深度总结时，仅将代表性节选发送给你当前选择的写作 API。</span></div>
          </section>

          <section className="style-examples-panel">
            <div className="style-list-heading"><div><h3>已收录范文</h3><p>人工修改后的最终稿权重更高，会优先影响下一次生成。</p></div><button className="button ghost compact" onClick={onAddCurrent} disabled={!canAddCurrent || busy === "add"}><Clipboard size={14} /> 收录当前定稿</button></div>
            {library.examples.length ? (
              <div className="style-example-list">
                {library.examples.map((example) => (
                  <article className="style-example-item" key={example.id}>
                    <div><span>{sourceLabel[example.source]} · {example.characterCount} 字</span><strong>{example.title}</strong><p>{example.excerpt}</p><small>{example.tags || "未设置主题标签"} · {formatTime(example.updatedAt)}</small></div>
                    <button className="icon-button" onClick={() => onDelete(example.id)} disabled={busy === example.id} aria-label={`删除范文：${example.title}`}>{busy === example.id ? <LoaderCircle size={15} className="spin" /> : <X size={15} />}</button>
                  </article>
                ))}
              </div>
            ) : <div className="style-empty"><BookOpen size={22} /><strong>还没有范文</strong><span>先收录 3–5 篇你真正认可的文章，风格画像会明显更稳定。</span></div>}
          </section>
        </div>

        <footer className="settings-footer"><span className="style-footer-note">这是可解释的范例检索与风格总结，不会训练或复制某位作者。</span><button className="button primary" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}

function AiSettingsDialog({
  settings,
  testState,
  onChange,
  onTest,
  onClose,
  onSave,
}: {
  settings: AiSettings;
  testState: ProviderTestState;
  onChange: (patch: Partial<AiSettings>) => void;
  onTest: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [showKeys, setShowKeys] = useState(false);
  const textPreset = TEXT_PROVIDER_PRESETS[settings.textProvider];
  const imagePreset = IMAGE_PROVIDER_PRESETS[settings.imageProvider];
  const newsProviderLabel = settings.newsSearchProvider === "brave"
    ? "Brave News + 官方源"
    : settings.newsSearchProvider === "public"
      ? "公开源分层"
      : "自动分层";
  const newsRegionLabel: Record<NewsRegionId, string> = {
    auto: "自动识别地区",
    cn: "中国大陆",
    hk: "中国香港",
    tw: "中国台湾",
    all: "大陆 / 香港 / 台湾",
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const switchTextProvider = (provider: TextProviderId) => {
    const preset = TEXT_PROVIDER_PRESETS[provider];
    onChange({ textProvider: provider, textModel: preset.model, textBaseUrl: preset.baseUrl, textApiKey: "" });
  };
  const switchImageProvider = (provider: ImageProviderId) => {
    const preset = IMAGE_PROVIDER_PRESETS[provider];
    onChange({ imageProvider: provider, imageModel: preset.model, imageBaseUrl: preset.baseUrl, imageApiKey: "" });
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <header className="settings-header">
          <div><span>MODEL ROUTER</span><h2 id="ai-settings-title">模型与 API 设置</h2><p>写作与配图可使用不同服务，切换后立即用于下一次生成。</p></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭模型设置"><X size={19} /></button>
        </header>

        <div className="modality-route" aria-label="多模态路由概览">
          <div><span>文字创作</span><strong>{textPreset.label}</strong><small>{settings.textModel}</small></div>
          <ArrowRight size={17} />
          <div><span>新闻研究</span><strong>{newsProviderLabel}</strong><small>{newsRegionLabel[settings.newsRegion]}</small></div>
          <ArrowRight size={17} />
          <div><span>图片生成</span><strong>{imagePreset.label}</strong><small>{settings.imageModel}</small></div>
        </div>

        <div className="settings-scroll">
          <section className="settings-section">
            <div className="settings-section-title"><span>01</span><div><h3>写作模型</h3><p>用于研究角度、研究提纲、资料深化、正文和参考改写。</p></div></div>
            <div className="settings-grid">
              <label className="settings-field"><span>服务商</span><select value={settings.textProvider} onChange={(event) => switchTextProvider(event.target.value as TextProviderId)}><option value="openai">OpenAI / ChatGPT API</option><option value="deepseek">DeepSeek</option><option value="kimi">Kimi</option><option value="custom">自定义兼容接口</option></select></label>
              <label className="settings-field"><span>模型名称</span><input list="text-model-options" value={settings.textModel} onChange={(event) => onChange({ textModel: event.target.value })} placeholder="输入 API 模型名称" /><datalist id="text-model-options">{textPreset.models.map((model) => <option value={model} key={model} />)}</datalist></label>
              <label className="settings-field full"><span>API Base URL</span><input value={settings.textBaseUrl} onChange={(event) => onChange({ textBaseUrl: event.target.value })} inputMode="url" /></label>
              <label className="settings-field full"><span>API Key</span><div className="secret-input"><input type={showKeys ? "text" : "password"} value={settings.textApiKey} onChange={(event) => onChange({ textApiKey: event.target.value })} autoComplete="off" placeholder="sk-..." /><button type="button" onClick={() => setShowKeys((current) => !current)}>{showKeys ? "隐藏" : "显示"}</button></div></label>
            </div>
            {settings.textProvider === "kimi" ? <p className="settings-hint">中国区 Moonshot Key 可将地址改为 https://api.moonshot.cn/v1。</p> : null}
            <div className="connection-row">
              <button className="button secondary compact" onClick={onTest} disabled={testState.status === "testing"}>{testState.status === "testing" ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} 测试写作连接</button>
              {testState.status !== "idle" ? <span className={`connection-result ${testState.status}`}>{testState.status === "success" ? <CircleCheck size={14} /> : testState.status === "error" ? <CircleAlert size={14} /> : null}{testState.text}</span> : null}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title"><span>02</span><div><h3>联网新闻研究</h3><p>热点先回到来源平台读取相关文章，同时搜索公众号，再用区域官方源和全球新闻搜索交叉核验。</p></div></div>
            <div className="settings-grid">
              <label className="settings-field"><span>检索方式</span><select value={settings.newsSearchProvider} onChange={(event) => onChange({ newsSearchProvider: event.target.value as NewsSearchProviderId })}><option value="auto">自动分层（推荐）</option><option value="brave">Brave News + 区域官方源</option><option value="public">区域官方源 + GDELT</option></select></label>
              <label className="settings-field"><span>重点地区</span><select value={settings.newsRegion} onChange={(event) => onChange({ newsRegion: event.target.value as NewsRegionId })}><option value="auto">根据选题自动识别</option><option value="cn">中国大陆</option><option value="hk">中国香港</option><option value="tw">中国台湾</option><option value="all">大陆 / 香港 / 台湾</option></select></label>
              {settings.newsSearchProvider !== "public" ? <label className="settings-field full"><span>Brave Search API Key{settings.newsSearchProvider === "auto" ? "（选填）" : ""}</span><div className="secret-input"><input type={showKeys ? "text" : "password"} value={settings.newsSearchApiKey} onChange={(event) => onChange({ newsSearchApiKey: event.target.value })} autoComplete="off" placeholder={settings.newsSearchProvider === "auto" ? "留空时使用区域官方源和 GDELT 降级检索" : "BSA-..."} /><button type="button" onClick={() => setShowKeys((current) => !current)}>{showKeys ? "隐藏" : "显示"}</button></div></label> : null}
            </div>
            <p className="settings-hint">热点模式先读取今日头条站内相关文章，并搜索公开公众号文章；微博或公众号遇到访客验证时会明确提示。随后加入区域官方源；有 Brave Key 时补充商业新闻搜索，没有 Key 时才使用 GDELT。系统会按可读正文、独立发布者和多来源摘要综合判断能否成稿。</p>
          </section>

          <section className="settings-section">
            <div className="settings-section-title"><span>03</span><div><h3>配图模型</h3><p>与写作服务独立；DeepSeek、Kimi 写文时仍可让 OpenAI 出图。</p></div></div>
            <div className="settings-grid">
              <label className="settings-field"><span>配图方式</span><select value={settings.imageProvider} onChange={(event) => switchImageProvider(event.target.value as ImageProviderId)}><option value="local">本地排版图（免费）</option><option value="openai">OpenAI 图片 API</option><option value="custom">自定义图片接口</option></select></label>
              <label className="settings-field"><span>图片模型</span><input value={settings.imageModel} onChange={(event) => onChange({ imageModel: event.target.value })} disabled={settings.imageProvider === "local"} /></label>
              {settings.imageProvider !== "local" ? <><label className="settings-field full"><span>图片 API Base URL</span><input value={settings.imageBaseUrl} onChange={(event) => onChange({ imageBaseUrl: event.target.value })} inputMode="url" /></label><label className="settings-field full"><span>图片 API Key</span><div className="secret-input"><input type={showKeys ? "text" : "password"} value={settings.imageApiKey} onChange={(event) => onChange({ imageApiKey: event.target.value })} autoComplete="off" placeholder={settings.imageProvider === "openai" && settings.textProvider === "openai" ? "留空则复用上方 OpenAI Key" : "填写图片服务 API Key"} /><button type="button" onClick={() => setShowKeys((current) => !current)}>{showKeys ? "隐藏" : "显示"}</button></div></label></> : <div className="local-image-note"><ImageIcon size={17} /><span><strong>本地生成已启用</strong><small>不消耗 API，输出品牌化封面和信息卡配图。</small></span></div>}
            </div>
          </section>

          <label className="remember-key" htmlFor="remember-api-keys"><input id="remember-api-keys" type="checkbox" aria-label="在此设备记住 API Key" checked={settings.rememberKeys} onChange={(event) => onChange({ rememberKeys: event.target.checked })} /><span><strong>在此设备记住 API Key</strong><small>开启后密钥会保存在本机浏览器；公用设备请勿开启。</small></span></label>
          <div className="key-safety-note"><Settings2 size={16} /><p>写作、图片和新闻搜索密钥只随对应请求发送，不写入文章数据库、参考资料或导出包。关闭“记住”时，关闭浏览器会话后密钥失效。</p></div>
        </div>

        <footer className="settings-footer"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" onClick={onSave}>保存并使用</button></footer>
      </section>
    </div>
  );
}

function StageHeader({ snapshot, aiSettings, styleCount }: { snapshot: ArticleSnapshot; aiSettings: AiSettings; styleCount: number }) {
  const step = WORKFLOW_STEPS.find((item) => item.id === snapshot.step)!;
  return (
    <div className="stage-header">
      <div>
        <span className="stage-kicker">STEP {step.index}</span>
        <h1>{step.label}</h1>
        <p>{step.description} · {snapshot.generationMode === "ai" ? `${TEXT_PROVIDER_PRESETS[aiSettings.textProvider].label} · ${aiSettings.textModel}` : "可运行演示模式"}{styleCount ? ` · 已启用 ${styleCount} 篇写作范例` : ""}</p>
      </div>
      <div className="version-pill">V{snapshot.version}</div>
    </div>
  );
}

function BriefStage({
  snapshot,
  busy,
  onChange,
  onGenerate,
  onUpload,
  onMode,
  hotspots,
  hotspotState,
  hotspotUpdatedAt,
  onLoadHotspots,
  onChooseHotspot,
  onImportReferences,
  onRemoveReference,
  referenceErrors,
}: {
  snapshot: ArticleSnapshot;
  busy: string | null;
  onChange: (field: keyof ArticleSnapshot["brief"], value: string) => void;
  onGenerate: () => void;
  onUpload: () => void;
  onMode: (mode: CreationMode) => void;
  hotspots: Hotspot[];
  hotspotState: HotspotState;
  hotspotUpdatedAt: string | null;
  onLoadHotspots: () => void;
  onChooseHotspot: (hotspot: Hotspot) => void;
  onImportReferences: () => void;
  onRemoveReference: (url: string) => void;
  referenceErrors: ReferenceImportError[];
}) {
  const mode = snapshot.brief.creationMode ?? "original";
  const importedReferences = snapshot.brief.referenceArticles ?? [];
  const totalReferenceCharacters = referenceMaterialText(snapshot.brief).length;
  return (
    <div className="stage-content brief-stage">
      <section className="editor-card lead-card">
        <div className="card-heading">
          <span className="number-badge">1</span>
          <div><h2>选择创作起点</h2><p>从自主主题、已有文章或实时热点开始。</p></div>
        </div>
        <div className="creation-mode-switch" aria-label="创作模式">
          <button className={`creation-mode-button ${mode === "original" ? "active" : ""}`} onClick={() => onMode("original")}><PenLine size={17} /><span><strong>自主选题</strong><small>从一个主题开始</small></span></button>
          <button className={`creation-mode-button ${mode === "rewrite" ? "active" : ""}`} onClick={() => onMode("rewrite")}><Newspaper size={17} /><span><strong>参考改写</strong><small>重组已有文章</small></span></button>
          <button className={`creation-mode-button ${mode === "hotspot" ? "active" : ""}`} onClick={() => onMode("hotspot")}><Flame size={17} /><span><strong>社会热点</strong><small>从热榜选择线索</small></span></button>
        </div>

        {mode === "rewrite" ? (
          <div className="rewrite-panel">
            <label className="field-label" htmlFor="reference-urls">公开文章链接（每行一个，最多 5 篇）</label>
            <textarea id="reference-urls" className="reference-url-input" rows={4} value={snapshot.brief.referenceUrls ?? ""} onChange={(event) => onChange("referenceUrls", event.target.value)} placeholder={"公众号、微博、今日头条或 Blog 文章链接\nhttps://example.com/article"} />
            <div className="reference-import-actions">
              <button className="text-button reference-import-button" onClick={onImportReferences} disabled={busy === "references" || !(snapshot.brief.referenceUrls ?? "").trim()}>{busy === "references" ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />} 读取并加入参考</button>
              <span>支持公众号、微博、头条与 Blog；用于当前创作，不训练长期模型</span>
            </div>
            {importedReferences.length ? (
              <div className="imported-reference-list">
                {importedReferences.map((article) => (
                  <article className="imported-reference-item" key={article.url}>
                    <div><strong>{article.title}</strong><p>{article.account} · {article.characterCount} 字已读取</p></div>
                    <div className="imported-reference-actions"><a href={article.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 原文</a><button onClick={() => onRemoveReference(article.url)} aria-label={`移除参考文章：${article.title}`}><X size={14} /></button></div>
                  </article>
                ))}
              </div>
            ) : null}
            {referenceErrors.length ? (
              <div className="reference-error-list" role="status">
                {referenceErrors.map((item) => (
                  <div className="reference-error-item" key={item.url}>
                    <CircleAlert size={14} />
                    <div><strong>读取失败</strong><p>{item.error}</p><code>{item.url}</code></div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="rewrite-divider"><span>或直接粘贴正文</span></div>
            <label className="field-label" htmlFor="reference-article">补充参考文章全文</label>
            <textarea id="reference-article" className="rewrite-input" rows={6} value={snapshot.brief.referenceArticle ?? ""} onChange={(event) => onChange("referenceArticle", event.target.value)} placeholder="也可以直接粘贴正文。系统会综合多篇素材，保留事实并重新设计结构与表达。" />
            <div className="rewrite-meta"><span>共 {totalReferenceCharacters} 字 · {importedReferences.length} 篇链接文章</span><span>发布前请人工确认事实与版权边界</span></div>
            <label className="field-label rewrite-direction-label" htmlFor="topic">改写方向或拟定主题（可选）</label>
            <textarea id="topic" className="topic-input compact-topic-input" value={snapshot.brief.topic} onChange={(event) => onChange("topic", event.target.value)} placeholder="例如：改成面向小微企业主的实操指南" rows={2} />
          </div>
        ) : mode === "hotspot" ? (
          <div className="hotspot-panel">
            <div className="hotspot-head">
              <div><strong>微博热搜 · 今日头条热榜</strong><span>{hotspotUpdatedAt ? `聚合更新于 ${formatTime(hotspotUpdatedAt)}` : "交替呈现两个平台的实时热点"}</span></div>
              <button className="button ghost compact" onClick={onLoadHotspots} disabled={hotspotState === "loading"}><RefreshCw size={15} className={hotspotState === "loading" ? "spin" : ""} /> 刷新热点</button>
            </div>
            {hotspotState === "loading" && !hotspots.length ? <div className="hotspot-empty"><LoaderCircle size={18} className="spin" /> 正在连接热点来源…</div> : null}
            {hotspotState === "error" && !hotspots.length ? <div className="hotspot-empty">暂时未获取到热点，请刷新重试，或在下方手动输入主题。</div> : null}
            {hotspots.length ? (
              <div className="hotspot-list">
                {hotspots.map((hotspot) => (
                  <article className={`hotspot-item ${snapshot.brief.topic === hotspot.title ? "selected" : ""}`} key={hotspot.id}>
                    <span className="hotspot-rank">{String(hotspot.rank).padStart(2, "0")}</span>
                    <div className="hotspot-copy"><strong>{hotspot.title}</strong>{hotspot.summary ? <p>{hotspot.summary}</p> : null}<div className="hotspot-meta"><span>{hotspot.source}{hotspot.heat ? ` · ${hotspot.heat}` : ""}</span><a href={hotspot.url} target="_blank" rel="noreferrer" aria-label={`查看热点来源：${hotspot.title}`}><ExternalLink size={13} /> 来源</a></div></div>
                    <button className="button secondary compact" onClick={() => onChooseHotspot(hotspot)}>{snapshot.brief.topic === hotspot.title ? <Check size={15} /> : <Plus size={15} />}{snapshot.brief.topic === hotspot.title ? "已选择" : "用此选题"}</button>
                  </article>
                ))}
              </div>
            ) : null}
            <label className="field-label hotspot-topic-label" htmlFor="topic">已选热点 / 自定义热点主题</label>
            <textarea id="topic" className="topic-input compact-topic-input" value={snapshot.brief.topic} onChange={(event) => onChange("topic", event.target.value)} placeholder="选择上方热点，或直接输入一个社会话题" rows={2} />
          </div>
        ) : (
          <>
            <label className="field-label" htmlFor="topic">文章主题</label>
            <textarea id="topic" className="topic-input" value={snapshot.brief.topic} onChange={(event) => onChange("topic", event.target.value)} placeholder="例如：AI 如何改变中小企业的内容运营" rows={2} />
          </>
        )}
        <div className="field-grid two-columns">
          <label className="field-group"><span>目标读者</span><input value={snapshot.brief.audience} onChange={(event) => onChange("audience", event.target.value)} /></label>
          <label className="field-group"><span>写作目的</span><input value={snapshot.brief.goal} onChange={(event) => onChange("goal", event.target.value)} /></label>
          <label className="field-group"><span>表达语气</span><select value={snapshot.brief.tone} onChange={(event) => onChange("tone", event.target.value)}><option>专业、克制、有判断</option><option>亲切、直接、有故事感</option><option>简洁、理性、数据驱动</option><option>轻松、有趣、有画面</option></select></label>
          <label className="field-group"><span>预计篇幅</span><select value={snapshot.brief.length} onChange={(event) => onChange("length", event.target.value)}><option>400–600 字</option><option>800–1200 字</option><option>1200–1600 字</option><option>1800–2200 字</option><option>2500–3000 字</option></select></label>
        </div>
      </section>
      <section className="editor-card">
        <div className="card-heading compact-heading">
          <span className="number-badge">2</span>
          <div><h2>资料与边界</h2><p>资料越具体，文章越可靠；无资料时系统不会编造数字。</p></div>
        </div>
        <label className="field-label" htmlFor="sources">参考链接、采访笔记或关键事实</label>
        <textarea id="sources" className="source-input" rows={5} value={snapshot.brief.sourcesText} onChange={(event) => onChange("sourcesText", event.target.value)} />
        <div className="source-actions">
          <button className="text-button" onClick={onUpload} disabled={busy === "upload"}>{busy === "upload" ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />} 上传 TXT / MD / PDF / DOCX</button>
          <span>单文件不超过 10 MB</span>
        </div>
        <label className="field-group full-width"><span>希望读者采取的行动</span><input value={snapshot.brief.callToAction} onChange={(event) => onChange("callToAction", event.target.value)} /></label>
      </section>
      <div className="stage-footer">
        <div className="ai-note"><Sparkles size={16} /><span>{mode === "rewrite" ? "系统会保留事实并重做结构与表达，不会直接照搬原文。" : mode === "hotspot" ? "热点只作为选题线索；系统会区分已知事实与观点。" : "系统先给出三个内部研究角度，不会把它们当作文章标题。"}</span></div>
        <button className="button primary large" onClick={onGenerate} disabled={busy === "topics"}>
          {busy === "topics" ? <LoaderCircle size={18} className="spin" /> : <WandSparkles size={18} />} 生成研究角度 <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}

function TopicsStage({ snapshot, busy, onSelect, onBack, onGenerate, onRegenerate }: {
  snapshot: ArticleSnapshot; busy: string | null; onSelect: (id: string) => void; onBack: () => void; onGenerate: () => void; onRegenerate: () => void;
}) {
  return (
    <div className="stage-content">
      <div className="topic-intro"><div><h2>先选择研究角度，不是文章标题</h2><p>角度只决定要追问什么、查什么资料和形成什么判断；真正标题在研究完成后另写。</p></div><button className="button ghost" onClick={onRegenerate} disabled={busy === "topics"}><RefreshCw size={15} className={busy === "topics" ? "spin" : ""} /> 换一组角度</button></div>
      <div className="topic-cards">
        {snapshot.topics.map((topic, index) => {
          const selected = topic.id === snapshot.selectedTopicId;
          return (
            <button className={`topic-card ${selected ? "selected" : ""}`} key={topic.id} onClick={() => onSelect(topic.id)}>
              <span className="topic-index">0{index + 1}</span>
              <span className={`radio-mark ${selected ? "checked" : ""}`}>{selected && <Check size={13} />}</span>
              <span className="topic-strategy">研究候选 {String.fromCharCode(65 + index)}</span>
              <small className="internal-label">内部研究角度</small>
              <h3>{topic.title}</h3>
              <p className="topic-hook">{topic.hook}</p>
              <span className="topic-divider" />
              <dl><div><dt>核心判断</dt><dd>{topic.thesis}</dd></div><div><dt>读者收获</dt><dd>{topic.readerGain}</dd></div></dl>
              <div className="evidence-tags">{topic.evidenceNeeds.map((item) => <span key={item}>{item}</span>)}</div>
            </button>
          );
        })}
      </div>
      <div className="stage-footer between">
        <button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回简报</button>
        <button className="button primary large" onClick={onGenerate} disabled={!snapshot.selectedTopicId || busy === "outline"}>{busy === "outline" ? <LoaderCircle size={18} className="spin" /> : <LayoutTemplate size={18} />} 按这个方向生成研究提纲 <ArrowRight size={17} /></button>
      </div>
    </div>
  );
}

function OutlineStage({ snapshot, busy, onPlan, onHeading, onPurpose, onEvidence, onQueries, onMove, onAdd, onRemove, onBack, onGenerate, onRegenerate }: {
  snapshot: ArticleSnapshot; busy: string | null; onPlan: (field: keyof ResearchPlan, value: string) => void; onHeading: (index: number, value: string) => void; onPurpose: (index: number, value: string) => void; onEvidence: (index: number, value: string) => void; onQueries: (index: number, value: string) => void; onMove: (index: number, direction: -1 | 1) => void; onAdd: () => void; onRemove: (index: number) => void; onBack: () => void; onGenerate: () => void; onRegenerate: () => void;
}) {
  const blockedReport = snapshot.researchReport?.status === "insufficient" ? snapshot.researchReport : null;
  const plan = snapshot.researchPlan ?? { centralQuestion: "", readerTension: "", narrativeRoute: "", exclusion: "" };
  return (
    <div className="stage-content">
      <div className="topic-intro"><div><h2>先定这篇文章怎么走，再决定查什么</h2><p>只保留一个核心追问；研究任务可以不对称，也不必覆盖所有背景。</p></div><button className="button ghost" onClick={onRegenerate} disabled={busy === "outline"}><RefreshCw size={15} className={busy === "outline" ? "spin" : ""} /> 换一条叙事路线</button></div>
      {blockedReport ? (
        <section className="research-blocker" role="status">
          <CircleAlert size={19} />
          <div>
            <strong>资料还不够，本次没有生成正文</strong>
            <p>系统已从热搜来源平台尝试读取相关文章，但不会再用“查不到”或“只能确认词条存在”凑成一篇文章。</p>
            {blockedReport.missingEvidence?.length ? <ul>{blockedReport.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            {blockedReport.warnings.length ? <small>{blockedReport.warnings.join("；")}</small> : null}
            {snapshot.researchSources?.length ? <div className="research-blocker-links">{snapshot.researchSources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">已找到：{source.title}<ExternalLink size={11} /></a>)}</div> : null}
          </div>
        </section>
      ) : null}
      <section className="research-route-panel">
        <header><span>EDITOR ROUTE</span><strong>本篇研究路线</strong><small>以下内容只指导 AI 取材和组织，不会直接成为标题或正文。</small></header>
        <div className="research-route-grid">
          <label><span>唯一核心追问</span><textarea value={plan.centralQuestion} onChange={(event) => onPlan("centralQuestion", event.target.value)} rows={2} placeholder="这篇文章最终只需要回答什么？" /></label>
          <label><span>读者认知张力</span><textarea value={plan.readerTension} onChange={(event) => onPlan("readerTension", event.target.value)} rows={2} placeholder="读者原本以为什么，材料可能揭示什么？" /></label>
          <label><span>叙事推进方式</span><textarea value={plan.narrativeRoute} onChange={(event) => onPlan("narrativeRoute", event.target.value)} rows={3} placeholder="从哪个细节进入，沿什么矛盾向前推进？" /></label>
          <label><span>主动舍弃</span><textarea value={plan.exclusion} onChange={(event) => onPlan("exclusion", event.target.value)} rows={3} placeholder="哪些背景或旁支这篇不展开？" /></label>
        </div>
      </section>
      <div className="outline-list">
        {snapshot.outline.map((item, index) => (
          <article className="outline-item" key={item.id}>
            <div className="outline-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="outline-body">
              <label className="outline-edit-field"><span>材料任务（不会成为正文标题）</span><input className="outline-heading-input" value={item.heading} onChange={(event) => onHeading(index, event.target.value)} aria-label={`第 ${index + 1} 项材料任务`} /></label>
              <label className="outline-edit-field"><span>希望回答的问题</span><textarea value={item.purpose} onChange={(event) => onPurpose(index, event.target.value)} rows={2} aria-label={`第 ${index + 1} 项核心问题`} /></label>
              <div className="outline-field-grid">
                <label className="outline-edit-field"><span>需要找到的证据（每行一项）</span><textarea value={item.bullets.join("\n")} onChange={(event) => onEvidence(index, event.target.value)} rows={3} aria-label={`第 ${index + 1} 项证据清单`} /></label>
                <label className="outline-edit-field"><span>联网检索词（每行一条）</span><textarea value={(item.searchQueries ?? []).join("\n")} onChange={(event) => onQueries(index, event.target.value)} rows={3} aria-label={`第 ${index + 1} 项检索词`} /></label>
              </div>
            </div>
            <div className="outline-actions"><button onClick={() => onMove(index, -1)} disabled={index === 0} aria-label="上移"><ArrowUp size={15} /></button><button onClick={() => onMove(index, 1)} disabled={index === snapshot.outline.length - 1} aria-label="下移"><ArrowDown size={15} /></button><button className="delete-module-button" onClick={() => onRemove(index)} aria-label={`删除第 ${index + 1} 项材料任务`} title="删除模块"><Trash2 size={14} /></button></div>
          </article>
        ))}
        {!snapshot.outline.length ? <p className="empty-module-note">当前没有材料任务，可以手动增加一个。</p> : null}
        <button className="button ghost module-add-button" onClick={onAdd}><Plus size={16} /> 增加材料任务</button>
      </div>
      <div className="stage-footer between"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回研究角度</button><button className="button primary large" onClick={onGenerate} disabled={busy === "draft" || !snapshot.outline.length}>{busy === "draft" ? <LoaderCircle size={18} className="spin" /> : <FileText size={18} />} {blockedReport ? "按修改后的检索词重试" : "联网研究并生成读者成稿"} <ArrowRight size={17} /></button></div>
    </div>
  );
}

function DraftStage({ snapshot, busy, onTitle, onDigest, onSection, onAddSection, onRemoveSection, onBack, onGenerateImages, onRegenerate, onAddStyle }: {
  snapshot: ArticleSnapshot; busy: string | null; onTitle: (value: string) => void; onDigest: (value: string) => void; onSection: (index: number, field: "heading" | "paragraphs", value: string) => void; onAddSection: () => void; onRemoveSection: (index: number) => void; onBack: () => void; onGenerateImages: () => void; onRegenerate: () => void; onAddStyle: () => void;
}) {
  const channelLabels: Record<NonNullable<ResearchSource["channel"]>, string> = {
    user: "用户资料",
    platform: "热搜平台相关文章",
    wechat: "公众号文章",
    official: "区域官方源",
    brave: "Brave News",
    gdelt: "GDELT 补充",
  };
  const regionLabels: Record<NonNullable<ResearchSource["region"]>, string> = {
    cn: "大陆",
    hk: "香港",
    tw: "台湾",
    global: "全球",
  };
  const reportRegionLabels: Record<ResearchReport["region"], string> = {
    auto: "自动识别",
    cn: "中国大陆",
    hk: "中国香港",
    tw: "中国台湾",
    all: "大陆 / 香港 / 台湾",
  };
  const report = snapshot.researchReport;
  const fulltextCount = (snapshot.researchSources ?? []).filter((source) => source.retrieval === "fulltext").length;
  const evidenceLabels: Record<NonNullable<ResearchReport["evidenceMode"]>, string> = {
    fulltext: "正文交叉核验",
    mixed: "正文 + 多来源摘要",
    "corroborated-snippets": "多来源摘要交叉",
    "brief-only": "仅使用简报材料",
    insufficient: "材料仍不足",
  };
  return (
    <div className="stage-content">
      <div className="draft-toolbar"><span><WandSparkles size={15} /> 双轮编辑成稿 · 约 {articleCharacterCount(snapshot)} 字</span><div className="draft-toolbar-actions"><button className="button ghost" onClick={onAddStyle}><Clipboard size={15} /> 将人工定稿收入范例库</button><button className="button ghost" onClick={onRegenerate} disabled={busy === "draft"}><RefreshCw size={15} className={busy === "draft" ? "spin" : ""} /> 重新编辑成稿</button></div></div>
      {(Boolean(snapshot.researchSources?.length) || Boolean(report)) && (
        <section className="research-source-panel">
          <div className="research-source-heading"><div><strong>联网研究记录</strong><span>取得 {snapshot.researchSources?.length ?? 0} 个来源，其中 {fulltextCount} 个已读取正文；{report?.evidenceMode ? `证据方式：${evidenceLabels[report.evidenceMode]}；` : ""}发布前仍需人工核对。</span></div>{report ? <span className="research-region-chip">重点地区：{reportRegionLabels[report.region]}</span> : null}</div>
          {report?.channels.length ? <div className="research-channel-summary"><span>本次已使用</span>{report.channels.map((channel) => <b key={channel}>{channel}</b>)}</div> : null}
          {report?.warnings.length ? <ul className="research-warnings">{report.warnings.map((warning) => <li key={warning}><CircleAlert size={12} />{warning}</li>)}</ul> : null}
          <div className="research-source-links">
            {(snapshot.researchSources ?? []).map((source, index) => (
              <article className="research-source-item" key={`${source.url}-${index}`}>
                <div className="research-source-badges"><span data-channel={source.channel ?? "user"}>{channelLabels[source.channel ?? "user"]}</span><span>{regionLabels[source.region ?? "global"]}</span><span>{source.retrieval === "fulltext" ? "已读正文" : "仅摘要"}</span></div>
                <a href={source.url} target="_blank" rel="noreferrer"><span>{source.title}</span><ExternalLink size={12} /></a>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="article-editor">
        <input className="article-title-input" value={snapshot.title} onChange={(event) => onTitle(event.target.value)} aria-label="文章标题" />
        <textarea className="digest-input" value={snapshot.digest} onChange={(event) => onDigest(event.target.value)} rows={3} aria-label="文章摘要" />
        {snapshot.sections.map((section, index) => (
          <div className="section-editor" key={section.id}>
            <div className="section-meta"><span>SECTION {String(index + 1).padStart(2, "0")}</span><div className="section-meta-actions">{section.imageSlot && <span className="slot-chip"><ImageIcon size={13} /> {section.imageSlot}</span>}<button className="section-delete-button" onClick={() => onRemoveSection(index)} aria-label={`删除第 ${index + 1} 个正文模块`} title="删除模块"><Trash2 size={14} /></button></div></div>
            <input className="section-heading-input" value={section.heading} onChange={(event) => onSection(index, "heading", event.target.value)} aria-label={`第 ${index + 1} 节标题`} placeholder="简单文章可留空，不显示小标题" />
            <textarea value={section.paragraphs.join("\n\n")} onChange={(event) => onSection(index, "paragraphs", event.target.value)} rows={Math.max(6, section.paragraphs.join("\n").length / 42)} aria-label={`第 ${index + 1} 节正文`} />
          </div>
        ))}
        {!snapshot.sections.length ? <p className="empty-module-note">当前没有正文模块，可以手动增加一个。</p> : null}
        <button className="button ghost module-add-button" onClick={onAddSection}><Plus size={16} /> 增加正文模块</button>
      </section>
      <div className="stage-footer between"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回研究提纲</button><button className="button primary large" onClick={onGenerateImages} disabled={busy === "images" || !snapshot.sections.length}>{busy === "images" ? <LoaderCircle size={18} className="spin" /> : <ImageIcon size={18} />} 生成封面与正文配图 <ArrowRight size={17} /></button></div>
    </div>
  );
}

function VisualsStage({ snapshot, busy, onTheme, onRegenerate, onBack, onContinue }: {
  snapshot: ArticleSnapshot; busy: string | null; onTheme: (theme: ThemeId) => void; onRegenerate: () => void; onBack: () => void; onContinue: () => void;
}) {
  const themes: Array<{ id: ThemeId; name: string; detail: string }> = [
    { id: "paper", name: "暖纸编辑", detail: "温润、克制，适合品牌观察" },
    { id: "ink", name: "深墨科技", detail: "高对比，适合科技与观点" },
    { id: "sage", name: "青苔简报", detail: "清爽、可信，适合教育与组织" },
  ];
  return (
    <div className="stage-content">
      <section className="editor-card"><div className="card-heading compact-heading"><span className="number-badge">1</span><div><h2>选择排版气质</h2><p>内容与样式分离，切换主题不会改变正文。</p></div></div><div className="theme-grid">{themes.map((theme) => <button key={theme.id} className={`theme-card theme-${theme.id} ${snapshot.theme === theme.id ? "selected" : ""}`} onClick={() => onTheme(theme.id)}><span className="theme-swatch"><i /><i /><i /></span><strong>{theme.name}</strong><small>{theme.detail}</small>{snapshot.theme === theme.id && <span className="theme-check"><Check size={13} /></span>}</button>)}</div></section>
      <section className="editor-card"><div className="card-heading compact-heading"><span className="number-badge">2</span><div><h2>图片脚本与结果</h2><p>每张正文图都与固定插槽对应。</p></div></div><div className="asset-grid">{snapshot.images.map((image) => <article className={`asset-card ${image.kind === "cover" ? "cover-asset" : ""}`} key={image.id}>{image.url ? <img src={image.url} alt={image.caption} /> : <div className="asset-placeholder"><ImageIcon size={24} /></div>}<div><span>{image.slot}</span><strong>{image.title}</strong><small>{image.filename} · {image.source === "ai" ? "AI 生成" : "本地生成"}</small></div></article>)}</div><button className="button ghost" onClick={onRegenerate} disabled={busy === "images"}>{busy === "images" ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} 按当前主题重生成配图</button></section>
      <div className="stage-footer between"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回正文</button><button className="button primary large" onClick={onContinue}><CheckCircle2 size={18} /> 进入发布检查 <ArrowRight size={17} /></button></div>
    </div>
  );
}

function CheckStage({ snapshot, checks, busy, onDisclosure, onCopy, onExport, onBack }: {
  snapshot: ArticleSnapshot; checks: ReturnType<typeof getQualityChecks>; busy: string | null; onDisclosure: (checked: boolean) => void; onCopy: () => void; onExport: () => void; onBack: () => void;
}) {
  const passCount = checks.filter((check) => check.status === "pass").length;
  const blocked = checks.some((check) => check.status === "block");
  return (
    <div className="stage-content">
      <section className="readiness-card"><div className={`readiness-score ${blocked ? "blocked" : "ready"}`}><span>{passCount}</span><small>/ {checks.length}</small></div><div><span className="stage-kicker">PUBLICATION READINESS</span><h2>{blocked ? "还有项目需要处理" : "发布交付包已准备好"}</h2><p>{blocked ? "完成阻断项后即可导出。警告项可在微信后台最终确认。" : "正文、封面、配图与插图位置已完成校验。"}</p></div></section>
      <div className="check-list">{checks.map((check) => <article className={`check-item ${check.status}`} key={check.id}>{check.status === "pass" ? <CircleCheck size={20} /> : <CircleAlert size={20} />}<div><strong>{check.label}</strong><p>{check.detail}</p></div><span>{check.status === "pass" ? "通过" : check.status === "warning" ? "提醒" : "阻断"}</span></article>)}</div>
      <label className="disclosure-control"><input type="checkbox" checked={snapshot.aiDisclosure} onChange={(event) => onDisclosure(event.target.checked)} /><span className="checkbox-visual">{snapshot.aiDisclosure && <Check size={13} />}</span><span><strong>在发布说明与正文结尾加入 AI 辅助生成提示</strong><small>最终是否展示请结合内容类型与适用规则人工确认。</small></span></label>
      <section className="package-preview"><div><span className="package-icon"><Download size={21} /></span><div><h3>{snapshot.title || "未命名文章"}-发布包.zip</h3><p>正文 HTML / Markdown · 封面 · {snapshot.images.filter((image) => image.kind === "inline").length} 张正文图 · 插图清单 · 来源版权清单</p></div></div><div className="package-actions"><button className="button secondary" onClick={onCopy}><Clipboard size={16} /> 复制公众号正文</button><button className="button primary" onClick={onExport} disabled={blocked || busy === "export"}>{busy === "export" ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} 导出发布包</button></div></section>
      <div className="stage-footer"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回配图排版</button></div>
    </div>
  );
}

function PreviewPane({ snapshot }: { snapshot: ArticleSnapshot }) {
  const [mode, setMode] = useState<"phone" | "html">("phone");
  const cover = snapshot.images.find((image) => image.kind === "cover");
  const inlineBySlot = new Map(snapshot.images.filter((image) => image.kind === "inline").map((image) => [image.slot, image]));
  return (
    <aside className="preview-pane">
      <div className="preview-toolbar"><div><button className={mode === "phone" ? "active" : ""} onClick={() => setMode("phone")}>手机预览</button><button className={mode === "html" ? "active" : ""} onClick={() => setMode("html")}>排版 HTML</button></div><span>375 px</span></div>
      {mode === "phone" ? (
        <div className="phone-frame"><div className="phone-notch" /><div className={`phone-content preview-theme-${snapshot.theme}`}>
          <div className="wechat-titlebar"><ArrowLeft size={18} /><span>预览</span><MoreHorizontal size={19} /></div>
          <article>
            {cover?.url && <img className="phone-cover" src={cover.url} alt="文章封面" />}
            <h1>{snapshot.title || selectedAngle(snapshot)?.title || snapshot.brief.topic}</h1>
            <div className="article-meta"><span>墨舟内容实验室</span><span>{new Date().toLocaleDateString("zh-CN")}</span></div>
            {snapshot.digest && <p className="phone-digest">{snapshot.digest}</p>}
            {snapshot.sections.length ? snapshot.sections.map((section) => {
              const image = section.imageSlot ? inlineBySlot.get(section.imageSlot) : undefined;
              return <section key={section.id}>{section.heading.trim() ? <h2>{section.heading}</h2> : null}{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.imageSlot && (image?.url ? <figure><img src={image.url} alt={image.caption} /><figcaption>{image.caption}</figcaption></figure> : <div className="phone-slot"><ImageIcon size={18} /><span>{section.imageSlot}</span></div>)}</section>;
            }) : <EmptyPreview snapshot={snapshot} />}
            {snapshot.aiDisclosure && snapshot.sections.length > 0 && <p className="phone-disclosure">本文由 AI 辅助整理与生成，经作者人工编辑与审核。</p>}
          </article>
        </div></div>
      ) : (
        <div className="html-preview" dangerouslySetInnerHTML={{ __html: buildArticleHtml(snapshot, true) }} />
      )}
      <div className="preview-footnote"><CircleAlert size={14} /><span>此处为近似预览，请以微信后台最终预览为准。</span></div>
    </aside>
  );
}

function EmptyPreview({ snapshot }: { snapshot: ArticleSnapshot }) {
  return <div className="empty-preview"><span className="empty-preview-icon"><Sparkles size={22} /></span><h3>内容会在这里实时成形</h3><p>{snapshot.step === "brief" ? "先完成创作简报，系统会从研究角度开始。" : "确认研究方向与检索任务后，再生成读者成稿。"}</p><div><i /><i /><i /><i /></div></div>;
}
