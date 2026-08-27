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
  outline: OutlineItem[];
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
  { id: "topics", index: "02", label: "选题角度", description: "选择叙事切口" },
  { id: "outline", index: "03", label: "文章大纲", description: "确认内容骨架" },
  { id: "draft", index: "04", label: "正文编辑", description: "成稿与局部修改" },
  { id: "visuals", index: "05", label: "配图排版", description: "生成插图与预览" },
  { id: "check", index: "06", label: "检查导出", description: "生成发布交付包" },
];

export function createBlankSnapshot(): ArticleSnapshot {
  return {
    version: 1,
    step: "brief",
    brief: {
      creationMode: "original",
      topic: "AI 如何改变中小企业的内容运营",
      audience: "负责品牌内容但人手有限的中小企业经营者与运营负责人",
      goal: "帮助读者理解 AI 内容工作流的价值，并给出可立即执行的方法",
      tone: "专业、克制、有判断",
      length: "1800–2200 字",
      callToAction: "邀请读者梳理自己的内容流程，从一个高频栏目开始试验",
      sourcesText: "可粘贴参考链接、采访笔记或关键数据；每行一条。",
      referenceArticle: "",
      referenceUrls: "",
      referenceArticles: [],
    },
    topics: [],
    selectedTopicId: null,
    outline: [],
    title: "",
    digest: "",
    sections: [],
    images: [],
    theme: "paper",
    aiDisclosure: true,
    generationMode: "demo",
    updatedAt: new Date().toISOString(),
  };
}
