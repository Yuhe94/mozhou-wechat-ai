export type WorkflowStep =
  | "brief"
  | "topics"
  | "outline"
  | "draft"
  | "visuals"
  | "check";

export type ThemeId = "paper" | "ink" | "sage";

export type CreationMode = "original" | "rewrite" | "hotspot";

export interface ReferenceArticle {
  url: string;
  title: string;
  account: string;
  description: string;
  text: string;
  characterCount: number;
}

export interface Brief {
  creationMode?: CreationMode;
  topic: string;
  audience: string;
  goal: string;
  tone: string;
  length: string;
  callToAction: string;
  sourcesText: string;
  referenceArticle?: string;
  referenceUrls?: string;
  referenceArticles?: ReferenceArticle[];
}

export function referenceMaterialText(brief: Brief) {
  const imported = (brief.referenceArticles ?? []).map(
    (article) => `【${article.title}｜${article.account || "微信公众号"}】\n${article.text}`,
  );
  return [brief.referenceArticle?.trim(), ...imported].filter(Boolean).join("\n\n");
}

export interface Hotspot {
  id: string;
  rank: number;
  title: string;
  summary: string;
  heat?: string;
  source: string;
  url: string;
}

export interface TopicAngle {
  id: string;
  title: string;
  hook: string;
  thesis: string;
  readerGain: string;
  evidenceNeeds: string[];
}

export interface OutlineItem {
  id: string;
  heading: string;
  purpose: string;
  bullets: string[];
  searchQueries?: string[];
}

export interface ResearchPlan {
  centralQuestion: string;
  readerTension: string;
  narrativeRoute: string;
  exclusion: string;
}

export interface ResearchSource {
  title: string;
  url: string;
  domain: string;
  publishedAt?: string;
  query: string;
  channel?: "user" | "platform" | "wechat" | "official" | "brave" | "gdelt";
  region?: "cn" | "hk" | "tw" | "global";
  retrieval?: "fulltext" | "snippet";
}

export interface ResearchReport {
  region: "auto" | "cn" | "hk" | "tw" | "all";
  channels: string[];
  warnings: string[];
  status?: "ready" | "insufficient";
  evidenceMode?: "fulltext" | "mixed" | "corroborated-snippets" | "brief-only" | "insufficient";
  missingEvidence?: string[];
}

export interface ArticleSection {
  id: string;
  heading: string;
  paragraphs: string[];
  imageSlot?: string;
}

export interface GeneratedImage {
  id: string;
  slot: string;
  kind: "cover" | "inline";
  filename: string;
  title: string;
  prompt: string;
  caption: string;
  url?: string;
  source: "ai" | "local";
}

export interface ArticleSnapshot {
  version: number;
  step: WorkflowStep;
  brief: Brief;
  topics: TopicAngle[];
  selectedTopicId: string | null;
  researchPlan?: ResearchPlan;
  outline: OutlineItem[];
  researchSources?: ResearchSource[];
  researchReport?: ResearchReport;
  title: string;
  digest: string;
  sections: ArticleSection[];
  images: GeneratedImage[];
  theme: ThemeId;
  aiDisclosure: boolean;
  generationMode: "ai" | "demo";
  updatedAt: string;
}

export interface StoredArticle {
  id: string;
  title: string;
  status: string;
  snapshot: ArticleSnapshot;
  createdAt: string;
  updatedAt: string;
}

export type WritingExampleSource = "paste" | "upload" | "finalized";

export interface WritingExample {
  id: string;
  title: string;
  tags: string;
  source: WritingExampleSource;
  characterCount: number;
  excerpt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WritingProfile {
  summary: string;
  titlePatterns: string[];
  openingPatterns: string[];
  structurePatterns: string[];
  rhythmPatterns: string[];
  preferredExpressions: string[];
  avoidExpressions: string[];
  editorRules: string[];
}

export interface WritingStyleContext {
  profile: WritingProfile | null;
  examples: Array<{
    title: string;
    tags: string;
    source: WritingExampleSource;
    excerpt: string;
  }>;
}

export interface QualityCheck {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "warning" | "block";
}

export const WORKFLOW_STEPS: Array<{
  id: WorkflowStep;
  index: string;
  label: string;
  description: string;
}> = [
  { id: "brief", index: "01", label: "创作简报", description: "明确主题与读者" },
  { id: "topics", index: "02", label: "研究角度", description: "选择分析方向" },
  { id: "outline", index: "03", label: "研究提纲", description: "编辑问题与检索词" },
  { id: "draft", index: "04", label: "读者成稿", description: "终审改写与编辑" },
  { id: "visuals", index: "05", label: "配图排版", description: "生成插图与预览" },
  { id: "check", index: "06", label: "检查导出", description: "生成发布交付包" },
];

export function createBlankSnapshot(): ArticleSnapshot {
  return {
    version: 1,
    step: "brief",
    brief: {
      creationMode: "original",
      topic: "",
      audience: "对该主题感兴趣的公众号读者",
      goal: "帮助读者理解主题的背景、核心问题与实际影响",
      tone: "专业、克制、有判断",
      length: "1800–2200 字",
      callToAction: "引导读者基于可靠信息形成自己的判断",
      sourcesText: "可粘贴参考链接、采访笔记或关键数据；每行一条。",
      referenceArticle: "",
      referenceUrls: "",
      referenceArticles: [],
    },
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
    theme: "paper",
    aiDisclosure: true,
    generationMode: "demo",
    // Keep the server and browser's first render identical; a live timestamp is
    // assigned when a new article is persisted or edited.
    updatedAt: "2000-01-01T00:00:00.000Z",
  };
}
