import { Star } from "lucide-react";

function getDefinition(result) {
  if (result.definition) return result.definition;
  if (Array.isArray(result.definitions)) return result.definitions[0];
  return "No definition available.";
}

function getExample(result) {
  if (result.example) return result.example;
  if (Array.isArray(result.examples)) return result.examples[0];
  return "No example available.";
}

export default function DictionaryCard({ result, isSaved, isSaving, isSynced, onSave, syncMessage }) {
  return (
    <section className="dictionary" aria-live="polite">
      <p className="eyebrow">Dictionary</p>
      <h2>{result.word}</h2>
      {result.phonetic && <p className="phonetic">{result.phonetic}</p>}
      {result.partOfSpeech && <p className="part-of-speech">{result.partOfSpeech}</p>}
      <p>{getDefinition(result)}</p>
      <div className="example">
        <strong>Example</strong>
        <p>{getExample(result)}</p>
      </div>
      <button className="primary-button" onClick={onSave} disabled={isSaving || isSynced}>
        <Star size={18} fill={isSaved ? "currentColor" : "none"} />
        {isSaving ? "Saving…" : isSynced ? "Saved & Synced to Eudic" : isSaved ? "Sync to Eudic" : "Save to Vocabulary"}
      </button>
      {syncMessage && <p className="sync-message">{syncMessage}</p>}
    </section>
  );
}
