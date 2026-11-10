export function normalizeSourceMetadata(value) {
  return {
    sourceName: typeof value?.sourceName === "string" ? value.sourceName : "",
    sourceUrl: typeof value?.sourceUrl === "string" ? value.sourceUrl : "",
    sourceAuthor: typeof value?.sourceAuthor === "string" ? value.sourceAuthor : "",
    sourcePublishedAt: typeof value?.sourcePublishedAt === "string" ? value.sourcePublishedAt : "",
  };
}

export function normalizeArticle(row) {
  if (!row) return row;
  const sourceMetadata = row.sourceMetadata || {};

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    contentPreview: row.content_preview ?? row.contentPreview,
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
    highlights: row.highlights ?? [],
    sourceMetadata: normalizeSourceMetadata({
      sourceName: sourceMetadata.sourceName ?? row.source_name ?? "",
      sourceUrl: sourceMetadata.sourceUrl ?? row.source_url ?? "",
      sourceAuthor: sourceMetadata.sourceAuthor ?? row.source_author ?? "",
      sourcePublishedAt: sourceMetadata.sourcePublishedAt ?? row.source_published_at ?? "",
    }),
    tags: Array.isArray(row.tags) ? row.tags : [],
    updatedAt: row.updated_at ?? row.updatedAt,
    createdAt: row.created_at ?? row.createdAt,
    contentLength: row.content_length ?? row.contentLength,
  };
}

export function normalizeVocabulary(row) {
  if (!row) return row;

  let raw = row.raw;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }

  return {
    word: row.word,
    definition: row.definition,
    phonetic: row.phonetic,
    partOfSpeech: row.part_of_speech ?? row.partOfSpeech,
    example: row.example,
    savedAt: row.saved_at ?? row.savedAt,
    contextLine: row.context_line ?? row.contextLine,
    raw,
    definitions: row.definitions,
    examples: row.examples,
    synonyms: row.synonyms,
    sourceArticleTitle: row.source_article_title ?? row.sourceArticleTitle,
  };
}
