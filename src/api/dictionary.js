import axios from "axios";


export async function getWordDefinition(word) {
  const response = await axios.get(`/api/dictionary/${encodeURIComponent(word)}`);
  return response.data;
}

export async function syncVocabularyToEudic(word, contextLine) {
  const response = await axios.post("/api/eudic/vocabulary", {
    word,
    contextLine,
  });

  return response.data;
}
