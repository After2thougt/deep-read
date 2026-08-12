const ARTICLES_KEY = "deepread-articles";
const VOCABULARY_KEY = "deepread-vocabulary";
const MIGRATED_KEY = "deepread-migrated";

function readLocal(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function getLocalDataSummary() {
  if (localStorage.getItem(MIGRATED_KEY)) {
    return null;
  }

  const articles = readLocal(ARTICLES_KEY);
  const vocabulary = readLocal(VOCABULARY_KEY);

  if (!articles.length && !vocabulary.length) {
    return null;
  }

  return {
    articles,
    vocabulary,
    articleCount: articles.length,
    vocabularyCount: vocabulary.length,
  };
}

export async function migrateLocalDataToDatabase() {
  const summary = getLocalDataSummary();
  if (!summary) {
    return { articlesSaved: 0, vocabularySaved: 0 };
  }

  const resp = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articles: summary.articles,
      vocabulary: summary.vocabulary,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || body.details || "Migration failed.");
  }

  const result = await resp.json();
  localStorage.removeItem(ARTICLES_KEY);
  localStorage.removeItem(VOCABULARY_KEY);
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString());

  return result;
}

export function dismissMigration() {
  localStorage.setItem(MIGRATED_KEY, "dismissed");
}
