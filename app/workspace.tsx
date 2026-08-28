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
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditorialImage } from "./lib/image-canvas.client";
import {
  DEFAULT_AI_SETTINGS,
  generationHeaders,
  IMAGE_PROVIDER_PRESETS,
  TEXT_PROVIDER_PRESETS,
  type AiSettings,
  type ImageProviderId,
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
  type StoredArticle,
  type ThemeId,
  type TopicAngle,
  type WorkflowStep,
} from "./lib/product-types";

type SaveState = "loading" | "saving" | "saved" | "offline";
type HotspotState = "idle" | "loading" | "loaded" | "error";
type ReferenceImportError = { url: string; error: string };
type ProviderTestState = { status: "idle" | "testing" | "success" | "error"; text: string };

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
    return { ...base, textApiKey: secrets.textApiKey || "", imageApiKey: secrets.imageApiKey || "" };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function storeAiSettings(settings: AiSettings) {
  const publicSettings = { ...settings, textApiKey: "", imageApiKey: "" };
  window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(publicSettings));
  const secrets = JSON.stringify({ textApiKey: settings.textApiKey, imageApiKey: settings.imageApiKey });
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
          setSnapshot(data.articles[0].snapshot);
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
    if (!response.ok) throw new Error((await response.json()).error || "生成失败");
    return (await response.json()) as T;
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
    storeAiSettings(settingsDraft);
    setAiSettings(settingsDraft);
    setSettingsOpen(false);
    setNotice({ type: "success", text: `已切换写作模型：${TEXT_PROVIDER_PRESETS[settingsDraft.textProvider].label} · ${settingsDraft.textModel}` });
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
    updateSnapshot((current) => ({
      ...current,
      brief: { ...current.brief, creationMode: mode },
    }));
    if (mode === "hotspot" && hotspotState === "idle") void loadHotspots();
  };

  const chooseHotspot = (hotspot: Hotspot) => {
    updateSnapshot((current) => {
      const sourceLine = `热点来源：${hotspot.source}｜${hotspot.url}`;
      const existing = current.brief.sourcesText.startsWith("可粘贴") ? "" : current.brief.sourcesText.trim();
      const sourcesText = existing.includes(hotspot.url)
        ? existing
        : [existing, sourceLine].filter(Boolean).join("\n");
      return {
        ...current,
        brief: { ...current.brief, creationMode: "hotspot", topic: hotspot.title, sourcesText },
      };
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
        return {
          ...current,
          brief: {
            ...current.brief,
            creationMode: "rewrite",
            referenceArticles,
            referenceUrls: [
              ...referenceArticles.map((article) => article.url),
              ...(data.errors ?? []).map((item) => item.url),
            ].join("\n"),
            sourcesText: [...new Set([...existingSources, ...importedSources])].join("\n"),
          },
        };
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
    updateSnapshot((current) => ({
      ...current,
      brief: {
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
      },
    }));
  };

  const generateTopics = async () => {
    const mode = snapshot.brief.creationMode ?? "original";
    if (mode === "rewrite" && referenceMaterialText(snapshot.brief).length < 100) {
      setNotice({ type: "error", text: "请先粘贴至少 100 字的参考正文，或读取足量的公开文章内容。" });
      return;
    }
    if (mode !== "rewrite" && !snapshot.brief.topic.trim()) {
      setNotice({ type: "error", text: "先写下一个明确主题，再生成选题角度。" });
      return;
    }
    setBusy("topics");
    try {
      const data = await runGeneration<{ mode: "ai" | "demo"; topics: TopicAngle[]; warning?: string }>({
        action: "topics",
        brief: snapshot.brief,
      });
      updateSnapshot((current) => ({
        ...current,
        topics: data.topics,
        selectedTopicId: data.topics[0]?.id ?? null,
        outline: [],
        title: "",
        digest: "",
        sections: [],
        images: [],
        step: "topics",
        generationMode: data.mode,
      }));
      setNotice({ type: "success", text: data.warning || "已生成 3 个差异化选题角度。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "选题生成失败" });
    } finally {
      setBusy(null);
    }
  };

  const generateOutline = async () => {
    if (!angle) return;
    setBusy("outline");
    try {
      const data = await runGeneration<{ mode: "ai" | "demo"; outline: OutlineItem[]; warning?: string }>({
        action: "outline",
        brief: snapshot.brief,
        angle,
      });
      updateSnapshot((current) => ({ ...current, outline: data.outline, step: "outline", generationMode: data.mode }));
      setNotice({ type: "success", text: data.warning || "大纲已生成，可以逐章调整。" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "大纲生成失败" });
    } finally {
      setBusy(null);
    }
  };

  const generateDraft = async () => {
    if (!angle || !snapshot.outline.length) return;
    setBusy("draft");
    try {
      const data = await runGeneration<{
        mode: "ai" | "demo";
        draft: Pick<ArticleSnapshot, "title" | "digest" | "sections">;
        warning?: string;
      }>({ action: "draft", brief: snapshot.brief, angle, outline: snapshot.outline });
      updateSnapshot((current) => ({
        ...current,
        ...data.draft,
        images: [],
        step: "draft",
        generationMode: data.mode,
      }));
      setNotice({ type: "success", text: data.warning || "正文初稿已完成，请进行人工编辑。" });
    } catch (error) {
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
        ...snapshot.sections
          .filter((section) => section.imageSlot)
          .map((section) => ({
            id: section.imageSlot!.toLowerCase(),
            slot: section.imageSlot!,
            kind: "inline" as const,
            filename: `${section.imageSlot}-${section.heading.slice(0, 12).replace(/\s+/g, "-")}.png`,
            title: section.heading,
            caption: `配图：${section.heading}`,
            prompt: `微信公众号正文插图，表达“${section.heading}”。围绕${snapshot.brief.topic}，${snapshot.brief.tone}，不出现文字。`,
          })),
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
    setSnapshot(article.snapshot);
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
      updateSnapshot((current) => ({
        ...current,
        brief: {
          ...current.brief,
          sourcesText: [
            current.brief.sourcesText.startsWith("可粘贴") ? "" : current.brief.sourcesText,
            `文件：${file.name}`,
            extracted.slice(0, 12000),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      }));
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
          <button><BookOpen size={16} /> 使用指南</button>
          <button onClick={openAiSettings}><Settings2 size={16} /> AI 模型设置</button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-backdrop mobile-only" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}

      <main className="workspace-main">
        <section className="editor-pane">
          <StageHeader snapshot={snapshot} aiSettings={aiSettings} />
          {snapshot.step === "brief" && (
            <BriefStage
              snapshot={snapshot}
              busy={busy}
              onChange={(field, value) =>
                updateSnapshot((current) => ({ ...current, brief: { ...current.brief, [field]: value } }))
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
              onHeading={(index, value) =>
                updateSnapshot((current) => ({
                  ...current,
                  outline: current.outline.map((item, itemIndex) => itemIndex === index ? { ...item, heading: value } : item),
                }))
              }
              onMove={moveOutline}
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
              onBack={() => setStep("outline")}
              onGenerateImages={generateImages}
              onRegenerate={generateDraft}
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
          <div><span>图片生成</span><strong>{imagePreset.label}</strong><small>{settings.imageModel}</small></div>
        </div>

        <div className="settings-scroll">
          <section className="settings-section">
            <div className="settings-section-title"><span>01</span><div><h3>写作模型</h3><p>用于选题、大纲、正文和参考改写。</p></div></div>
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
            <div className="settings-section-title"><span>02</span><div><h3>配图模型</h3><p>与写作服务独立；DeepSeek、Kimi 写文时仍可让 OpenAI 出图。</p></div></div>
            <div className="settings-grid">
              <label className="settings-field"><span>配图方式</span><select value={settings.imageProvider} onChange={(event) => switchImageProvider(event.target.value as ImageProviderId)}><option value="local">本地排版图（免费）</option><option value="openai">OpenAI 图片 API</option><option value="custom">自定义图片接口</option></select></label>
              <label className="settings-field"><span>图片模型</span><input value={settings.imageModel} onChange={(event) => onChange({ imageModel: event.target.value })} disabled={settings.imageProvider === "local"} /></label>
              {settings.imageProvider !== "local" ? <><label className="settings-field full"><span>图片 API Base URL</span><input value={settings.imageBaseUrl} onChange={(event) => onChange({ imageBaseUrl: event.target.value })} inputMode="url" /></label><label className="settings-field full"><span>图片 API Key</span><div className="secret-input"><input type={showKeys ? "text" : "password"} value={settings.imageApiKey} onChange={(event) => onChange({ imageApiKey: event.target.value })} autoComplete="off" placeholder={settings.imageProvider === "openai" && settings.textProvider === "openai" ? "留空则复用上方 OpenAI Key" : "填写图片服务 API Key"} /><button type="button" onClick={() => setShowKeys((current) => !current)}>{showKeys ? "隐藏" : "显示"}</button></div></label></> : <div className="local-image-note"><ImageIcon size={17} /><span><strong>本地生成已启用</strong><small>不消耗 API，输出品牌化封面和信息卡配图。</small></span></div>}
            </div>
          </section>

          <label className="remember-key" htmlFor="remember-api-keys"><input id="remember-api-keys" type="checkbox" aria-label="在此设备记住 API Key" checked={settings.rememberKeys} onChange={(event) => onChange({ rememberKeys: event.target.checked })} /><span><strong>在此设备记住 API Key</strong><small>开启后密钥会保存在本机浏览器；公用设备请勿开启。</small></span></label>
          <div className="key-safety-note"><Settings2 size={16} /><p>密钥只随生成请求发送给所选 API，不写入文章数据库、参考资料或导出包。关闭“记住”时，关闭浏览器会话后密钥失效。</p></div>
        </div>

        <footer className="settings-footer"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" onClick={onSave}>保存并使用</button></footer>
      </section>
    </div>
  );
}

function StageHeader({ snapshot, aiSettings }: { snapshot: ArticleSnapshot; aiSettings: AiSettings }) {
  const step = WORKFLOW_STEPS.find((item) => item.id === snapshot.step)!;
  return (
    <div className="stage-header">
      <div>
        <span className="stage-kicker">STEP {step.index}</span>
        <h1>{step.label}</h1>
        <p>{step.description} · {snapshot.generationMode === "ai" ? `${TEXT_PROVIDER_PRESETS[aiSettings.textProvider].label} · ${aiSettings.textModel}` : "可运行演示模式"}</p>
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
        <div className="ai-note"><Sparkles size={16} /><span>{mode === "rewrite" ? "系统会保留事实并重做结构与表达，不会直接照搬原文。" : mode === "hotspot" ? "热点只作为选题线索；系统会区分已知事实与观点。" : "系统会先给出三个角度，不会直接生成整篇文章。"}</span></div>
        <button className="button primary large" onClick={onGenerate} disabled={busy === "topics"}>
          {busy === "topics" ? <LoaderCircle size={18} className="spin" /> : <WandSparkles size={18} />} 生成选题角度 <ArrowRight size={17} />
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
      <div className="topic-intro"><div><h2>同一个主题，先选叙事角度</h2><p>每个角度对应不同的开场、核心判断和证据需求。</p></div><button className="button ghost" onClick={onRegenerate} disabled={busy === "topics"}><RefreshCw size={15} className={busy === "topics" ? "spin" : ""} /> 换一组选题</button></div>
      <div className="topic-cards">
        {snapshot.topics.map((topic, index) => {
          const selected = topic.id === snapshot.selectedTopicId;
          return (
            <button className={`topic-card ${selected ? "selected" : ""}`} key={topic.id} onClick={() => onSelect(topic.id)}>
              <span className="topic-index">0{index + 1}</span>
              <span className={`radio-mark ${selected ? "checked" : ""}`}>{selected && <Check size={13} />}</span>
              <span className="topic-strategy">{index === 0 ? "方法切口" : index === 1 ? "反思切口" : "案例切口"}</span>
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
        <button className="button primary large" onClick={onGenerate} disabled={!snapshot.selectedTopicId || busy === "outline"}>{busy === "outline" ? <LoaderCircle size={18} className="spin" /> : <LayoutTemplate size={18} />} 用这个角度生成大纲 <ArrowRight size={17} /></button>
      </div>
    </div>
  );
}

function OutlineStage({ snapshot, busy, onHeading, onMove, onBack, onGenerate, onRegenerate }: {
  snapshot: ArticleSnapshot; busy: string | null; onHeading: (index: number, value: string) => void; onMove: (index: number, direction: -1 | 1) => void; onBack: () => void; onGenerate: () => void; onRegenerate: () => void;
}) {
  return (
    <div className="stage-content">
      <div className="topic-intro"><div><h2>先确认骨架，再写正文</h2><p>拖动思路被简化为上下移动；标题可直接编辑。</p></div><button className="button ghost" onClick={onRegenerate} disabled={busy === "outline"}><RefreshCw size={15} className={busy === "outline" ? "spin" : ""} /> 重做大纲</button></div>
      <div className="outline-list">
        {snapshot.outline.map((item, index) => (
          <article className="outline-item" key={item.id}>
            <div className="outline-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="outline-body">
              <input className="outline-heading-input" value={item.heading} onChange={(event) => onHeading(index, event.target.value)} aria-label={`第 ${index + 1} 章标题`} />
              <p>{item.purpose}</p>
              <ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
            </div>
            <div className="outline-actions"><button onClick={() => onMove(index, -1)} disabled={index === 0} aria-label="上移"><ArrowUp size={15} /></button><button onClick={() => onMove(index, 1)} disabled={index === snapshot.outline.length - 1} aria-label="下移"><ArrowDown size={15} /></button></div>
          </article>
        ))}
      </div>
      <div className="stage-footer between"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回选题</button><button className="button primary large" onClick={onGenerate} disabled={busy === "draft"}>{busy === "draft" ? <LoaderCircle size={18} className="spin" /> : <FileText size={18} />} 生成正文初稿 <ArrowRight size={17} /></button></div>
    </div>
  );
}

function DraftStage({ snapshot, busy, onTitle, onDigest, onSection, onBack, onGenerateImages, onRegenerate }: {
  snapshot: ArticleSnapshot; busy: string | null; onTitle: (value: string) => void; onDigest: (value: string) => void; onSection: (index: number, field: "heading" | "paragraphs", value: string) => void; onBack: () => void; onGenerateImages: () => void; onRegenerate: () => void;
}) {
  return (
    <div className="stage-content">
      <div className="draft-toolbar"><span><FileText size={15} /> 约 {articleCharacterCount(snapshot)} 字</span><button className="button ghost" onClick={onRegenerate} disabled={busy === "draft"}><RefreshCw size={15} className={busy === "draft" ? "spin" : ""} /> 重生成整篇</button></div>
      <section className="article-editor">
        <input className="article-title-input" value={snapshot.title} onChange={(event) => onTitle(event.target.value)} aria-label="文章标题" />
        <textarea className="digest-input" value={snapshot.digest} onChange={(event) => onDigest(event.target.value)} rows={3} aria-label="文章摘要" />
        {snapshot.sections.map((section, index) => (
          <div className="section-editor" key={section.id}>
            <div className="section-meta"><span>SECTION {String(index + 1).padStart(2, "0")}</span>{section.imageSlot && <span className="slot-chip"><ImageIcon size={13} /> {section.imageSlot}</span>}</div>
            <input className="section-heading-input" value={section.heading} onChange={(event) => onSection(index, "heading", event.target.value)} aria-label={`第 ${index + 1} 节标题`} />
            <textarea value={section.paragraphs.join("\n\n")} onChange={(event) => onSection(index, "paragraphs", event.target.value)} rows={Math.max(6, section.paragraphs.join("\n").length / 42)} aria-label={`第 ${index + 1} 节正文`} />
          </div>
        ))}
      </section>
      <div className="stage-footer between"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> 返回大纲</button><button className="button primary large" onClick={onGenerateImages} disabled={busy === "images"}>{busy === "images" ? <LoaderCircle size={18} className="spin" /> : <ImageIcon size={18} />} 生成封面与正文配图 <ArrowRight size={17} /></button></div>
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
              return <section key={section.id}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.imageSlot && (image?.url ? <figure><img src={image.url} alt={image.caption} /><figcaption>{image.caption}</figcaption></figure> : <div className="phone-slot"><ImageIcon size={18} /><span>{section.imageSlot}</span></div>)}</section>;
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
  return <div className="empty-preview"><span className="empty-preview-icon"><Sparkles size={22} /></span><h3>内容会在这里实时成形</h3><p>{snapshot.step === "brief" ? "先完成创作简报，系统会从选题角度开始。" : "确认选题与大纲后生成正文。"}</p><div><i /><i /><i /><i /></div></div>;
}
