import {
  referenceMaterialText,
  type ArticleSection,
  type Brief,
  type OutlineItem,
  type ResearchPlan,
  type TopicAngle,
} from "./product-types";

function cleanTopic(topic: string) {
  return topic.trim().replace(/[。！？!?]+$/g, "") || "一个值得长期投入的内容主题";
}

function targetMinimum(length: string) {
  return Number.parseInt(length.match(/\d+/)?.[0] ?? "1200", 10);
}

function shorten(value: string, limit: number) {
  if (value.length <= limit) return value;
  const clipped = value.slice(0, limit);
  const lastStop = Math.max(clipped.lastIndexOf("。"), clipped.lastIndexOf("；"), clipped.lastIndexOf("，"));
  return `${clipped.slice(0, lastStop > limit * 0.6 ? lastStop + 1 : limit)}…`;
}

function referenceTopic(brief: Brief) {
  if (brief.topic.trim()) return cleanTopic(brief.topic);
  const firstSentence = referenceMaterialText(brief).match(/[^。！？!?]+/)?.[0]?.trim();
  return cleanTopic(firstSentence?.slice(0, 28) ?? "这篇参考文章");
}

function rewriteSentence(value: string, index: number) {
  const replacements: Array<[RegExp, string]> = [
    [/近年来/g, "最近几年"],
    [/通过/g, "借助"],
    [/因此/g, "由此"],
    [/同时/g, "与此同时"],
    [/但是/g, "不过"],
    [/需要/g, "应当"],
    [/重要/g, "关键"],
    [/表明/g, "说明"],
    [/认为/g, "指出"],
  ];
  const rewritten = replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value.trim());
  const prefixes = ["换个角度看，", "真正值得留意的是，", "把视线拉近会发现，", "回到实际场景中，"];
  return `${prefixes[index % prefixes.length]}${rewritten}`;
}

function buildDemoRewriteDraft(
  brief: Brief,
  angle: TopicAngle,
  outline: OutlineItem[],
): { title: string; digest: string; sections: ArticleSection[] } {
  const source = referenceMaterialText(brief);
  const sentences = source.match(/[^。！？!?]+[。！？!?]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
  const safeSentences = sentences.length ? sentences : ["参考文章信息不足，请补充完整原文后再进行改写。"];
  const perSection = targetMinimum(brief.length) <= 600 ? 1 : 2;
  const sectionOutline = outline.length ? outline : buildDemoOutline(angle, brief);
  const sections = sectionOutline.slice(0, 4).map((item, sectionIndex) => {
    const selected = Array.from({ length: perSection }, (_, itemIndex) =>
      safeSentences[(sectionIndex * perSection + itemIndex) % safeSentences.length],
    );
    return {
      id: `section-${sectionIndex + 1}`,
      heading: item.heading,
      paragraphs: selected.map((sentence, itemIndex) =>
        rewriteSentence(sentence, sectionIndex + itemIndex),
      ),
      imageSlot: sectionIndex === 1 ? "IMG-01" : sectionIndex === 2 ? "IMG-02" : undefined,
    };
  });
  return {
    title: `${referenceTopic(brief)}，原文没有讲清楚的几个问题`,
    digest: `在不新增事实的前提下，重新组织参考文章关于「${referenceTopic(brief)}」的核心信息与表达顺序。`,
    sections,
  };
}

export function buildDemoTopics(brief: Brief): TopicAngle[] {
  const topic = referenceTopic(brief);
  const audience = brief.audience.trim() || "目标读者";
  return [
    {
      id: "angle-context",
      title: "事实边界与制度背景",
      hook: `围绕「${topic}」先定位读者最容易混淆的信息，把事实、观点和待核内容分开。`,
      thesis: `对${audience}而言，理解这一主题的第一步不是追随热度，而是建立清晰、可靠的信息框架。`,
      readerGain: "快速掌握背景、核心问题和需要继续核实的信息。",
      evidenceNeeds: ["事件或主题背景", "权威来源与时间线", "仍待核实的问题"],
    },
    {
      id: "angle-contrarian",
      title: "热度背后的关键矛盾",
      hook: "从一个容易被忽略的矛盾切入，区分表面讨论与真正影响。",
      thesis: "热点会变化，但事件背后的原因、影响对象和判断边界更值得持续关注。",
      readerGain: "获得一个不被单一热搜叙事带着走的观察角度。",
      evidenceNeeds: ["主要争议点", "不同群体的影响", "常见误解或信息缺口"],
    },
    {
      id: "angle-timeline",
      title: "时间线与影响路径",
      hook: "沿着关键节点推进，让复杂信息变得容易跟随。",
      thesis: "把前因、节点和后续影响放在同一条时间线上，才能避免只看见孤立片段。",
      readerGain: "看清事件如何发展，以及接下来应该关注哪些可靠信号。",
      evidenceNeeds: ["关键时间节点", "相关方公开信息", "后续观察指标"],
    },
  ];
}

export function buildDemoResearchPlan(brief: Brief, angle: TopicAngle): ResearchPlan {
  const topic = referenceTopic(brief);
  return {
    centralQuestion: `围绕「${topic}」，哪一处事实最可能改变读者现在的判断？`,
    readerTension: angle.thesis,
    narrativeRoute: brief.creationMode === "hotspot"
      ? "从热搜里最具体的一句话或一个动作进入，追到原始上下文，再用相互冲突的材料推动判断。"
      : "从一个可感知的细节进入，只补会改变结论的背景，让核心矛盾自然浮现。",
    exclusion: "不做百科式背景罗列，不平均照顾所有分支，不写万能建议。",
  };
}

export function buildDemoOutline(angle: TopicAngle, brief?: Brief): OutlineItem[] {
  const topic = brief ? referenceTopic(brief) : angle.title;
  return [
    {
      id: "outline-1",
      heading: `找到「${topic}」最值得作为开场的具体材料`,
      purpose: "拿到一句原话、一个动作或一组数据，让读者立刻进入事件，而不是先听背景介绍。",
      bullets: ["最接近现场或原始发布的材料", "能够独立核验其时间和身份的信息"],
      searchQueries: [`${topic} 原话 现场`, `${topic} 官方 发布`],
    },
    {
      id: "outline-2",
      heading: `追清“${angle.title}”里真正冲突的两种说法`,
      purpose: "确认分歧来自事实不同、立场不同，还是同一句话被截取了不同部分。",
      bullets: ["两种观点各自引用的依据", "被忽略的上下文", "会改变结论的反例"],
      searchQueries: [`${topic} 争议 原文`, `${topic} 不同观点`],
    },
    {
      id: "outline-3",
      heading: "只补一段会改变理解的背景",
      purpose: "从已有材料中判断读者缺哪一块背景；如果不影响核心判断，就不写。",
      bullets: ["与核心矛盾直接相关的制度、关系或前情"],
      searchQueries: [`${topic} 背景 关键节点`],
    },
  ];
}

export function buildDemoDraft(
  brief: Brief,
  angle: TopicAngle,
  outline: OutlineItem[],
): { title: string; digest: string; sections: ArticleSection[] } {
  if (brief.creationMode === "rewrite" && referenceMaterialText(brief)) {
    return buildDemoRewriteDraft(brief, angle, outline);
  }

  const topic = referenceTopic(brief);
  const audience = brief.audience || "目标读者";
  const callToAction =
    brief.callToAction || "基于可靠信息形成自己的判断。";
  const sourceLines = brief.sourcesText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("可粘贴"));
  const sourceStatus = sourceLines.length
    ? `简报中已经提供 ${sourceLines.length} 条资料线索，正式发布前仍应逐项核对原始来源。`
    : "当前简报尚未提供足够资料，涉及事实、数字和人物的信息应在发布前补充可靠来源。";

  const paragraphSets = [
    [
      `围绕「${topic}」，首先要把已经确认的信息、仍待核实的说法和编辑观点分开。${sourceStatus}`,
      `对${audience}来说，清楚的背景和时间线比情绪化结论更有价值。本节应先回答“发生了什么”，再说明哪些信息目前还不能下定论。`,
    ],
    [
      `理解「${topic}」不能只停留在表面热度，还要继续追问原因、关键矛盾和不同说法各自依据什么。缺少证据的判断应明确标记，而不是用肯定语气补全。`,
      `这一部分可以围绕大纲中的核心问题逐层展开，让读者看见事实如何支持判断，也看见目前仍然存在的不确定性。`,
    ],
    [
      `同一件事对不同人群、地区和时间阶段的影响可能并不相同。讨论「${topic}」时，应分别说明谁受到影响、影响通过什么路径发生，以及哪些后果只是推测。`,
      `把短期反应和长期变化分开，有助于避免把个别现象扩大成普遍结论，也能让读者更准确地判断这件事与自己的关系。`,
    ],
    [
      `文章最后不必急于给出过度确定的预测。更稳妥的做法是列出接下来值得关注的公开信息、关键节点和判断边界，让读者知道哪些变化会影响结论。`,
      `${callToAction} 对尚未确认的部分保持克制，对已有可靠来源的信息说清依据，这比追求一个仓促而完整的答案更重要。`,
    ],
  ];

  const minimum = targetMinimum(brief.length);
  const compactLimit = minimum <= 600 ? 110 : minimum <= 1200 ? 230 : null;

  return {
    title: `${topic}：正式动笔前，还需要补齐这些事实`,
    digest: `围绕「${topic}」，文章按照背景、核心问题、现实影响和后续判断四个层次梳理信息，并明确区分已知事实与待核内容。`,
    sections: outline.map((item, index) => ({
      id: `section-${index + 1}`,
      heading: item.heading,
      paragraphs: compactLimit
        ? [shorten((paragraphSets[index] ?? paragraphSets[paragraphSets.length - 1])[0], compactLimit)]
        : paragraphSets[index] ?? paragraphSets[paragraphSets.length - 1],
      imageSlot: index === 1 ? "IMG-01" : index === 2 ? "IMG-02" : undefined,
    })),
  };
}
