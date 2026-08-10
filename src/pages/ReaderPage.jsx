import { useState } from "react";
import { getWordDefinition, syncVocabularyToEudic } from "../api/dictionary";
import { isVocabularySaved, saveVocabulary } from "../api/vocabulary";
import { saveArticle } from "../api/articles";
import { translateArticle } from "../api/translation";
import { analyzeArticle } from "../api/analysis";
import ArticleInput from "../components/ArticleInput";
import DictionaryCard from "../components/DictionaryCard";
import Reader from "../components/Reader";

export default function ReaderPage({ article, articleId, articleTitle, highlights, onArticleChange, onTitleChange, onArticleSaved, onNewArticle }) {
  const [selectedWord, setSelectedWord] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [translations, setTranslations] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisNotice, setAnalysisNotice] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  function clearTranslations() {
    setTranslations(null);
    setTranslateError("");
  }

  function clearAnalysis() {
    setAnalysis(null);
    setAnalysisError("");
  }

  async function copyTranslations() {
    if (!translations?.length) return;

    const formatted = translations
      .map((item, index) => `Paragraph ${index + 1}\nEN: ${item.source}\nZH: ${item.translated}`)
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(formatted);
    } catch {
      setTranslateError("Unable to copy translation to clipboard.");
    }
  }

  function saveCurrentArticle() {
    const savedArticle = saveArticle({ id: articleId, title: articleTitle, content: article, highlights });
    onArticleSaved(savedArticle);
    setSaveMessage("Article saved in your library.");
  }

  function saveUnderline(underline) {
    const savedArticle = saveArticle({
      id: articleId,
      title: articleTitle,
      content: article,
      highlights: [...highlights, underline],
    });
    onArticleSaved(savedArticle);
    setSaveMessage("Wavy underline saved with this article.");
  }

  async function handleTranslate() {
    if (!article || !article.trim()) return;
    setTranslating(true);
    setTranslateError("");
    setTranslations(null);

    try {
      const result = await translateArticle(article, 'zh');
      setTranslations(result.paragraphs || []);
    } catch (err) {
      const message = err?.details ? `${err?.error || 'Translation failed.'} ${err.details}` : err?.error || err?.message || 'Translation failed.';
      setTranslateError(message);
    } finally {
      setTranslating(false);
    }
  }

  async function handleAnalyze() {
    if (!article || !article.trim()) return;
    setAnalyzing(true);
    setAnalysisError("");
    setAnalysis(null);
    setAnalysisNotice("");

    try {
      const result = await analyzeArticle(article);
      const payload = result || { summary: 'No analysis returned.', hardSentences: [], grammarPoints: [] };
      setAnalysis(payload);
      if (payload.source === 'fallback') {
        setAnalysisNotice('Gemini API currently unreachable; using local fallback analysis.');
      }
    } catch (err) {
      const message = err?.details ? `${err?.error || 'Analysis failed.'} ${err.details}` : err?.error || err?.message || 'Analysis failed.';
      setAnalysisError(message);
    } finally {
      setAnalyzing(false);
    }
  }

  function removeUnderline(underlineId) {
    const savedArticle = saveArticle({
      id: articleId,
      title: articleTitle,
      content: article,
      highlights: highlights.filter((item) => item.id !== underlineId),
    });
    onArticleSaved(savedArticle);
  }

  function updateUnderline(underlineId, changes) {
    const savedArticle = saveArticle({
      id: articleId,
      title: articleTitle,
      content: article,
      highlights: highlights.map((item) => (item.id === underlineId ? { ...item, ...changes } : item)),
    });
    onArticleSaved(savedArticle);
  }

  async function selectWord(word) {
    setStatus("loading");
    setError("");
    setSelectedWord(null);
    setSaved(false);
    setSynced(false);
    setSyncMessage("");

    try {
      const result = await getWordDefinition(word);
      const normalizedResult = { ...result, word: result.word || word };
      setSelectedWord(normalizedResult);
      setSaved(isVocabularySaved(normalizedResult.word));
      setStatus("success");
    } catch {
      setError(`Unable to look up “${word}”. Please check that the dictionary server is running.`);
      setStatus("error");
    }
  }

  async function saveSelectedWord() {
    setSaving(true);
    setSyncMessage("");
    saveVocabulary(selectedWord);
    setSaved(true);
    try {
      await syncVocabularyToEudic(selectedWord.word, article);
      setSynced(true);
      setSyncMessage("Saved locally and synced to Eudic.");
    } catch (error) {
      const detail = error.response?.data?.details;
      setSyncMessage(detail ? `Saved locally, but Eudic sync failed: ${detail}` : "Saved locally, but Eudic sync failed. Click Sync to Eudic to try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ArticleInput
        title={articleTitle}
        article={article}
        onTitleChange={onTitleChange}
        onArticleChange={(content) => { onArticleChange(content); setSaveMessage(""); }}
        onSave={saveCurrentArticle}
        onNew={() => { onNewArticle(); setSaveMessage(""); }}
        saveMessage={saveMessage}
      />
      <div className="translate-actions">
        <button className="primary-button" onClick={handleTranslate} disabled={!article.trim() || translating} type="button">
          {translating ? 'Translating…' : 'Translate'}
        </button>
        <button className="secondary-button" onClick={handleAnalyze} disabled={!article.trim() || analyzing} type="button">
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </button>
        {translations?.length > 0 && (
          <button className="secondary-button" onClick={clearTranslations} type="button">
            Clear
          </button>
        )}
        {analysis && (
          <button className="secondary-button" onClick={clearAnalysis} type="button">
            Clear analysis
          </button>
        )}
        {translateError && <span className="error-message">{translateError}</span>}
        {analysisError && <span className="error-message">{analysisError}</span>}
      </div>
      {analysis && (
        <section className="analysis-results">
          <div className="translation-results__header">
            <div>
              <h3>Article analysis</h3>
              <p className="translation-results__subtitle">全文重点、语法解析与高难句分析。</p>
            </div>
          </div>
          <div className="analysis-card">
            {analysisNotice && <div className="analysis-notice">{analysisNotice}</div>}
            {typeof analysis === 'string' ? (
              <pre>{analysis}</pre>
            ) : (
              <>
                <div className="analysis-section">
                  <h4>Summary</h4>
                  <p>{analysis.summary || 'No summary available.'}</p>
                </div>
                <div className="analysis-section">
                  <h4>Hard sentences</h4>
                  {analysis.hardSentences?.length > 0 ? (
                    <ol>
                      {analysis.hardSentences.map((item, index) => (
                        <li key={index}>
                          <p><strong>{item.sentence || item.text}</strong></p>
                          <p>{item.explanation || item.analysis || 'No explanation provided.'}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No hard sentence analysis available.</p>
                  )}
                </div>
                <div className="analysis-section">
                  <h4>Grammar points</h4>
                  {analysis.grammarPoints?.length > 0 ? (
                    <ol>
                      {analysis.grammarPoints.map((item, index) => (
                        <li key={index}>
                          <p><strong>{item.point || item.title}</strong></p>
                          <p>{item.detail || item.description || 'No detail provided.'}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No grammar points available.</p>
                  )}
                </div>
                {analysis.raw && (
                  <div className="analysis-section">
                    <h4>Raw output</h4>
                    <pre>{analysis.raw}</pre>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
      {translations && (
        <section className="translation-results">
          <div className="translation-results__header">
            <div>
              <h3>Translation</h3>
              <p className="translation-results__subtitle">Paragraph-level English / Chinese alignment for easier review.</p>
            </div>
            <div className="translation-results__actions">
              <span className="translation-results__count">{translations.length} paragraph{translations.length === 1 ? '' : 's'}</span>
              <button className="secondary-button" type="button" onClick={copyTranslations}>
                Copy all
              </button>
            </div>
          </div>
          <div className="translation-grid">
            {translations.map((p, idx) => (
              <article key={idx} className="translation-card">
                <div className="translation-block translation-block--source">
                  <div className="translation-block__label">EN</div>
                  <p>{p.source}</p>
                </div>
                <hr className="translation-divider" />
                <div className="translation-block translation-block--target">
                  <div className="translation-block__label">ZH</div>
                  <p>{p.translated}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="layout">
        <Reader article={article} highlights={highlights} onSelectWord={selectWord} onSaveUnderline={saveUnderline} onRemoveUnderline={removeUnderline} onUpdateUnderline={updateUnderline} />
        <aside className="dictionary-panel">
          {status === "idle" && <p className="side-message">Click an English word to look it up.</p>}
          {status === "loading" && <p className="side-message">Looking up word…</p>}
          {status === "error" && <p className="side-message error-message">{error}</p>}
          {status === "success" && selectedWord && (
            <DictionaryCard result={selectedWord} isSaved={saved} isSaving={saving} isSynced={synced} onSave={saveSelectedWord} syncMessage={syncMessage} />
          )}
        </aside>
      </div>
    </>
  );
}
