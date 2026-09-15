import type { ResearchReport, ResearchSource } from "./product-types";

export type ResearchMaterial = {
  source: ResearchSource;
  text: string;
};

export type EvidenceAssessment = {
  ready: boolean;
  evidenceMode: NonNullable<ResearchReport["evidenceMode"]>;
  missingEvidence: string[];
  fulltextCount: number;
  snippetCount: number;
  independentSourceCount: number;
};

function compactLength(value: string) {
  return value.replace(/\s+/g, "").length;
}

function sourceKey(material: ResearchMaterial) {
  return material.source.url || `${material.source.domain}:${material.source.title}`;
}

function publisherKey(material: ResearchMaterial) {
  if (material.source.channel === "wechat" && material.source.domain === "weixin.sogou.com") {
    const parts = material.source.title.split("｜").map((part) => part.trim()).filter(Boolean);
    const account = parts.length > 1 ? parts.at(-1) : "";
    if (account) return `wechat:${account}`;
  }
  return material.source.domain.toLowerCase();
}

export function assessResearchEvidence(materials: ResearchMaterial[], isHotspot: boolean): EvidenceAssessment {
  const unique = materials.filter((material, index, all) => (
    all.findIndex((candidate) => sourceKey(candidate) === sourceKey(material)) === index
  ));
  const fulltext = unique.filter((material) => (
    material.source.retrieval === "fulltext" && compactLength(material.text) >= 180
  ));
  const snippets = unique.filter((material) => (
    material.source.retrieval !== "fulltext" && compactLength(material.text) >= 60
  ));
  const fulltextCharacters = fulltext.reduce((total, material) => total + compactLength(material.text), 0);
  const snippetCharacters = snippets.reduce((total, material) => total + compactLength(material.text), 0);
  const independentSources = new Set(
    [...fulltext, ...snippets].map(publisherKey).filter(Boolean),
  );
  const detailedUserMaterial = fulltext.some((material) => (
    material.source.channel === "user" && compactLength(material.text) >= 500
  ));
  const fulltextReady = (fulltext.length >= 2 && fulltextCharacters >= 500) || detailedUserMaterial;
  const mixedReady = fulltext.length >= 1
    && snippets.length >= 2
    && independentSources.size >= 2
    && fulltextCharacters + snippetCharacters >= 450;
  const snippetsReady = snippets.length >= 3
    && independentSources.size >= 2
    && snippetCharacters >= 240;

  if (!isHotspot) {
    return {
      ready: true,
      evidenceMode: fulltextReady ? "fulltext" : mixedReady ? "mixed" : snippetsReady ? "corroborated-snippets" : "brief-only",
      missingEvidence: [],
      fulltextCount: fulltext.length,
      snippetCount: snippets.length,
      independentSourceCount: independentSources.size,
    };
  }

  const evidenceMode = fulltextReady
    ? "fulltext"
    : mixedReady
      ? "mixed"
      : snippetsReady
        ? "corroborated-snippets"
        : "insufficient";
  const ready = evidenceMode !== "insufficient";
  const missingEvidence = ready ? [] : [
    "至少取得 2 篇可读取正文，或 3 条来自至少 2 个独立发布者或站点的相关摘要",
    fulltextCharacters + snippetCharacters < 240 ? "现有材料的信息量还不足以支撑成稿" : "现有材料缺少可交叉核对的独立来源",
  ];

  return {
    ready,
    evidenceMode,
    missingEvidence,
    fulltextCount: fulltext.length,
    snippetCount: snippets.length,
    independentSourceCount: independentSources.size,
  };
}
