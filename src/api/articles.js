const STORAGE_KEY = "deepread-articles";

function readArticles() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function writeArticles(articles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
}

export function getArticles() {
  return readArticles();
}

export function saveArticle({ id, title, content }) {
  const now = new Date().toISOString();
  const articles = readArticles();
  const existingArticle = articles.find((item) => item.id === id);
  const article = {
    id: id || crypto.randomUUID(),
    title: title.trim() || "Untitled article",
    content,
    highlights: arguments[0].highlights ?? existingArticle?.highlights ?? [],
    updatedAt: now,
  };
  const existingIndex = articles.findIndex((item) => item.id === article.id);
  const updatedArticles = existingIndex === -1
    ? [article, ...articles]
    : articles.map((item) => (item.id === article.id ? { ...item, ...article } : item));

  writeArticles(updatedArticles);
  return article;
}

export function removeArticle(id) {
  const updatedArticles = readArticles().filter((article) => article.id !== id);
  writeArticles(updatedArticles);
  return updatedArticles;
}
