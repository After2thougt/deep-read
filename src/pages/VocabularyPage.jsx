import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { getVocabulary, removeVocabulary } from "../api/vocabulary";

export default function VocabularyPage() {
  const [words, setWords] = useState([]);

  useEffect(() => {
    setWords(getVocabulary());
  }, []);

  function removeWord(word) {
    setWords(removeVocabulary(word));
  }

  return (
    <section className="vocabulary-page">
      <div>
        <p className="eyebrow">Your saved words</p>
        <h2>Vocabulary Bank</h2>
      </div>
      {words.length === 0 ? (
        <p className="empty-vocabulary">No saved words yet. Look up a word in the reader, then save it here.</p>
      ) : (
        <div className="vocabulary-list">
          {words.map((item) => (
            <article className="vocabulary-item" key={item.word.toLowerCase()}>
              <div>
                <h3>{item.word}</h3>
                {item.phonetic && <p className="phonetic">{item.phonetic}</p>}
                <p>{item.definition || item.definitions?.[0] || "No definition available."}</p>
                <small>Saved {new Date(item.savedAt).toLocaleDateString()}</small>
              </div>
              <button className="icon-button" onClick={() => removeWord(item.word)} aria-label={`Remove ${item.word}`}>
                <Trash2 size={18} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
