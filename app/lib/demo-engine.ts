import {
  referenceMaterialText,
  type ArticleSection,
  type Brief,
  type OutlineItem,
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
  const sectionOutline = outline.length ? outline : buildDemoOutline(angle);
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
    title: angle.title || `换个角度理解：${referenceTopic(brief)}`,
    digest: `在不新增事实的前提下，重新组织参考文章关于「${referenceTopic(brief)}」的核心信息与表达顺序。`,
    sections,
  };
}

export function buildDemoTopics(brief: Brief): TopicAngle[] {
  const topic = referenceTopic(brief);
  const audience = brief.audience.trim() || "目标读者";
  return [
    {
      id: "angle-practical",
      title: `别急着追工具：先重做「${topic}」的工作流`,
      hook: "从一个常见误区切入：效率问题往往不是工具太少，而是流程没有拆开。",
      thesis: `真正有价值的改变，不是替 ${audience} 一键生成更多内容，而是把判断、创作与交付重新组织。`,
      readerGain: "获得一套可以本周开始执行的四步工作法。",
      evidenceNeeds: ["当前内容流程耗时", "重复劳动环节", "人工审核边界"],
    },
    {
      id: "angle-contrarian",
      title: `${topic}，最容易被忽略的不是效率，而是可信度`,
      hook: "用反直觉观点开场，把讨论从“更快”转向“更可靠”。",
      thesis: "当生成速度不再稀缺，来源、品牌一致性和人工责任才成为真正的护城河。",
      readerGain: "学会判断一套 AI 内容方案是否真的能用于业务。",
      evidenceNeeds: ["事实核验案例", "品牌一致性问题", "内容风险清单"],
    },
    {
      id: "angle-story",
      title: `从 4 小时到 30 分钟：一次「${topic}」流程改造`,
      hook: "用一篇文章从选题到发布的时间线，带读者看见每个隐形成本。",
      thesis: "可复用的简报、结构化正文和编号配图，比单次生成出一篇漂亮文章更重要。",
      readerGain: "看到改造前后对比，并能照着建立自己的内容生产线。",
      evidenceNeeds: ["改造前后时间记录", "发布步骤", "质量验收标准"],
    },
  ];
}

export function buildDemoOutline(angle: TopicAngle): OutlineItem[] {
  return [
    {
      id: "outline-1",
      heading: "看似缺内容，其实缺的是一条稳定流程",
      purpose: `建立问题共识，解释“${angle.title}”为什么不能只靠增加工具解决。`,
      bullets: ["描述典型创作现场", "指出工具切换和重复返工", "引出核心判断"],
    },
    {
      id: "outline-2",
      heading: "把创作拆成四个可以检查的阶段",
      purpose: "给出文章的核心方法，让读者形成清晰记忆点。",
      bullets: ["简报与选题", "证据与大纲", "正文与配图", "检查与交付"],
    },
    {
      id: "outline-3",
      heading: "AI 应该负责什么，人必须保留什么",
      purpose: "建立可信边界，避免把自动化误解为无人负责。",
      bullets: ["AI 负责扩展与初稿", "人负责判断与事实", "发布权必须留在人手里"],
    },
    {
      id: "outline-4",
      heading: "从一个高频栏目开始，而不是重做全部系统",
      purpose: "以低门槛行动方案收束全文。",
      bullets: ["选择一个栏目", "记录基准时间", "连续运行三期", "复盘采用率与错误"],
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
  const audience = brief.audience || "内容团队";
  const callToAction =
    brief.callToAction || "从一个最常发布的栏目开始，连续试运行三期。";

  const paragraphSets = [
    [
      `很多团队谈到「${topic}」时，第一反应是再找一个更强的生成工具。输入一句话，几分钟后得到标题、正文和图片，看起来所有问题都被解决了。真正进入发布环节后，新的麻烦才出现：事实要重新核对，段落不符合账号口吻，图片不知道插在哪里，排版还要从头调整。`,
      `问题不在于生成速度，而在于创作过程没有被拆成可确认的步骤。对${audience}来说，一篇能发布的文章不是一段文字，而是一组彼此关联的判断、证据、结构、图片和交付规范。只加快其中一个环节，往往只是让返工来得更早。`,
    ],
    [
      `一条稳定流程应从创作简报开始。先写清楚这篇文章要影响谁、希望读者看完后做什么、哪些观点不能妥协。接着才是选择角度：同一个主题可以做方法、反思或案例，角度不同，所需证据和文章节奏也完全不同。`,
      `大纲确认后再写正文，可以把“生成一篇文章”变成“逐段完成一个任务”。每个章节都有明确目的，事实性表达能追溯到资料，图片也不再是装饰，而是承担解释、转场或强化记忆的功能。最后，正文中的 IMG-01、IMG-02 与同名图片一一对应，人工发布时不再来回猜测。`,
    ],
    [
      `AI 很适合扩展角度、整理资料、提出结构和完成第一版表达，但它不应该替品牌做最终判断。涉及数字、人物身份、政策和专业建议的内容，需要人确认来源；涉及品牌立场、承诺和发布时机的内容，更不能被一次生成直接带过。`,
      `这也是为什么“人工上传发布”不是落后的妥协，而是一条清晰的责任边界。系统把耗时的准备工作压缩，把文章、封面、正文图和插图清单整理好；用户保留最终预览与发布动作。自动化负责减少机械劳动，人负责对结果签字。`,
    ],
    [
      `最稳妥的开始方式，是选择一个每周都会出现的栏目。记录现在从选题到发布需要多长时间，再用同一套简报、选题、大纲和配图流程连续运行三期。不要只看生成用了几分钟，要记录初稿保留了多少、事实修改了几处、图片重做了几次，以及发布时是否还会漏图。`,
      `当一套流程能稳定交付，才值得把它复制到更多栏目。${callToAction} 真正的效率不是某一次写得特别快，而是下一次不必重新发明方法。`,
    ],
  ];

  const minimum = targetMinimum(brief.length);
  const compactLimit = minimum <= 600 ? 110 : minimum <= 1200 ? 230 : null;

  return {
    title: angle.title,
    digest: `围绕「${topic}」，这篇文章给出一套从简报、选题到配图交付的可执行方法，并说明 AI 与人工审核的边界。`,
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
