import type { WritingProfile } from "./product-types";

export type ProfileSample = {
  title: string;
  content: string;
  tags?: string;
};

const DEFAULT_AVOID = [
  "在当今快速发展的时代",
  "随着时代的发展",
  "值得注意的是",
  "不难发现",
  "综上所述",
  "总而言之",
  "赋能",
  "重塑",
  "闭环",
];

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function compact(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function unique(values: string[], limit = 6) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

export function buildDeterministicWritingProfile(samples: ProfileSample[]): WritingProfile {
  if (!samples.length) {
    return {
      summary: "尚未收录范例。生成时将使用克制、具体、接近真实公众号编辑的默认写法。",
      titlePatterns: ["直接呈现具体对象、冲突或读者利益", "不强行使用冒号、口号和宏大判断"],
      openingPatterns: ["从具体场景、事实或读者问题进入", "前两段尽快交代文章为什么值得读"],
      structurePatterns: ["每一节解决一个清楚的问题", "先事实或场景，再判断，最后给行动或余味"],
      rhythmPatterns: ["长短句交替", "段落不过度整齐，保留自然停顿"],
      preferredExpressions: ["具体名词和动作", "可核验细节", "有分寸的个人判断"],
      avoidExpressions: DEFAULT_AVOID,
      editorRules: ["不为显得专业而堆抽象词", "不把每个主题都转成 AI 或方法论", "没有证据时不编案例和数字"],
    };
  }

  const titles = samples.map((sample) => compact(sample.title)).filter(Boolean);
  const paragraphs = samples.flatMap((sample) => sample.content.split(/\n\s*\n/).map(compact).filter(Boolean));
  const sentences = samples.flatMap((sample) => sample.content.split(/[。！？!?；;]/).map(compact).filter(Boolean));
  const titleLength = average(titles.map((title) => title.length));
  const paragraphLength = average(paragraphs.map((paragraph) => paragraph.length));
  const sentenceLength = average(sentences.map((sentence) => sentence.length));
  const questionRate = titles.length ? titles.filter((title) => /[？?]/.test(title)).length / titles.length : 0;
  const numberRate = titles.length ? titles.filter((title) => /\d/.test(title)).length / titles.length : 0;
  const quoteRate = titles.length ? titles.filter((title) => /[《「“]/.test(title)).length / titles.length : 0;
  const firstParagraphs = samples.map((sample) => compact(sample.content.split(/\n\s*\n/)[0] ?? "")).filter(Boolean);

  const titleSignals = [
    `标题通常约 ${titleLength || 18} 字`,
    questionRate >= 0.35 ? "常用真实问题制造阅读动机" : "较少依赖问句和悬念",
    numberRate >= 0.3 ? "会用数字压缩信息并提高具体度" : "不依赖数字清单式标题",
    quoteRate >= 0.3 ? "常从作品、事件或人物原话切入" : "通常直接交代对象与判断",
  ];
  const openingSignals = [
    firstParagraphs.some((value) => /[？?]$/.test(value)) ? "会用读者正在面对的问题开场" : "倾向直接进入事实、场景或判断",
    firstParagraphs.some((value) => /^(最近|昨天|今天|这几天|那天|我)/.test(value)) ? "常用时间、现场或第一人称拉近距离" : "开场较少寒暄，迅速交代语境",
  ];
  const structureSignals = unique([
    paragraphs.length / samples.length >= 8 ? "偏好多段落推进，一段只承担一个意思" : "结构紧凑，不拆分过多小段",
    samples.some((sample) => /\n#{1,3}\s|\n[一二三四五六七八九十]+[、.]/.test(sample.content))
      ? "会用小标题或序号帮助读者扫读"
      : "主要依靠叙事和转折自然推进",
    "每一节都要带来新信息，避免同义反复",
  ]);

  return {
    summary: `基于 ${samples.length} 篇范例：标题平均约 ${titleLength || 18} 字，句子平均约 ${sentenceLength || 24} 字，段落平均约 ${paragraphLength || 70} 字；整体强调具体对象、自然推进和编辑判断。`,
    titlePatterns: unique(titleSignals),
    openingPatterns: unique(openingSignals),
    structurePatterns: structureSignals,
    rhythmPatterns: unique([`句子平均约 ${sentenceLength || 24} 字，避免连续同长度句式`, `段落平均约 ${paragraphLength || 70} 字，关键信息可独立成短段`, "长短句交替，允许口语化停顿"]),
    preferredExpressions: ["具体的人、事、时间与动作", "能说清来源的事实", "编辑经过判断后留下的结论"],
    avoidExpressions: DEFAULT_AVOID,
    editorRules: ["标题先对读者说人话，再考虑关键词", "一个段落只推进一个意思", "不套用与当前主题无关的 AI、品牌或工作流框架", "保留人的犹豫、取舍和语气变化"],
  };
}

export function normalizeWritingProfile(value: unknown, fallback: WritingProfile): WritingProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const strings = (field: keyof WritingProfile) => Array.isArray(record[field])
    ? unique((record[field] as unknown[]).filter((item): item is string => typeof item === "string"), 8)
    : fallback[field] as string[];
  return {
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim().slice(0, 500) : fallback.summary,
    titlePatterns: strings("titlePatterns"),
    openingPatterns: strings("openingPatterns"),
    structurePatterns: strings("structurePatterns"),
    rhythmPatterns: strings("rhythmPatterns"),
    preferredExpressions: strings("preferredExpressions"),
    avoidExpressions: strings("avoidExpressions"),
    editorRules: strings("editorRules"),
  };
}
