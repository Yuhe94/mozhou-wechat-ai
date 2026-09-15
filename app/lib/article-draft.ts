type DraftSectionRecord = Record<string, unknown>;

const STANDALONE_IMAGE_MARKER = /^(?:IMG-\d+|(?:配图|插图)\s*[：:]\s*.+)$/i;
const CAUTION_SUFFIX = /([？?!！])\s*(?:先等等|先别急|别急)(?:再说|再看|一下)?[。.!！]?$/;

function requestedMaximum(length: string) {
  const values = [...length.matchAll(/\d+/g)].map((match) => Number.parseInt(match[0], 10));
  return values.length ? values.at(-1)! : 600;
}

export function isShortArticleLength(length: string) {
  return requestedMaximum(length) <= 600;
}

function paragraphValues(section: DraftSectionRecord) {
  if (!Array.isArray(section.paragraphs)) return [];
  return section.paragraphs
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !STANDALONE_IMAGE_MARKER.test(value));
}

function mergeParagraphs(paragraphs: string[], maximum: number) {
  if (paragraphs.length <= maximum) return paragraphs;
  if (maximum <= 1) return [paragraphs.join("")];

  const total = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  let splitIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let currentLength = 0;
  for (let index = 1; index < paragraphs.length; index += 1) {
    currentLength += paragraphs[index - 1].length;
    const distance = Math.abs(currentLength - total / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      splitIndex = index;
    }
  }
  return [paragraphs.slice(0, splitIndex).join(""), paragraphs.slice(splitIndex).join("")].filter(Boolean);
}

function normalizeTitle(value: unknown) {
  if (typeof value !== "string") return value;
  return value.trim().replace(CAUTION_SUFFIX, "$1");
}

export function normalizeReaderDraft<T extends Record<string, unknown>>(draft: T, requestedLength: string): T {
  const rawSections = Array.isArray(draft.sections)
    ? draft.sections.filter((section): section is DraftSectionRecord => Boolean(section) && typeof section === "object" && !Array.isArray(section))
    : [];
  const sections = rawSections
    .map((section, index) => ({
      ...section,
      id: typeof section.id === "string" && section.id.trim() ? section.id : `section-${index + 1}`,
      heading: typeof section.heading === "string" ? section.heading.trim() : "",
      paragraphs: paragraphValues(section),
    }))
    .filter((section) => section.paragraphs.length > 0)
    .slice(0, 4);

  if (isShortArticleLength(requestedLength)) {
    const paragraphs = mergeParagraphs(sections.flatMap((section) => section.paragraphs), 2);
    const needsInlineImage = sections.some((section) => typeof section.imageSlot === "string" && section.imageSlot.trim());
    return {
      ...draft,
      title: normalizeTitle(draft.title),
      sections: paragraphs.map((paragraph, index) => ({
        id: `section-${index + 1}`,
        heading: "",
        paragraphs: [paragraph],
        ...(needsInlineImage && index === 0 ? { imageSlot: "IMG-01" } : {}),
      })),
    } as T;
  }

  let nextImageNumber = 1;
  return {
    ...draft,
    title: normalizeTitle(draft.title),
    sections: sections.map((section) => {
      const hasImage = typeof section.imageSlot === "string" && section.imageSlot.trim() && nextImageNumber <= 2;
      const imageSlot = hasImage ? `IMG-${String(nextImageNumber++).padStart(2, "0")}` : undefined;
      const rest = { ...section };
      delete rest.imageSlot;
      return imageSlot ? { ...rest, imageSlot } : rest;
    }),
  } as T;
}
