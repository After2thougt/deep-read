import { Check, Star, Volume2 } from "lucide-react";

function getDefinition(result) { return result.definition || (Array.isArray(result.definitions) ? result.definitions[0] : null) || "No definition available."; }
function getExample(result) { return result.example || (Array.isArray(result.examples) ? result.examples[0] : null) || ""; }

export default function DictionaryCard({ result, isSaved, isSaving, onSave, syncMessage }) {
  function pronounceWord() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.word);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }

  return <section className="dictionary" aria-live="polite">
    <div className="dictionary-title"><div><div className="dictionary-word-row"><h3>{result.word}</h3><button className="pronunciation-button" type="button" onClick={pronounceWord} aria-label={`Pronounce ${result.word}`} title="Pronounce word"><Volume2 size={17} /></button></div>{result.phonetic && <p className="phonetic">{result.phonetic}</p>}</div>{result.partOfSpeech && <span className="part-of-speech">{result.partOfSpeech}</span>}</div>
    <p className="dictionary-definition">{getDefinition(result)}</p>
    {getExample(result) && <div className="example"><strong>Example</strong><p>{getExample(result)}</p></div>}
    <button className="primary-button dictionary-save" type="button" onClick={onSave} disabled={isSaving || isSaved}>
      {isSaved ? <Check size={18} /> : <Star size={18} />}
      {isSaving ? "Saving..." : isSaved ? "Saved" : "Save word"}
    </button>
    {syncMessage && <p className="sync-message">{syncMessage}</p>}
  </section>;
}
