import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Languages,
  Sparkles,
  X,
} from "lucide-react";
import { getWordDefinition, syncVocabularyToEudic } from "../api/dictionary";
import { isVocabularySaved, saveVocabulary } from "../api/vocabulary";
import { saveArticle } from "../api/articles";
import { translateArticle } from "../api/translation";
import { analyzeArticle, clearArticleAnalysis } from "../api/analysis";
import ArticleInput from "../components/ArticleInput";
import DictionaryCard from "../components/DictionaryCard";
import Reader from "../components/Reader";

function structureTokens(value) {
  return String(value || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)(?:\s*\(([^()]+)\))([,;:.!?]*)$/);
      return {
        text: (match ? match[1] : part).trim(),
        type: match?.[2]?.trim() || "Structure element",
        punctuation: match?.[3] || "",
      };
    })
    .filter((token) => token.text);
}

function normalizeStructureGroups(value) {
  const groups = Array.isArray(value)
    ? value
    : Array.isArray(value?.groups)
      ? value.groups
      : [];

  return groups
    .filter((group) => group && typeof group === "object")
    .map((group) => ({
      label: typeof group.label === "string" ? group.label.trim() : "Sentence structure",
      tokens: Array.isArray(group.tokens)
        ? group.tokens
          .filter((token) => token && typeof token === "object" && String(token.text || "").trim())
          .map((token) => ({ text: String(token.text).trim(), type: String(token.type || "Structure element").trim() }))
        : [],
    }))
    .filter((group) => group.tokens.length);
}

function fallbackStructureGroups(value) {
  const tokens = structureTokens(value);
  if (!tokens.length) return [];

  const modifierTypes = /^(?:prepositional phrase|participial phrase|infinitive phrase|relative clause)$/i;
  const modifiers = tokens.filter((token) => modifierTypes.test(token.type));
  const coreTokens = tokens.filter((token) => !modifierTypes.test(token.type));
  const groups = coreTokens.length ? [{ label: "Sentence flow", tokens: coreTokens }] : [];

  if (modifiers.length) groups.push({ label: "Inline modifiers", tokens: modifiers });
  return groups.length ? groups : [{ label: "Sentence flow", tokens }];
}

function structureGroups(item) {
  return item.sentenceStructureGroups.length
    ? item.sentenceStructureGroups
    : fallbackStructureGroups(item.sentenceStructure);
}

function normalizeAnalysis(value) {
  console.log('[normalizeAnalysis] input type:', typeof value,
    'isNull:', value === null,
    'keys:', value && typeof value === 'object' ? Object.keys(value).join(',') : 'N/A',
    'summary type:', typeof value?.summary);
  const payload = value && typeof value === "object" ? value : {};

  const displayText = (input) => {
    if (input == null) return "";
    if (
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean"
    ) {
      return String(input);
    }
    if (Array.isArray(input)) {
      return input.map(displayText).filter(Boolean).join("; ");
    }
    if (typeof input === "object") {
      return Object.values(input).map(displayText).filter(Boolean).join("; ");
    }
    return "";
  };

  const safeItems = (input) =>
    Array.isArray(input)
      ? input.filter((item) => item && typeof item === "object")
      : [];

  return {
    summary: displayText(payload.summary),
    keyPoints: Array.isArray(payload.keyPoints)
      ? payload.keyPoints.map(displayText).filter(Boolean)
      : [],
    hardSentences: safeItems(payload.hardSentences)
      .map((item, index) => ({
        ...item,
        id: index,
        text: displayText(item.sentence || item.text),
        structure: displayText(item.structure),
        sentenceStructure: displayText(item.sentenceStructure),
        sentenceStructureGroups: normalizeStructureGroups(item.sentenceStructureGroups),
        grammarExplanation: displayText(item.grammarExplanation),
        literaryAnalysis: displayText(item.literaryAnalysis),
        chineseUnderstanding: displayText(item.chineseUnderstanding),
      }))
      .filter(
        (item) =>
          item.text &&
          !/^(?:[IVXLCDM]+|\d+)[.)]?$/i.test(item.text.trim())
      ),
    vocabulary: safeItems(payload.vocabularyAnalysis)
      .filter((item) => item.word)
      .map((item) => ({
        ...item,
        word: displayText(item.word),
        partOfSpeech: displayText(item.partOfSpeech),
        level: displayText(item.level),
        meaning: displayText(item.meaning),
        usage: displayText(item.usage),
      })),
    phrases: safeItems(payload.phraseCollocations)
      .filter((item) => item.phrase)
      .map((item) => ({
        ...item,
        phrase: displayText(item.phrase),
        meaning: displayText(item.meaning),
        context: displayText(item.context),
        usage: displayText(item.usage),
        example: displayText(item.example),
      })),
  };
}

const PAGE_MAX_CHARACTERS = 1800;

function splitBlockPages(blocks) {
  const result = [];
  let current = { blocks: [], text: "" };
  let sourceOffset = 0;
  const flush = () => {
    if (current.blocks.length) result.push(current);
    current = { blocks: [], text: "" };
  };

  for (const block of blocks) {
    if (!block || !["text", "image"].includes(block.type)) continue;

    if (block.type === "image") {
      // Images are complete, non-text blocks. Keep them in the current
      // content flow without contributing to the page character limit.
      current.blocks.push(block);
      continue;
    }

    const chunks = splitPageText(block.content);
    for (const chunk of chunks) {
      if (current.text && current.text.length + chunk.length > PAGE_MAX_CHARACTERS) flush();
      if (chunk) {
        current.blocks.push({ ...block, type: "text", content: chunk, textOffset: sourceOffset });
        current.text += chunk;
        sourceOffset += chunk.length;
      }
      if (current.text.length >= PAGE_MAX_CHARACTERS) flush();
    }
  }

  flush();
  return result.length
    ? result
    : [{ blocks: [{ type: "text", content: "" }], text: "" }];
}

function splitPageText(text) {
  const paragraphs = String(text || "").split(/(\r?\n\s*\r?\n)/);
  const pages = [];
  let page = "";

  const flush = () => {
    if (page) {
      pages.push(page);
      page = "";
    }
  };

  for (const part of paragraphs) {
    if (part.length + page.length <= PAGE_MAX_CHARACTERS) {
      page += part;
      continue;
    }

    if (page) flush();

    if (part.length <= PAGE_MAX_CHARACTERS) {
      page = part;
      continue;
    }

    const sentences = part.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [part];

    for (const sentence of sentences) {
      if (sentence.length + page.length <= PAGE_MAX_CHARACTERS) {
        page += sentence;
      } else {
        flush();

        if (sentence.length <= PAGE_MAX_CHARACTERS) {
          page = sentence;
        } else {
          for (let i = 0; i < sentence.length; i += PAGE_MAX_CHARACTERS) {
            pages.push(sentence.slice(i, i + PAGE_MAX_CHARACTERS));
          }
        }
      }
    }
  }

  flush();
  return pages.length ? pages : [""];
}

function StudyResults({
  analysis,
  collapsed,
  onToggleCollapsed,
  onClear,
}) {
  const normalized = normalizeAnalysis(analysis);

  const hasAnalysis = (item) =>
    item.sentenceStructure &&
    item.grammarExplanation &&
    item.literaryAnalysis;

  return (
    <section className="study-section">
      <div className="study-section__header">
        <div className="study-section__controls">
          <button
            className="icon-text-button danger"
            type="button"
            onClick={onClear}
          >
            <X size={15} />
            Clear
          </button>

          <button
            className="icon-text-button"
            type="button"
            aria-expanded={!collapsed}
            aria-controls="study-results-content"
            onClick={onToggleCollapsed}
          >
            <ChevronDown
              className={
                collapsed
                  ? "study-toggle-icon is-collapsed"
                  : "study-toggle-icon"
              }
              size={16}
            />
            {collapsed ? "Show AI Analyze" : "Hide AI Analyze"}
          </button>
        </div>
      </div>

      <div
        id="study-results-content"
        className="study-results"
        hidden={collapsed}
      >
        <section className="panel-section overview-panel">
          <p className="eyebrow">Article analysis</p>
          <h2>Summary</h2>
          <p>{normalized.summary || "No summary was returned."}</p>

          {normalized.keyPoints.length > 0 && (
            <>
              <h3>Key points</h3>
              <ul className="key-points">
                {normalized.keyPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel-section">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Sentence study</p>
              <h2>Hard sentences</h2>
            </div>
           
          </div>

          {normalized.hardSentences.length ? (
            <div className="hard-sentence-accordions">
              {normalized.hardSentences.map((item, index) => (
                <article className="hard-sentence-card" key={item.id}>
                  <div className="hard-sentence-heading">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{item.text}</strong>
                  </div>

                  <div className="sentence-analysis">
                    <h3>Sentence Analysis</h3>

                    {hasAnalysis(item) ? (
                      <>
                        <h4>Sentence Structure</h4>
                        <div className="sentence-structure">
                          {structureGroups(item).map((group, groupIndex) => (
                            <section className="structure-group" key={`${group.label}-${groupIndex}`}>
                              <div className="structure-group__label">{group.label}</div>
                              <div className="structure-flow">
                                {group.tokens.map((token, tokenIndex) => (
                                  <div className="structure-token" key={`${token.text}-${tokenIndex}`}>
                                    <div className="structure-token__text">{token.text}</div>
                                    <div className="structure-token__type">{token.type}</div>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>

                        <h4>Grammar Explanation</h4>
                        <p>{item.grammarExplanation}</p>

                        <h4>Literary Analysis</h4>
                        <p>{item.literaryAnalysis}</p>

                        {item.chineseUnderstanding && (
                          <>
                            <h4>Chinese Understanding</h4>
                            <p>{item.chineseUnderstanding}</p>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="panel-empty">
                        This cached result lacks the complete sentence
                        analysis. Clear and analyze again.
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-empty">No hard sentences were returned.</p>
          )}
        </section>

        <section className="panel-section vocabulary-analysis-panel">
  <div className="panel-heading">
    <div>
      <p className="eyebrow">Vocabulary analysis</p>
      <h2>Vocabulary Analysis</h2>
    </div>

    
  </div>

  {normalized.vocabulary.length ? (
    <div className="vocabulary-analysis-list">
      {normalized.vocabulary.map((word, index) => (
        <article
          className="vocabulary-analysis-card"
          key={`${word.word}-${index}`}
        >
          <div className="vocabulary-analysis-card__top">
            <div className="vocabulary-analysis-card__word">
              {word.word}
            </div>

            <div className="vocabulary-analysis-card__meta">
              {word.partOfSpeech && (
                <span>{word.partOfSpeech}</span>
              )}

              {word.level && (
                <span>{word.level}</span>
              )}
            </div>
          </div>

          <div className="vocabulary-analysis-card__meaning">
            {word.meaning || "-"}
          </div>

          {word.usage && (
            <div className="vocabulary-analysis-card__usage">
              <span className="vocabulary-analysis-card__label">
                Usage &amp; Nuance
              </span>

              <p>{word.usage}</p>
            </div>
          )}
        </article>
      ))}
    </div>
  ) : (
    <p className="panel-empty">
      No vocabulary analysis was returned.
    </p>
  )}
</section>

        <section className="panel-section">
          <p className="eyebrow">Phrase study</p>
          <h2>Phrase &amp; Collocation</h2>

          {normalized.phrases.length ? (
            <div className="phrase-list">
              {normalized.phrases.map((phrase, index) => (
                <article
                  className="phrase-analysis"
                  key={`${phrase.phrase}-${index}`}
                >
                  <h3>{phrase.phrase}</h3>
                  <p>
                    <strong>Meaning:</strong> {phrase.meaning || "-"}
                  </p>
                  <p>
                    <strong>Context:</strong> {phrase.context || "-"}
                  </p>
                  <p>
                    <strong>Usage:</strong> {phrase.usage || "-"}
                  </p>
                 
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-empty">
              No phrase analysis was returned.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

export default function ReaderPage({
  article,
  articleId,
  articleTitle,
  highlights,
  initialPage = 1,
  onArticleChange,
  onTitleChange,
  onArticleSaved,
  onNewArticle,
  blocks = [],
  onBlocksChange,
}) {
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

  const readerPageRef = useRef(null);

  const hasBlocks = blocks.some((block) => block.type === "image");
  const blockPages = useMemo(() => hasBlocks ? splitBlockPages(blocks) : [], [blocks, hasBlocks]);
  const pages = useMemo(() => hasBlocks ? blockPages.map((page) => page.text) : splitPageText(article), [article, blockPages, hasBlocks]);
  const pageContent = pages[currentPage - 1] || "";
  const pageBlocks = hasBlocks ? (blockPages[currentPage - 1]?.blocks || []) : null;

  const pageOffset = hasBlocks
    ? blockPages
      .slice(0, currentPage - 1)
      .reduce((total, page) => total + page.blocks
        .filter((block) => block.type === "text")
        .reduce((sum, block) => sum + block.content.length, 0), 0)
    : pages
      .slice(0, currentPage - 1)
      .reduce((total, page) => total + page.length, 0);

  const dictionaryExpanded =
    analyzing ||
    translating ||
    Boolean(
      (analysis && !studyResultsCollapsed) ||
        (translations && !translationCollapsed)
    );

  useEffect(() => {
    if (articleId) {
      localStorage.setItem(
        `vocabulary-trainer:article-page:${articleId}`,
        String(currentPage)
      );
    }
  }, [articleId, currentPage]);

  useEffect(() => {
    setCurrentPage(
      Math.min(Math.max(initialPage, 1), pages.length)
    );
  }, [articleId, initialPage, pages.length]);

  useEffect(() => {
    setPageJump(String(currentPage));
  }, [currentPage]);

  // Clear analysis/translations when article text or page count changes.
  // blocks is intentionally NOT in dependencies: adding a highlight saves the
  // full article (which returns a new blocks array via the API) but the block
  // content is unchanged — only highlights changed.  Resetting the sidebars
  // on every highlight save would close them for the user.
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pages.length));
    setTranslations(null);
    setAnalysis(null);
  }, [article, pages.length]);

  function scrollReaderToTop() {
    requestAnimationFrame(() => {
      const target = readerPageRef.current;

      if (!target) return;

      const rect = target.getBoundingClientRect();
      const absoluteTop = window.scrollY + rect.top;

      window.scrollTo({
        top: Math.max(0, absoluteTop - 20),
        behavior: "smooth",
      });
    });
  }

  function changePage(nextPage) {
    const target = Math.min(
      Math.max(nextPage, 1),
      pages.length
    );

    if (target === currentPage) return;

    ++translationRequestGeneration.current;
    ++analysisRequestGeneration.current;

    setCurrentPage(target);
    setTranslations(null);
    setAnalysis(null);
    setTranslateError("");
    setAnalysisError("");
    setPageJump(String(target));

    scrollReaderToTop();
  }

  function pageItems() {
    const candidates = new Set([
      1,
      pages.length,
      currentPage - 1,
      currentPage,
      currentPage + 1,
    ]);

    return [...candidates]
      .filter((page) => page >= 1 && page <= pages.length)
      .sort((a, b) => a - b);
  }

  function jumpToPage(event) {
    event.preventDefault();

    const target = Math.min(
      Math.max(
        Number.parseInt(pageJump, 10) || currentPage,
        1
      ),
      pages.length
    );

    changePage(target);
  }

  async function saveCurrentArticle(draft = {}) {
    try {
      setSaveMessage("");

      const payload = {
        id: articleId,
        title: articleTitle,
        content: typeof draft.content === "string" ? draft.content : article,
        highlights,
        blocks: Array.isArray(draft.blocks)
          ? draft.blocks
          : (blocks.length ? blocks : undefined),
      };
      console.log("[ReaderPage] saveCurrentArticle – save payload", payload);

      const savedArticle = await saveArticle(payload);

      onArticleSaved(savedArticle);
      setSaveMessage("Article saved in your library.");
    } catch (err) {
      setSaveMessage(
        err.message || "Unable to save article."
      );
    }
  }

 async function saveUnderline(underline) {
  try {
    const savedArticle = await saveArticle({
      id: articleId,
      title: articleTitle,
      content: article,
      highlights: [...highlights, underline],
    });

    onArticleSaved(savedArticle);
  } catch (err) {
    console.error("Unable to save underline:", err);
  }
}

  async function removeUnderline(underlineId) {
  try {
    const savedArticle = await saveArticle({
      id: articleId,
      title: articleTitle,
      content: article,
      highlights: highlights.filter(
        (item) => item.id !== underlineId
      ),
    });

    onArticleSaved(savedArticle);
  } catch (err) {
    console.error("Unable to remove underline:", err);
  }
}

  async function updateUnderline(underlineId, changes) {
  try {
    const savedArticle = await saveArticle({
      id: articleId,
      title: articleTitle,
      content: article,
      highlights: highlights.map((item) =>
        item.id === underlineId
          ? { ...item, ...changes }
          : item
      ),
    });

    onArticleSaved(savedArticle);
  } catch (err) {
    setSaveMessage(
      err.message || "Unable to update underline."
    );
  }
}

  // IMPORTANT:
  // Translation remains PAGE-BASED.
  // Do not change pageContent to article here.
  async function handleTranslate() {
  // 当前页已经有翻译结果：
  // 只展开，不重复调用 API
  if (translations) {
    setTranslationCollapsed(false);
    return;
  }

  if (!article.trim()) return;

  const requestGeneration =
    ++translationRequestGeneration.current;

  const requestedPage = currentPage;

  setTranslating(true);
  setTranslateError("");

  try {
    const result = await translateArticle(
      pageContent,
      "zh",
      {
        articleId,
        pageNumber: requestedPage,
      }
    );

    if (
      translationRequestGeneration.current ===
        requestGeneration &&
      currentPage === requestedPage
    ) {
      setTranslations(
        Array.isArray(result?.paragraphs)
          ? result.paragraphs
          : []
      );

      // API 成功后自动展开
      setTranslationCollapsed(false);
    }
  } catch (err) {
    if (
      translationRequestGeneration.current ===
      requestGeneration
    ) {
      setTranslateError(
        err?.error ||
          err?.message ||
          "Translation failed."
      );
    }
  } finally {
    if (
      translationRequestGeneration.current ===
      requestGeneration
    ) {
      setTranslating(false);
    }
  }
  }

  // IMPORTANT:
  // Analysis remains PAGE-BASED.
  // Do not change pageContent to article here.
  async function handleAnalyze() {
    // 当前页已经有分析结果：
  // 只展开，不重复调用 API
  if (analysis) {
    setStudyResultsCollapsed(false);
    return;
  }

  if (!article.trim()) return;

  const requestGeneration =
    ++analysisRequestGeneration.current;

  const requestId = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  activeAnalysisRequestId.current = requestId;

  setAnalyzing(true);
  setAnalysisError("");

  try {
    console.log("[handleAnalyze] article.trim() length:", article.trim().length);
    console.log("[handleAnalyze] pageContent length:", pageContent.length);
    console.log("[handleAnalyze] pageContent preview:", pageContent.slice(0, 500));

    const result = await analyzeArticle(
      pageContent,
      requestId,
      {
        articleId,
        pageNumber: currentPage,
      }
    );

    console.log('[handleAnalyze] RESULT:',
      'type:', typeof result,
      'keys:', result && typeof result === 'object' ? Object.keys(result) : 'N/A',
      'summary:', typeof result?.summary === 'string' ? result.summary.slice(0,60) : result?.summary,
      'hardSentences.len:', result?.hardSentences?.length,
      'vocab.len:', result?.vocabularyAnalysis?.length,
      'phrases.len:', result?.phraseCollocations?.length);

    if (
      analysisRequestGeneration.current ===
      requestGeneration
    ) {
      setAnalysis(result);

      // API 成功后自动展开
      setStudyResultsCollapsed(false);
    }
  } catch (err) {
    if (
      analysisRequestGeneration.current ===
      requestGeneration
    ) {
      setAnalysisError(
        err?.error ||
          err?.message ||
          "Analysis failed."
      );
    }
  } finally {
    if (
      analysisRequestGeneration.current ===
      requestGeneration
    ) {
      setAnalyzing(false);
      activeAnalysisRequestId.current = null;
    }
  }
  }

  async function handleClearStudyResults() {
    if (
      !window.confirm(
        "Clear Study Results?\n\nThis deletes the cached AI analysis for this saved article. The next analysis will call AI again."
      )
    ) {
      return;
    }

    ++analysisRequestGeneration.current;
    setAnalyzing(false);
    setAnalysisError("");

    try {
      if (articleId) {
        await clearArticleAnalysis(
          articleId,
          pageContent,
          activeAnalysisRequestId.current,
          { pageNumber: currentPage }
        );
      }

      setAnalysis(null);
    } catch (err) {
      const message =
        err?.error ||
        err?.message ||
        "Unable to clear the saved analysis cache. Study results were kept.";

      setAnalysisError(
        err?.status === 404
          ? "The running backend is outdated. Restart npm start, then clear Study Results again."
          : message
      );
    }
  }

  async function selectWord(word) {
    setLastWord(word);
    setWordStatus("loading");
    setWordError("");
    setSelectedWord(null);
    setSaved(false);
    setSynced(false);
    setSyncMessage("");

    try {
      const result = await getWordDefinition(word);
      const entry = {
        ...result,
        word: result.word || word,
      };

      setSelectedWord(entry);
      setSaved(await isVocabularySaved(entry.word));
      setWordStatus("success");
    } catch {
      setWordError(
        "Unable to look up this word. Please try again."
      );
      setWordStatus("error");
    }
  }

  async function saveSelectedWord() {
    setSaving(true);
    setSyncMessage("");

    try {
      await saveVocabulary({
        ...selectedWord,
        articleId: articleId || null,
      });

      setSaved(true);

      try {
        await syncVocabularyToEudic(
          selectedWord.word,
          article
        );
        setSynced(true);
        setSyncMessage(
          "Saved to Vocabulary and synced to Eudic."
        );
      } catch {
        setSyncMessage(
          "Saved to Vocabulary. Eudic sync was unavailable."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="reader-page"
      ref={readerPageRef}
    >
      <ArticleInput
        articleId={articleId}
        title={articleTitle}
        article={article}
        onTitleChange={onTitleChange}
        onArticleChange={(content) => {
          onArticleChange(content);
          setSaveMessage("");
        }}
        onSave={saveCurrentArticle}
        onNew={() => {
          onNewArticle();
          setSaveMessage("");
        }}
        saveMessage={saveMessage}
        blocks={blocks}
        onBlocksChange={onBlocksChange}
      />

      {(translateError || analysisError) && (
        <section className="study-error">
          <strong>
            {analysisError
              ? "Analysis failed"
              : "Translation failed"}
          </strong>

          <span>
            {analysisError || translateError}
          </span>

          <button
            className="text-button"
            type="button"
            onClick={
              analysisError
                ? handleAnalyze
                : handleTranslate
            }
          >
            Retry
          </button>
        </section>
      )}

      <div
        className={`learning-layout ${
          dictionaryExpanded
            ? "learning-layout--study-open"
            : "learning-layout--dictionary-compact"
        }`}
      >
        <div className="reader-column">
          <Reader
            article={pageContent}
            blocks={pageBlocks}
            articleOffset={pageOffset}
            pageEnd={pageOffset + pageContent.length}
            highlights={highlights}
            onSelectWord={selectWord}
            onSaveUnderline={saveUnderline}
            onRemoveUnderline={removeUnderline}
            onUpdateUnderline={updateUnderline}
            onTranslateArticle={handleTranslate}
            onAnalyzeArticle={handleAnalyze}
            translating={translating}
            analyzing={analyzing}
          />

          <nav
            className="pagination-controls"
            aria-label="Article pages"
          >
            <button
              className="pagination-button"
              type="button"
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={() =>
                changePage(currentPage - 1)
              }
            >
              <ChevronLeft size={16} />
            </button>

            {pageItems().map((page, index, items) => (
              <span
                className="pagination-item"
                key={page}
              >
                {index > 0 &&
                  page - items[index - 1] > 1 && (
                    <span className="pagination-ellipsis">
                      ...
                    </span>
                  )}

                <button
                  className={
                    page === currentPage
                      ? "pagination-page is-current"
                      : "pagination-page"
                  }
                  type="button"
                  aria-current={
                    page === currentPage
                      ? "page"
                      : undefined
                  }
                  onClick={() =>
                    changePage(page)
                  }
                >
                  {page}
                </button>
              </span>
            ))}

            <button
              className="pagination-button"
              type="button"
              aria-label="Next page"
              disabled={currentPage === pages.length}
              onClick={() =>
                changePage(currentPage + 1)
              }
            >
              <ChevronRight size={16} />
            </button>

            <form
              className="pagination-jump"
              onSubmit={jumpToPage}
            >
              <input
                aria-label="Jump to page"
                value={pageJump}
                onChange={(event) =>
                  setPageJump(event.target.value)
                }
                inputMode="numeric"
              />
            </form>
          </nav>
        </div>

        <aside className="learning-panel">
          {analysis && (
            <StudyResults
              analysis={analysis}
              collapsed={studyResultsCollapsed}
              onToggleCollapsed={() =>
                setStudyResultsCollapsed(
                  (value) => !value
                )
              }
              onClear={handleClearStudyResults}
            />
          )}

          {translations && (
  <section className="translation-panel">
    <div className="translation-panel__header">
      <div className="translation-panel__title">
        <Languages size={16} />
        <h2>Translation</h2>
        <span className="translation-count">
          {translations.length}
        </span>
      </div>

      <button
        className="translation-toggle"
        type="button"
        aria-expanded={!translationCollapsed}
        aria-controls="translation-results-content"
        onClick={() =>
          setTranslationCollapsed((collapsed) => !collapsed)
        }
      >
        <ChevronDown
          size={15}
          className={
            translationCollapsed
              ? "study-toggle-icon is-collapsed"
              : "study-toggle-icon"
          }
        />

        {translationCollapsed ? "Show Translation" : "Hide Translation"}
      </button>
    </div>

    <div
      id="translation-results-content"
      className="translation-list"
      hidden={translationCollapsed}
    >
      {translations.map((item, index) => (
        <article
          className="translation-item"
          key={index}
        >
          <div className="translation-item__number">
            {String(index + 1).padStart(2, "0")}
          </div>

          <div className="translation-item__content">
            <div className="translation-block translation-block--source">
              <span className="translation-label">
                English
              </span>

              <p>{item.source}</p>
            </div>

            <div className="translation-divider" />

            <div className="translation-block translation-block--target">
              <span className="translation-label">
                Chinese
              </span>

              <p>{item.translated}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  </section>
)}

          <section
            className={`panel-section word-panel ${
              dictionaryExpanded
                ? "word-panel--expanded"
                : "word-panel--compact"
            }`}
          >
            <div className="panel-heading">
              <div>
                <h2>Dictionary</h2>
              </div>
            </div>

            {wordStatus === "idle" && (
              <p className="panel-empty">
                Click an English word to look it up.
              </p>
            )}

            {wordStatus === "loading" && (
              <p className="panel-empty">
                Looking up word...
              </p>
            )}

            {wordStatus === "error" && (
              <div className="panel-empty">
                <p>{wordError}</p>

                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    selectWord(lastWord)
                  }
                >
                  Retry
                </button>
              </div>
            )}

            {wordStatus === "success" &&
              selectedWord && (
                <DictionaryCard
                  result={selectedWord}
                  isSaved={saved}
                  isSaving={saving}
                  isSynced={synced}
                  onSave={saveSelectedWord}
                  syncMessage={syncMessage}
                />
              )}
          </section>
        </aside>
      </div>
    </div>
  );
}
