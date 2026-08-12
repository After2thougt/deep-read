export function normalizeArticle(row) {
  if (!row) return row;

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    highlights: row.highlights ?? [],
    updatedAt: row.updated_at ?? row.updatedAt,
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
  };
}
