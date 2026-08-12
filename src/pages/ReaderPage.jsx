import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Languages, Sparkles, X } from "lucide-react";
import { getWordDefinition, syncVocabularyToEudic } from "../api/dictionary";
import { isVocabularySaved, saveVocabulary } from "../api/vocabulary";
import { saveArticle } from "../api/articles";
import { translateArticle } from "../api/translation";
import { analyzeArticle, clearArticleAnalysis } from "../api/analysis";
import ArticleInput from "../components/ArticleInput";
import DictionaryCard from "../components/DictionaryCard";
import Reader from "../components/Reader";

function normalizeAnalysis(value) {
  const payload = value && typeof value === "object" ? value : {};
  const displayText = (input) => {
    if (input == null) return "";
    if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") return String(input);
    if (Array.isArray(input)) return input.map(displayText).filter(Boolean).join("; ");
    if (typeof input === "object") return Object.values(input).map(displayText).filter(Boolean).join("; ");
    return "";
  };
  const safeItems = (input) => Array.isArray(input) ? input.filter((item) => item && typeof item === "object") : [];
  return {
    summary: displayText(payload.summary),
    keyPoints: Array.isArray(payload.keyPoints) ? payload.keyPoints.map(displayText).filter(Boolean) : [],
    hardSentences: safeItems(payload.hardSentences).map((item, index) => ({ ...item, id: index, text: displayText(item.sentence || item.text), structure: displayText(item.structure), sentenceStructure: displayText(item.sentenceStructure), grammarExplanation: displayText(item.grammarExplanation), literaryAnalysis: displayText(item.literaryAnalysis), chineseUnderstanding: displayText(item.chineseUnderstanding) })).filter((item) => item.text && !/^(?:[IVXLCDM]+|\d+)[.)]?$/i.test(item.text.trim())),
    vocabulary: safeItems(payload.vocabularyAnalysis).filter((item) => item.word).map((item) => ({ ...item, word: displayText(item.word), partOfSpeech: displayText(item.partOfSpeech), level: displayText(item.level), meaning: displayText(item.meaning), usage: displayText(item.usage) })),
    phrases: safeItems(payload.phraseCollocations).filter((item) => item.phrase).map((item) => ({ ...item, phrase: displayText(item.phrase), meaning: displayText(item.meaning), context: displayText(item.context), usage: displayText(item.usage), example: displayText(item.example) })),
  };
}

const PAGE_MAX_CHARACTERS = 1800;
function splitPageText(text) {
  const paragraphs = String(text || '').split(/(\r?\n\s*\r?\n)/);
  const pages = [];
  let page = '';
  const flush = () => { if (page) { pages.push(page); page = ''; } };
  for (const part of paragraphs) {
    if (part.length + page.length <= PAGE_MAX_CHARACTERS) { page += part; continue; }
    if (page) flush();
    if (part.length <= PAGE_MAX_CHARACTERS) { page = part; continue; }
    const sentences = part.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [part];
    for (const sentence of sentences) {
      if (sentence.length + page.length <= PAGE_MAX_CHARACTERS) page += sentence;
      else { flush(); if (sentence.length <= PAGE_MAX_CHARACTERS) page = sentence; else { for (let i = 0; i < sentence.length; i += PAGE_MAX_CHARACTERS) pages.push(sentence.slice(i, i + PAGE_MAX_CHARACTERS)); } }
    }
  }
  flush();
  return pages.length ? pages : [''];
}

function StudyResults({ analysis, collapsed, onToggleCollapsed, onClear }) {
  const normalized = normalizeAnalysis(analysis);
  const hasAnalysis = (item) => item.sentenceStructure && item.grammarExplanation && item.literaryAnalysis;

  return <section className="study-section">
    <div className="study-section__header">
      <div className="study-section__controls">
        <button className="icon-text-button danger" type="button" onClick={onClear}><X size={15} />Clear</button>
        <button className="icon-text-button" type="button" aria-expanded={!collapsed} aria-controls="study-results-content" onClick={onToggleCollapsed}>
          <ChevronDown className={collapsed ? "study-toggle-icon is-collapsed" : "study-toggle-icon"} size={16} />{collapsed ? "Show AI Analyze" : "Hide AI Analyze"}
        </button>
      </div>
    </div>
    <div id="study-results-content" className="study-results" hidden={collapsed}>
      <section className="panel-section overview-panel">
        <p className="eyebrow">Article analysis</p><h2>Summary</h2><p>{normalized.summary || "No summary was returned."}</p>
        {normalized.keyPoints.length > 0 && <><h3>Key points</h3><ul className="key-points">{normalized.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></>}
      </section>
      <section className="panel-section">
        <div className="panel-heading"><div><p className="eyebrow">Sentence study</p><h2>Hard sentences</h2></div><span>{normalized.hardSentences.length}</span></div>
        {normalized.hardSentences.length ? <div className="hard-sentence-accordions">{normalized.hardSentences.map((item, index) => <article className="hard-sentence-card" key={item.id}>
          <div className="hard-sentence-heading"><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.text}</strong></div>
          <div className="sentence-analysis">
            <h3>Sentence Analysis</h3>
            {hasAnalysis(item) ? <>
              <h4>Sentence Structure</h4><p>{item.sentenceStructure}</p>
              <h4>Grammar Explanation</h4><p>{item.grammarExplanation}</p>
              <h4>Literary Analysis</h4><p>{item.literaryAnalysis}</p>
              {item.chineseUnderstanding && <><h4>Chinese Understanding</h4><p>{item.chineseUnderstanding}</p></>}
            </> : <p className="panel-empty">This cached result lacks the complete sentence analysis. Clear and analyze again.</p>}
          </div>
        </article>)}</div> : <p className="panel-empty">No hard sentences were returned.</p>}
      </section>
      <section className="panel-section">
        <p className="eyebrow">Vocabulary analysis</p><h2>Vocabulary Analysis</h2>
        {normalized.vocabulary.length ? <div className="vocabulary-table-wrap"><table className="vocabulary-table"><thead><tr><th>Word</th><th>POS</th><th>Level</th><th>Meaning</th><th>Usage &amp; Nuance</th></tr></thead><tbody>{normalized.vocabulary.map((word, index) => <tr key={`${word.word}-${index}`}><td>{word.word}</td><td>{word.partOfSpeech || "-"}</td><td>{word.level || "Advanced"}</td><td>{word.meaning || "-"}</td><td>{word.usage || "-"}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No vocabulary analysis was returned.</p>}
      </section>
      <section className="panel-section">
        <p className="eyebrow">Phrase study</p><h2>Phrase &amp; Collocation</h2>
        {normalized.phrases.length ? <div className="phrase-list">{normalized.phrases.map((phrase, index) => <article className="phrase-analysis" key={`${phrase.phrase}-${index}`}><h3>{phrase.phrase}</h3><p><strong>Meaning:</strong> {phrase.meaning || "-"}</p><p><strong>Context:</strong> {phrase.context || "-"}</p><p><strong>Usage:</strong> {phrase.usage || "-"}</p><p><strong>Example:</strong> <em>{phrase.example || "-"}</em></p></article>)}</div> : <p className="panel-empty">No phrase analysis was returned.</p>}
      </section>
    </div>
  </section>;
}

export default function ReaderPage({ article, articleId, articleTitle, highlights, initialPage = 1, onArticleChange, onTitleChange, onArticleSaved, onNewArticle }) {
  const [selectedWord, setSelectedWord] = useState(null);
  const [wordStatus, setWordStatus] = useState("idle");
  const [wordError, setWordError] = useState("");
  const [lastWord, setLastWord] = useState("");
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
  const [analyzing, setAnalyzing] = useState(false);
  const [studyResultsCollapsed, setStudyResultsCollapsed] = useState(false);
  const [translationCollapsed, setTranslationCollapsed] = useState(false);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageJump, setPageJump] = useState(String(initialPage));
  const analysisRequestGeneration = useRef(0);
  const translationRequestGeneration = useRef(0);
  const activeAnalysisRequestId = useRef(null);

  const pages = useMemo(() => splitPageText(article), [article]);
  const pageContent = pages[currentPage - 1] || '';
  const pageOffset = pages.slice(0, currentPage - 1).reduce((total, page) => total + page.length, 0);
  const dictionaryExpanded = analyzing || translating || Boolean(
    (analysis && !studyResultsCollapsed) || (translations && !translationCollapsed),
  );
  useEffect(() => { if (articleId) localStorage.setItem(`vocabulary-trainer:article-page:${articleId}`, String(currentPage)); }, [articleId, currentPage]);
  useEffect(() => { setCurrentPage(Math.min(Math.max(initialPage, 1), pages.length)); }, [articleId, initialPage, pages.length]);
  useEffect(() => { setPageJump(String(currentPage)); }, [currentPage]);
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pages.length));
    setTranslations(null);
    setAnalysis(null);
  }, [article, pages.length]);

  function changePage(nextPage) {
    ++translationRequestGeneration.current;
    setCurrentPage(nextPage);
    setTranslations(null);
    setAnalysis(null);
    setTranslateError("");
    setAnalysisError("");
    setPageJump(String(nextPage));
  }
  function pageItems() {
    const candidates = new Set([1, pages.length, currentPage - 1, currentPage, currentPage + 1]);
    return [...candidates].filter((page) => page >= 1 && page <= pages.length).sort((a, b) => a - b);
  }
  function jumpToPage(event) {
    event.preventDefault();
    const target = Math.min(Math.max(Number.parseInt(pageJump, 10) || currentPage, 1), pages.length);
    changePage(target);
  }

  async function saveCurrentArticle() {
    try { setSaveMessage(""); const savedArticle = await saveArticle({ id: articleId, title: articleTitle, content: article, highlights }); onArticleSaved(savedArticle); setSaveMessage("Article saved in your library."); } catch (err) { setSaveMessage(err.message || "Unable to save article."); }
  }
  async function saveUnderline(underline) { try { const savedArticle = await saveArticle({ id: articleId, title: articleTitle, content: article, highlights: [...highlights, underline] }); onArticleSaved(savedArticle); setSaveMessage("Wavy underline saved with this article."); } catch (err) { setSaveMessage(err.message || "Unable to save underline."); } }
  async function removeUnderline(underlineId) { try { const savedArticle = await saveArticle({ id: articleId, title: articleTitle, content: article, highlights: highlights.filter((item) => item.id !== underlineId) }); onArticleSaved(savedArticle); } catch (err) { setSaveMessage(err.message || "Unable to remove underline."); } }
  async function updateUnderline(underlineId, changes) { try { const savedArticle = await saveArticle({ id: articleId, title: articleTitle, content: article, highlights: highlights.map((item) => item.id === underlineId ? { ...item, ...changes } : item) }); onArticleSaved(savedArticle); } catch (err) { setSaveMessage(err.message || "Unable to update underline."); } }

  async function handleTranslate() {
    if (!article.trim()) return;
    const requestGeneration = ++translationRequestGeneration.current;
    const requestedPage = currentPage;
    setTranslating(true); setTranslateError("");
    try { const result = await translateArticle(pageContent, "zh", { articleId, pageNumber: requestedPage }); if (translationRequestGeneration.current === requestGeneration && currentPage === requestedPage) setTranslations(Array.isArray(result?.paragraphs) ? result.paragraphs : []); } catch (err) { if (translationRequestGeneration.current === requestGeneration) setTranslateError(err?.error || err?.message || "Translation failed."); } finally { if (translationRequestGeneration.current === requestGeneration) setTranslating(false); }
  }
  async function handleAnalyze() {
    if (!article.trim()) return;
    const requestGeneration = ++analysisRequestGeneration.current;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeAnalysisRequestId.current = requestId;
    setAnalyzing(true); setAnalysisError("");
    try {
      const result = await analyzeArticle(pageContent, requestId, { articleId, pageNumber: currentPage });
      if (analysisRequestGeneration.current === requestGeneration) setAnalysis(result);
    } catch (err) {
      if (analysisRequestGeneration.current === requestGeneration) setAnalysisError(err?.error || err?.message || "Analysis failed.");
    } finally {
      if (analysisRequestGeneration.current === requestGeneration) {
        setAnalyzing(false);
        activeAnalysisRequestId.current = null;
      }
    }
  }
  async function handleClearStudyResults() {
    if (!window.confirm("Clear Study Results?\n\nThis deletes the cached AI analysis for this saved article. The next analysis will call AI again.")) return;

    // Invalidate any in-flight Analyze response before deleting its server cache.
    ++analysisRequestGeneration.current;
    setAnalyzing(false);
    setAnalysisError("");

    try {
      if (articleId) await clearArticleAnalysis(articleId, pageContent, activeAnalysisRequestId.current, { pageNumber: currentPage });
      setAnalysis(null);
    } catch (err) {
      const message = err?.error || err?.message || "Unable to clear the saved analysis cache. Study results were kept.";
      setAnalysisError(err?.status === 404 ? "The running backend is outdated. Restart npm start, then clear Study Results again." : message);
    }
  }
  async function selectWord(word) {
    setLastWord(word); setWordStatus("loading"); setWordError(""); setSelectedWord(null); setSaved(false); setSynced(false); setSyncMessage("");
    try { const result = await getWordDefinition(word); const entry = { ...result, word: result.word || word }; setSelectedWord(entry); setSaved(await isVocabularySaved(entry.word)); setWordStatus("success"); } catch { setWordError("Unable to look up this word. Please try again."); setWordStatus("error"); }
  }
  async function saveSelectedWord() {
    setSaving(true); setSyncMessage("");
    try { await saveVocabulary(selectedWord); setSaved(true); try { await syncVocabularyToEudic(selectedWord.word, article); setSynced(true); setSyncMessage("Saved to Vocabulary and synced to Eudic."); } catch { setSyncMessage("Saved to Vocabulary. Eudic sync was unavailable."); } } finally { setSaving(false); }
  }
  return <div className="reader-page">
    <ArticleInput title={articleTitle} article={article} onTitleChange={onTitleChange} onArticleChange={(content) => { onArticleChange(content); setSaveMessage(""); }} onSave={saveCurrentArticle} onNew={() => { onNewArticle(); setSaveMessage(""); }} saveMessage={saveMessage} />
    <section className="learning-toolbar" aria-label="Reading tools">
      <div><p className="eyebrow">Reading workspace</p><span>Translate the article or generate an AI study guide.</span></div>
      <div className="learning-toolbar__actions"><button className="secondary-button tool-action" type="button" onClick={handleTranslate} disabled={!article.trim() || translating}><Languages size={17} /><span>{translating ? "Translating..." : "Translate"}</span></button><button className="primary-button tool-action" type="button" onClick={handleAnalyze} disabled={!article.trim() || analyzing}><Sparkles size={17} /><span>{analyzing ? "Analyzing..." : "Analyze"}</span></button></div>
    </section>
    {(translateError || analysisError) && <section className="study-error"><strong>{analysisError ? "Analysis failed" : "Translation failed"}</strong><span>{analysisError || translateError}</span><button className="text-button" type="button" onClick={analysisError ? handleAnalyze : handleTranslate}>Retry</button></section>}
    <div className={`learning-layout ${dictionaryExpanded ? "learning-layout--study-open" : "learning-layout--dictionary-compact"}`}>
      <div className="reader-column"><Reader article={pageContent} articleOffset={pageOffset} pageEnd={pageOffset + pageContent.length} highlights={highlights} onSelectWord={selectWord} onSaveUnderline={saveUnderline} onRemoveUnderline={removeUnderline} onUpdateUnderline={updateUnderline} /><nav className="pagination-controls" aria-label="Article pages" hide-on-single-page={pages.length === 1 ? "" : undefined}><button className="pagination-button" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={16} /></button>{pageItems().map((page, index, items) => <span className="pagination-item" key={page}>{index > 0 && page - items[index - 1] > 1 && <span className="pagination-ellipsis">...</span>}<button className={page === currentPage ? "pagination-page is-current" : "pagination-page"} type="button" aria-current={page === currentPage ? "page" : undefined} onClick={() => changePage(page)}>{page}</button></span>)}<button className="pagination-button" type="button" aria-label="Next page" disabled={currentPage === pages.length} onClick={() => changePage(currentPage + 1)}><ChevronRight size={16} /></button><form className="pagination-jump" onSubmit={jumpToPage}></form></nav></div>
      <aside className="learning-panel">
        {analysis && <StudyResults analysis={analysis} collapsed={studyResultsCollapsed} onToggleCollapsed={() => setStudyResultsCollapsed((value) => !value)} onClear={handleClearStudyResults} />}
        {translations && <section className="study-section"><div className="study-section__header study-section__header--controls-only"><div className="study-section__controls"><span className="result-count">{translations.length}</span><button className="icon-text-button" type="button" aria-expanded={!translationCollapsed} aria-controls="translation-results-content" onClick={() => setTranslationCollapsed((collapsed) => !collapsed)}><ChevronDown className={translationCollapsed ? "study-toggle-icon is-collapsed" : "study-toggle-icon"} size={16} />{translationCollapsed ? "Show Translation" : "Hide Translation"}</button></div></div><div id="translation-results-content" className="translation-list" hidden={translationCollapsed}>{translations.map((item, index) => <article className="translation-card" key={index}><div className="translation-block translation-block--source"><span>English</span><p>{item.source}</p></div><div className="translation-block translation-block--target"><span>Chinese</span><p>{item.translated}</p></div></article>)}</div></section>}
        <section className={`panel-section word-panel ${dictionaryExpanded ? "word-panel--expanded" : "word-panel--compact"}`}><div className="panel-heading"><div><h2>Dictionary</h2></div></div>{wordStatus === "idle" && <p className="panel-empty">Click an English word to look it up.</p>}{wordStatus === "loading" && <p className="panel-empty">Looking up word...</p>}{wordStatus === "error" && <div className="panel-empty"><p>{wordError}</p><button className="text-button" type="button" onClick={() => selectWord(lastWord)}>Retry</button></div>}{wordStatus === "success" && selectedWord && <DictionaryCard result={selectedWord} isSaved={saved} isSaving={saving} isSynced={synced} onSave={saveSelectedWord} syncMessage={syncMessage} />}</section>
      </aside>
    </div>
  </div>;
}
