import { apiFetch } from "./http";
import { normalizeVocabulary } from "./normalize";

export async function fetchVocabulary() {
  const rows = await apiFetch("/api/vocabulary");
  return rows.map(normalizeVocabulary);
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

  return normalizeVocabulary(row);
}

export async function removeVocabulary(word) {
  await apiFetch(`/api/vocabulary/${encodeURIComponent(word)}`, { method: "DELETE" });
}
