const STORAGE_KEY = "deepread-vocabulary";

function readVocabulary() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function writeVocabulary(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

export function getVocabulary() {
  return readVocabulary();
}

export function isVocabularySaved(word) {
  return readVocabulary().some((item) => item.word.toLowerCase() === word.toLowerCase());
}

export function saveVocabulary(entry) {
  const words = readVocabulary();
  if (words.some((item) => item.word.toLowerCase() === entry.word.toLowerCase())) {
    return words;
  }

  const savedEntry = { ...entry, savedAt: new Date().toISOString() };
  const updatedWords = [savedEntry, ...words];
  writeVocabulary(updatedWords);
  return updatedWords;
}

export function removeVocabulary(word) {
  const updatedWords = readVocabulary().filter(
    (item) => item.word.toLowerCase() !== word.toLowerCase(),
  );
  writeVocabulary(updatedWords);
  return updatedWords;
}
