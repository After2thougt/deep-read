import { apiFetch } from "./http";
import { normalizeArticle } from "./normalize";

export async function fetchArticles() {
  const rows = await apiFetch("/api/articles");
  return rows.map(normalizeArticle);
}

export async function saveArticle({ id, title, content, highlights = [] }) {
  const row = await apiFetch("/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title, content, highlights }),
  });

  return normalizeArticle(row);
}

export async function removeArticle(id) {
  await apiFetch(`/api/articles/${encodeURIComponent(id)}`, { method: "DELETE" });
}
