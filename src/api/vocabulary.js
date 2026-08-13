import { apiFetch } from "./http";
import { normalizeVocabulary } from "./normalize";

const pendingVocabularyLists = new Map();
const vocabularyListCache = new Map();

export async function fetchVocabulary({ page = 1, limit = 10, sort = "recent", search = "", force = false } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
  if (search.trim()) params.set("search", search.trim());
  const url = `/api/vocabulary?${params}`;
  if (!force && vocabularyListCache.has(url)) return vocabularyListCache.get(url);
  if (!pendingVocabularyLists.has(url)) {
    pendingVocabularyLists.set(url, apiFetch(url).then((payload) => {
      // Compatibility for an already-running pre-pagination backend during a
      // frontend hot reload. A normal restart uses the object response below.
      if (Array.isArray(payload)) {
        const items = payload.map(normalizeVocabulary);
        return { items, total: items.length, page: 1, limit: items.length || limit, totalPages: 1 };
      }
      return { ...payload, items: (payload.items || []).map(normalizeVocabulary) };
    }).then((result) => {
      vocabularyListCache.set(url, result);
      return result;
    }).finally(() => pendingVocabularyLists.delete(url)));
  }
  return pendingVocabularyLists.get(url);
}

export function clearVocabularyCache() {
  vocabularyListCache.clear();
}

export async function isVocabularySaved(word) {
  const resp = await fetch(`/api/vocabulary/${encodeURIComponent(word.toLowerCase())}`);
  return resp.ok;
}

export async function saveVocabulary(entry) {
  const row = await apiFetch("/api/vocabulary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...entry, savedAt: new Date().toISOString() }),
  });

  clearVocabularyCache();
  return normalizeVocabulary(row);
}

export async function removeVocabulary(word) {
  await apiFetch(`/api/vocabulary/${encodeURIComponent(word)}`, { method: "DELETE" });
  clearVocabularyCache();
}
