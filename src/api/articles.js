import { apiFetch } from "./http";
import { normalizeArticle } from "./normalize";

const pendingArticleLists = new Map();
const articleListCache = new Map();
let pendingTags = null;

export async function fetchArticles({ page = 1, limit = 10, tag = "all", force = false } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), tag: String(tag) });
  const url = `/api/articles?${params}`;
  if (!force && articleListCache.has(url)) return articleListCache.get(url);
  if (!pendingArticleLists.has(url)) {
    pendingArticleLists.set(url, apiFetch(url).then((payload) => {
      // Allow a browser with the new frontend to continue showing data until its
      // paired backend process has been restarted with the paginated route.
      if (Array.isArray(payload)) {
        const items = payload.map(normalizeArticle);
        return { items, total: items.length, allTotal: items.length, untaggedTotal: items.filter((item) => !item.tags.length).length, page: 1, limit: items.length || limit, totalPages: 1 };
      }
      return { ...payload, items: (payload.items || []).map(normalizeArticle) };
    }).then((result) => {
      articleListCache.set(url, result);
      return result;
    }).finally(() => pendingArticleLists.delete(url)));
  }
  return pendingArticleLists.get(url);
}

export function clearArticleListCache() {
  articleListCache.clear();
}

export function prefetchArticles() {
  return fetchArticles({ page: 1, limit: 10, tag: "all" }).catch(() => null);
}

export async function fetchArticle(id) {
  return normalizeArticle(await apiFetch(`/api/articles/${encodeURIComponent(id)}`));
}

export async function saveArticle({ id, title, content, highlights = [], blocks }) {
  const row = await apiFetch("/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title, content, highlights, ...(Array.isArray(blocks) ? { blocks } : {}) }),
  });

  return normalizeArticle(row);
}

export async function uploadArticleImage(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
  return apiFetch('/api/articles/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mimeType: file.type }),
  });
}

export async function removeArticle(id) {
  await apiFetch(`/api/articles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchTags() {
  if (!pendingTags) pendingTags = apiFetch("/api/tags").finally(() => { pendingTags = null; });
  return pendingTags;
}
export async function createTag(name) { return apiFetch("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); }
export async function renameTag(id, name) { return apiFetch(`/api/tags/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); }
export async function deleteTag(id) { return apiFetch(`/api/tags/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export async function addArticleTag(articleId, tagId) { return apiFetch(`/api/articles/${encodeURIComponent(articleId)}/tags/${encodeURIComponent(tagId)}`, { method: "POST" }); }
export async function removeArticleTag(articleId, tagId) { return apiFetch(`/api/articles/${encodeURIComponent(articleId)}/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" }); }
