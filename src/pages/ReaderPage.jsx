import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Languages,
  X,
} from "lucide-react";

import {
  getWordDefinition,
  syncVocabularyToEudic,
} from "../api/dictionary";

import {
  isVocabularySaved,
  saveVocabulary,
} from "../api/vocabulary";

import { saveArticle } from "../api/articles";
import { translateArticle } from "../api/translation";
import {
  analyzeArticle,
  clearArticleAnalysis,
} from "../api/analysis";

import ArticleInput from "../components/ArticleInput";
import DictionaryCard from "../components/DictionaryCard";
import Reader from "../components/Reader";
import ConfirmModal from "../components/ConfirmModal";


function structureTokens(value) {
  return String(value || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(
        /^(.*?)(?:\s*\(([^()]+)\))([,;:.!?]*)$/
      );

      return {
        text: (match ? match[1] : part).trim(),
        type:
          match?.[2]?.trim() ||
          "Structure element",
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
    .filter(
      (group) =>
        group &&
        typeof group === "object"
    )
    .map((group) => ({
      label:
        typeof group.label === "string"
          ? group.label.trim()
          : "Sentence structure",

      tokens: Array.isArray(group.tokens)
        ? group.tokens
            .filter(
              (token) =>
                token &&
                typeof token === "object" &&
                String(token.text || "").trim()
            )
            .map((token) => ({
              text: String(token.text).trim(),
              type: String(
                token.type ||
                  "Structure element"
              ).trim(),
            }))
        : [],
    }))
    .filter(
      (group) => group.tokens.length
    );
}


function fallbackStructureGroups(value) {
  const tokens = structureTokens(value);

  if (!tokens.length) {
    return [];
  }

  const modifierTypes =
    /^(?:prepositional phrase|participial phrase|infinitive phrase|relative clause)$/i;

  const modifiers = tokens.filter((token) =>
    modifierTypes.test(token.type)
  );

  const coreTokens = tokens.filter(
    (token) => !modifierTypes.test(token.type)
  );

  const groups = coreTokens.length
    ? [
        {
          label: "Sentence flow",
          tokens: coreTokens,
        },
      ]
    : [];

  if (modifiers.length) {
    groups.push({
      label: "Inline modifiers",
      tokens: modifiers,
    });
  }

  return groups.length
    ? groups
    : [
        {
          label: "Sentence flow",
          tokens,
        },
      ];
}


function structureGroups(item) {
  return item.sentenceStructureGroups.length
    ? item.sentenceStructureGroups
    : fallbackStructureGroups(
        item.sentenceStructure
      );
}


function normalizeAnalysis(value) {
  const payload =
    value && typeof value === "object"
      ? value
      : {};

  const displayText = (input) => {
    if (input == null) {
      return "";
    }

    if (
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean"
    ) {
      return String(input);
    }

    if (Array.isArray(input)) {
      return input
        .map(displayText)
        .filter(Boolean)
        .join("; ");
    }

    if (typeof input === "object") {
      return Object.values(input)
        .map(displayText)
        .filter(Boolean)
        .join("; ");
    }

    return "";
  };

  const safeItems = (input) =>
    Array.isArray(input)
      ? input.filter(
          (item) =>
            item &&
            typeof item === "object"
        )
      : [];

  return {
    summary: displayText(payload.summary),

    keyPoints: Array.isArray(
      payload.keyPoints
    )
      ? payload.keyPoints
          .map(displayText)
          .filter(Boolean)
      : [],

    hardSentences: safeItems(
      payload.hardSentences
    )
      .map((item, index) => ({
        ...item,

        id: index,

        text: displayText(
          item.sentence || item.text
        ),

        structure: displayText(
          item.structure
        ),

        sentenceStructure: displayText(
          item.sentenceStructure
        ),

        sentenceStructureGroups:
          normalizeStructureGroups(
            item.sentenceStructureGroups
          ),

        grammarExplanation: displayText(
          item.grammarExplanation
        ),

        literaryAnalysis: displayText(
          item.literaryAnalysis
        ),

        chineseUnderstanding: displayText(
          item.chineseUnderstanding
        ),
      }))
      .filter(
        (item) =>
          item.text &&
          !/^(?:[IVXLCDM]+|\d+)[.)]?$/i.test(
            item.text.trim()
          )
      ),

    vocabulary: safeItems(
      payload.vocabularyAnalysis
    )
      .filter((item) => item.word)
      .map((item) => ({
        ...item,

        word: displayText(item.word),

        partOfSpeech: displayText(
          item.partOfSpeech
        ),

        level: displayText(item.level),

        meaning: displayText(
          item.meaning
        ),

        usage: displayText(
          item.usage
        ),
      })),

    phrases: safeItems(
      payload.phraseCollocations
    )
      .filter((item) => item.phrase)
      .map((item) => ({
        ...item,

        phrase: displayText(
          item.phrase
        ),

        meaning: displayText(
          item.meaning
        ),

        context: displayText(
          item.context
        ),

        usage: displayText(
          item.usage
        ),

        example: displayText(
          item.example
        ),
      })),
  };
}


function hasValidAnalysis(value) {
  if (!value || typeof value !== 'object') return false;

  const payload = value;

  return (
    typeof payload.summary === 'string' &&
    payload.summary.trim().length > 0 &&
    Array.isArray(payload.hardSentences) &&
    payload.hardSentences.length > 0 &&
    Array.isArray(payload.vocabularyAnalysis) &&
    payload.vocabularyAnalysis.length > 0 &&
    Array.isArray(payload.phraseCollocations)
  );
}

const PAGE_MAX_CHARACTERS = 1800;


function splitPageText(text) {
  const paragraphs = String(text || "")
    .split(/(\r?\n\s*\r?\n)/);

  const pages = [];
  let page = "";

  const flush = () => {
    if (page) {
      pages.push(page);
      page = "";
    }
  };

  for (const part of paragraphs) {
    if (
      part.length + page.length <=
      PAGE_MAX_CHARACTERS
    ) {
      page += part;
      continue;
    }

    if (page) {
      flush();
    }

    if (
      part.length <= PAGE_MAX_CHARACTERS
    ) {
      page = part;
      continue;
    }

    const sentences =
      part.match(
        /(?<!Mr|Mrs|Dr|U\.S)\.(?=\s+[A-Z])/ 
      ) || [part];

    for (const sentence of sentences) {
      if (
        sentence.length + page.length <=
        PAGE_MAX_CHARACTERS
      ) {
        page += sentence;
      } else {
        flush();

        if (
          sentence.length <=
          PAGE_MAX_CHARACTERS
        ) {
          page = sentence;
        } else {
          for (
            let i = 0;
            i < sentence.length;
            i += PAGE_MAX_CHARACTERS
          ) {
            pages.push(
              sentence.slice(
                i,
                i + PAGE_MAX_CHARACTERS
              )
            );
          }
        }
      }
    }
  }

  flush();

  return pages.length
    ? pages
    : [""];
}


function splitBlockPages(blocks) {
  const result = [];

  let current = {
    blocks: [],
    text: "",
  };

  let sourceOffset = 0;

  const flush = () => {
    if (current.blocks.length) {
      result.push(current);
    }

    current = {
      blocks: [],
      text: "",
    };
  };

  for (const block of blocks) {
    if (
      !block ||
      !["text", "image"].includes(
        block.type
      )
    ) {
      continue;
    }

    if (block.type === "image") {
      current.blocks.push(block);
      continue;
    }

    const chunks = splitPageText(
      block.content
    );

    for (const chunk of chunks) {
      if (
        current.text &&
        current.text.length +
          chunk.length >
          PAGE_MAX_CHARACTERS
      ) {
        flush();
      }

      if (chunk) {
        current.blocks.push({
          ...block,
          type: "text",
          content: chunk,
          textOffset: sourceOffset,
        });

        current.text += chunk;
        sourceOffset += chunk.length;
      }

      if (
        current.text.length >=
        PAGE_MAX_CHARACTERS
      ) {
        flush();
      }
    }
  }

  flush();

  return result.length
    ? result
    : [
        {
          blocks: [
            {
              type: "text",
              content: "",
            },
          ],
          text: "",
        },
      ];
}


function StudyResults({
  analysis,
  collapsed,
  onToggleCollapsed,
  onClear,
}) {
  const normalized =
    normalizeAnalysis(analysis);

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
            onClick={
              onToggleCollapsed
            }
          >
            <ChevronDown
              className={
                collapsed
                  ? "study-toggle-icon is-collapsed"
                  : "study-toggle-icon"
              }
              size={16}
            />

            {collapsed
              ? "Show AI Analyze"
              : "Hide AI Analyze"}
          </button>
        </div>
      </div>

      <div
        id="study-results-content"
        className="study-results"
        hidden={collapsed}
      >
        <section className="panel-section overview-panel">
          <p className="eyebrow">
            Article analysis
          </p>

          <h2>Summary</h2>

          <p>
            {normalized.summary ||
              "No summary was returned."}
          </p>

          {normalized.keyPoints.length >
            0 && (
            <>
              <h3>Key points</h3>

              <ul className="key-points">
                {normalized.keyPoints.map(
                  (point, index) => (
                    <li key={index}>
                      {point}
                    </li>
                  )
                )}
              </ul>
            </>
          )}
        </section>

        <section className="panel-section">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                Sentence study
              </p>

              <h2>
                Hard sentences
              </h2>
            </div>
          </div>

          {normalized.hardSentences
            .length ? (
            <div className="hard-sentence-accordions">
              {normalized.hardSentences.map(
                (item, index) => (
                  <article
                    className="hard-sentence-card"
                    key={item.id}
                  >
                    <div className="hard-sentence-heading">
                      <span>
                        {String(
                          index + 1
                        ).padStart(2, "0")}
                      </span>

                      <strong>
                        {item.text}
                      </strong>
                    </div>

                    <div className="sentence-analysis">
                      <h3>
                        Sentence Analysis
                      </h3>

                      {hasAnalysis(
                        item
                      ) ? (
                        <>
                          <h4>
                            Sentence Structure
                          </h4>

                          <div className="sentence-structure">
                            {structureGroups(
                              item
                            ).map(
                              (
                                group,
                                groupIndex
                              ) => (
                                <section
                                  className="structure-group"
                                  key={`${group.label}-${groupIndex}`}
                                >
                                  <div className="structure-group__label">
                                    {
                                      group.label
                                    }
                                  </div>

                                  <div className="structure-flow">
                                    {group.tokens.map(
                                      (
                                        token,
                                        tokenIndex
                                      ) => (
                                        <div
                                          className="structure-token"
                                          key={`${token.text}-${tokenIndex}`}
                                        >
                                          <div className="structure-token__text">
                                            {
                                              token.text
                                            }
                                          </div>

                                          <div className="structure-token__type">
                                            {
                                              token.type
                                            }
                                          </div>
                                        </div>
                                      )
                                    )}
                                  </div>
                                </section>
                              )
                            )}
                          </div>

                          <h4>
                            Grammar Explanation
                          </h4>

                          <p>
                            {
                              item.grammarExplanation
                            }
                          </p>

                          <h4>
                            Literary Analysis
                          </h4>

                          <p>
                            {
                              item.literaryAnalysis
                            }
                          </p>

                          {item.chineseUnderstanding && (
                            <>
                              <h4>
                                Chinese Understanding
                              </h4>

                              <p>
                                {
                                  item.chineseUnderstanding
                                }
                              </p>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="panel-empty">
                          This cached result
                          lacks the complete
                          sentence analysis.
                          Clear and analyze
                          again.
                        </p>
                      )}
                    </div>
                  </article>
                )
              )}
            </div>
          ) : (
            <p className="panel-empty">
              No hard sentences were
              returned.
            </p>
          )}
        </section>

        <section className="panel-section vocabulary-analysis-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                Vocabulary analysis
              </p>

              <h2>
                Vocabulary Analysis
              </h2>
            </div>
          </div>

          {normalized.vocabulary.length ? (
            <div className="vocabulary-analysis-list">
              {normalized.vocabulary.map(
                (word, index) => (
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
                          <span>
                            {
                              word.partOfSpeech
                            }
                          </span>
                        )}

                        {word.level && (
                          <span>
                            {word.level}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="vocabulary-analysis-card__meaning">
                      {word.meaning ||
                        "-"}
                    </div>

                    {word.usage && (
                      <div className="vocabulary-analysis-card__usage">
                        <span className="vocabulary-analysis-card__label">
                          Usage &amp; Nuance
                        </span>

                        <p>
                          {word.usage}
                        </p>
                      </div>
                    )}
                  </article>
                )
              )}
            </div>
          ) : (
            <p className="panel-empty">
              No vocabulary analysis
              was returned.
            </p>
          )}
        </section>

        <section className="panel-section">
          <p className="eyebrow">
            Phrase study
          </p>

          <h2>
            Phrase &amp; Collocation
          </h2>

          {normalized.phrases.length ? (
            <div className="phrase-list">
              {normalized.phrases.map(
                (phrase, index) => (
                  <article
                    className="phrase-analysis"
                    key={`${phrase.phrase}-${index}`}
                  >
                    <h3>
                      {phrase.phrase}
                    </h3>

                    <p>
                      <strong>
                        Meaning:
                      </strong>{" "}
                      {phrase.meaning ||
                        "-"}
                    </p>

                    <p>
                      <strong>
                        Context:
                      </strong>{" "}
                      {phrase.context ||
                        "-"}
                    </p>

                    <p>
                      <strong>
                        Usage:
                      </strong>{" "}
                      {phrase.usage ||
                        "-"}
                    </p>
                  </article>
                )
              )}
            </div>
          ) : (
            <p className="panel-empty">
              No phrase analysis was
              returned.
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

  theme,
  setTheme,
}) {
  const [selectedWord, setSelectedWord] =
    useState(null);

  const [wordStatus, setWordStatus] =
    useState("idle");

  const [wordError, setWordError] =
    useState("");

  const [lastWord, setLastWord] =
    useState("");

  const [saved, setSaved] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [synced, setSynced] =
    useState(false);

  const [syncMessage, setSyncMessage] =
    useState("");

  const [saveMessage, setSaveMessage] =
    useState("");

  const [translations, setTranslations] =
    useState(null);

  const [translating, setTranslating] =
    useState(false);

  const [translateError, setTranslateError] =
    useState("");

  const [analysis, setAnalysis] =
    useState(null);

  const [analysisError, setAnalysisError] =
    useState("");

  const [analyzing, setAnalyzing] =
    useState(false);

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const [fontSize, setFontSize] =
  useState(() => {
    return Number(
      localStorage.getItem(
        "reader-font-size"
      )
    ) || 18;
  });


useEffect(() => {
  localStorage.setItem(
    "reader-font-size",
    String(fontSize)
  );
}, [fontSize]);

// Load vocabulary
useEffect(() => {
  async function loadVocabulary() {
    try {
      const res = await fetch("/api/vocabulary?limit=10000");
      const data = await res.json();
      setSavedWords(data.items.map((item) => item.word.toLowerCase()));
    } catch (e) {
      console.error(e);
    }
  }
  loadVocabulary();
}, []);


function increaseFont() {
  setFontSize((size) =>
    Math.min(size + 2, 32)
  );
}


function decreaseFont() {
  setFontSize((size) =>
    Math.max(size - 2, 12)
  );
}


function resetFont() {
  setFontSize(18);
}

  const [
    studyResultsCollapsed,
    setStudyResultsCollapsed,
  ] = useState(false);

  const [
    translationCollapsed,
    setTranslationCollapsed,
  ] = useState(false);

  const [savedWords, setSavedWords] = useState([]);

  const [currentPage, setCurrentPage] =
    useState(initialPage);

  const [pageJump, setPageJump] =
    useState(String(initialPage));

  const analysisRequestGeneration =
    useRef(0);

  const translationRequestGeneration =
    useRef(0);

  const activeAnalysisRequestId =
    useRef(null);

  const analysisAbortControllerRef =
    useRef(null);

  const translationAbortControllerRef =
    useRef(null);

  const readerPageRef =
    useRef(null);


  const hasBlocks = blocks.some(
    (block) =>
      block.type === "image"
  );

  const blockPages = useMemo(
    () =>
      hasBlocks
        ? splitBlockPages(blocks)
        : [],
    [blocks, hasBlocks]
  );

  const pages = useMemo(
    () =>
      hasBlocks
        ? blockPages.map(
            (page) => page.text
          )
        : splitPageText(article),
    [article, blockPages, hasBlocks]
  );

  const pageContent =
    pages[currentPage - 1] || "";

  const pageBlocks = hasBlocks
    ? blockPages[currentPage - 1]
        ?.blocks || []
    : null;


  const pageOffset = hasBlocks
    ? blockPages
        .slice(0, currentPage - 1)
        .reduce(
          (total, page) =>
            total +
            page.blocks
              .filter(
                (block) =>
                  block.type === "text"
              )
              .reduce(
                (sum, block) =>
                  sum +
                  block.content.length,
                0
              ),
          0
        )
    : pages
        .slice(0, currentPage - 1)
        .reduce(
          (total, page) =>
            total + page.length,
          0
        );


  const dictionaryExpanded =
    analyzing ||
    translating ||
    Boolean(
      (analysis &&
        !studyResultsCollapsed) ||
        (translations &&
          !translationCollapsed)
    );


  useEffect(() => {
    if (!articleId) {
      return;
    }

    localStorage.setItem(
      `vocabulary-trainer:article-page:${articleId}`,
      String(currentPage)
    );
  }, [articleId, currentPage]);


  useEffect(() => {
    setCurrentPage(
      Math.min(
        Math.max(initialPage, 1),
        pages.length
      )
    );
  }, [
    articleId,
    initialPage,
    pages.length,
  ]);


  useEffect(() => {
    setPageJump(
      String(currentPage)
    );
  }, [currentPage]);


  useEffect(() => {
    setCurrentPage((page) =>
      Math.min(page, pages.length)
    );

    setTranslations(null);
    setAnalysis(null);
  }, [article, pages.length]);


  function scrollReaderToTop() {
    requestAnimationFrame(() => {
      const target =
        readerPageRef.current;

      if (!target) {
        return;
      }

      const rect =
        target.getBoundingClientRect();

      const absoluteTop =
        window.scrollY + rect.top;

      window.scrollTo({
        top: Math.max(
          0,
          absoluteTop - 20
        ),
        behavior: "smooth",
      });
    });
  }


  function changePage(nextPage) {
    const target = Math.min(
      Math.max(nextPage, 1),
      pages.length
    );

    if (target === currentPage) {
      return;
    }

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
      .filter(
        (page) =>
          page >= 1 &&
          page <= pages.length
      )
      .sort(
        (a, b) => a - b
      );
  }


  function jumpToPage(event) {
    event.preventDefault();

    const target = Math.min(
      Math.max(
        Number.parseInt(
          pageJump,
          10
        ) || currentPage,
        1
      ),
      pages.length
    );

    changePage(target);
  }


  async function saveCurrentArticle(
    draft = {}
  ) {
    try {
      setSaveMessage("");

      const payload = {
        id: articleId,
        title: articleTitle,

        content:
          typeof draft.content ===
          "string"
            ? draft.content
            : article,

        highlights,

        blocks: Array.isArray(
          draft.blocks
        )
          ? draft.blocks
          : blocks.length
            ? blocks
            : undefined,
      };

      const savedArticle =
        await saveArticle(
          payload
        );

      onArticleSaved(savedArticle);

      setSaveMessage(
        "Article saved in your library."
      );
    } catch (err) {
      setSaveMessage(
        err.message ||
          "Unable to save article."
      );
    }
  }


  async function saveUnderline(
    underline
  ) {
    try {
      const savedArticle =
        await saveArticle({
          id: articleId,
          title: articleTitle,
          content: article,

          highlights: [
            ...highlights,
            underline,
          ],
        });

      onArticleSaved(savedArticle);
    } catch (err) {
      console.error(
        "Unable to save underline:",
        err
      );
    }
  }


  async function removeUnderline(
    underlineId
  ) {
    try {
      const savedArticle =
        await saveArticle({
          id: articleId,
          title: articleTitle,
          content: article,

          highlights:
            highlights.filter(
              (item) =>
                item.id !==
                underlineId
            ),
        });

      onArticleSaved(savedArticle);
    } catch (err) {
      console.error(
        "Unable to remove underline:",
        err
      );
    }
  }


  async function updateUnderline(
    underlineId,
    changes
  ) {
    try {
      const savedArticle =
        await saveArticle({
          id: articleId,
          title: articleTitle,
          content: article,

          highlights:
            highlights.map(
              (item) =>
                item.id ===
                underlineId
                  ? {
                      ...item,
                      ...changes,
                    }
                  : item
            ),
        });

      onArticleSaved(savedArticle);
    } catch (err) {
      setSaveMessage(
        err.message ||
          "Unable to update underline."
      );
    }
  }


  async function handleTranslate() {
    if (translations) {
      setTranslationCollapsed(false);
      return;
    }

    if (!article.trim()) {
      return;
    }

    // Cancel any in-flight translation request
    if (translationAbortControllerRef.current) {
      translationAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    translationAbortControllerRef.current = abortController;

    const requestGeneration = ++translationRequestGeneration.current;
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
          signal: abortController.signal,
        }
      );

      if (
        translationRequestGeneration.current === requestGeneration &&
        currentPage === requestedPage &&
        !abortController.signal.aborted
      ) {
        setTranslations(
          Array.isArray(result?.paragraphs) ? result.paragraphs : []
        );
        setTranslationCollapsed(false);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // Ignore aborted requests
      }
      if (
        translationRequestGeneration.current === requestGeneration &&
        !abortController.signal.aborted
      ) {
        setTranslateError(err?.error || err?.message || "Translation failed.");
      }
    } finally {
      if (translationRequestGeneration.current === requestGeneration) {
        setTranslating(false);
        translationAbortControllerRef.current = null;
      }
    }
  }


  async function handleAnalyze() {
    if (hasValidAnalysis(analysis)) {
      setStudyResultsCollapsed(false);
      return;
    }

    if (!article.trim()) {
      return;
    }

    // Cancel any in-flight analysis request
    if (analysisAbortControllerRef.current) {
      analysisAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    analysisAbortControllerRef.current = abortController;

    const requestGeneration = ++analysisRequestGeneration.current;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    activeAnalysisRequestId.current = requestId;

    setAnalyzing(true);
    setAnalysisError("");

    try {
      const result = await analyzeArticle(
        pageContent,
        requestId,
        {
          articleId,
          pageNumber: currentPage,
          signal: abortController.signal,
        }
      );

      if (
        analysisRequestGeneration.current === requestGeneration &&
        !abortController.signal.aborted
      ) {
        setAnalysis(result);
        setStudyResultsCollapsed(false);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // Ignore aborted requests
      }
      if (
        analysisRequestGeneration.current === requestGeneration &&
        !abortController.signal.aborted
      ) {
        setAnalysisError(err?.error || err?.message || "Analysis failed.");
      }
    } finally {
      if (analysisRequestGeneration.current === requestGeneration) {
        setAnalyzing(false);
        activeAnalysisRequestId.current = null;
        analysisAbortControllerRef.current = null;
      }
    }
  }


  async function executeClearStudyResults() {
    ++analysisRequestGeneration.current;

    setAnalyzing(false);
    setAnalysisError("");

    try {
      if (articleId) {
        await clearArticleAnalysis(
          articleId,
          pageContent,
          activeAnalysisRequestId.current,
          {
            pageNumber:
              currentPage,
          }
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
    } finally {
      setClearConfirmOpen(false);
    }
  }

  function handleClearStudyResults() {
    setClearConfirmOpen(true);
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
      const result =
        await getWordDefinition(
          word
        );

      const entry = {
        ...result,
        word:
          result.word || word,
      };

      setSelectedWord(entry);

      setSaved(
        await isVocabularySaved(
          entry.word
        )
      );

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
        articleId:
          articleId || null,
      });

      // Immediately update savedWords for instant highlight update
      setSavedWords(prev => {        const word = selectedWord.word.toLowerCase();        if (!prev.includes(word)) {          return [...prev, word];        }        return prev;      });

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
      className="reader-page reader-page--editing"
      ref={readerPageRef}
    >
      {/* =========================================
          Article Editor
          ========================================= */}
      <ArticleInput
        article={article}
        title={articleTitle}
        articleId={articleId}
        fontSize={fontSize}
        setFontSize={setFontSize}
        blocks={blocks}
        onArticleChange={
          onArticleChange
        }
        onTitleChange={
          onTitleChange
        }
        onBlocksChange={
          onBlocksChange
        }
        onSave={saveCurrentArticle}
        onNewArticle={() => {
            if (typeof onNewArticle === "function") {
              onNewArticle();
            }
          }}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Save message */}
      {clearConfirmOpen && (
      <ConfirmModal
        open={clearConfirmOpen}
        title="Clear Study Results?"
        message="Are you sure you want to clear the study results? This action cannot be undone."
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={executeClearStudyResults}
        confirmText="Clear"
      />
    )}

    {clearConfirmOpen && (
      <ConfirmModal
        open={clearConfirmOpen}
        title="Clear Study Results?"
        message="Are you sure you want to clear the study results? This action cannot be undone."
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={executeClearStudyResults}
        confirmText="Clear"
      />
    )}

    {clearConfirmOpen && (
      <ConfirmModal
        open={clearConfirmOpen}
        title="Clear Study Results?"
        message="Are you sure you want to clear the study results? This action cannot be undone."
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={executeClearStudyResults}
        confirmText="Clear"
      />
    )}

    {saveMessage && (
        <div className="article-save-message">
          {saveMessage}
        </div>
      )}

      

      {/* =========================================
          Translation / Analysis Error
          ========================================= */}
      {(translateError ||
        analysisError) && (
        <section className="study-error">
          <strong>
            {analysisError
              ? "Analysis failed"
              : "Translation failed"}
          </strong>

          <span>
            {analysisError ||
              translateError}
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

      {/* =========================================
          Reader + Learning Panel
          ========================================= */}
      <div
        className={`learning-layout ${
          dictionaryExpanded
            ? "learning-layout--study-open"
            : "learning-layout--dictionary-compact"
        }`}
      >
        {/* =======================================
            Reader Column
            ======================================= */}
        <div className="reader-column">
          <Reader
            article={pageContent}
             fontSize={fontSize}
             setFontSize={setFontSize}
            blocks={pageBlocks}
            articleOffset={pageOffset}
            pageEnd={
              pageOffset +
              pageContent.length
            }
            highlights={highlights}
            savedWords={savedWords}
            onSelectWord={
              selectWord
            }
            onSaveUnderline={
              saveUnderline
            }
            onRemoveUnderline={
              removeUnderline
            }
            onUpdateUnderline={
              updateUnderline
            }
            onTranslateArticle={
              handleTranslate
            }
            onAnalyzeArticle={
              handleAnalyze
            }
            translating={
              translating
            }
            analyzing={
              analyzing
            }
            theme={theme}
            setTheme={setTheme}
          />

          

          {/* =====================================
              Pagination
              ===================================== */}
          <nav
            className="pagination-controls"
            aria-label="Article pages"
          >
            <button
              className="pagination-button"
              type="button"
              aria-label="Previous page"
              disabled={
                currentPage === 1
              }
              onClick={() =>
                changePage(
                  currentPage - 1
                )
              }
            >
              <ChevronLeft
                size={16}
              />
            </button>

            {pageItems().map(
              (
                page,
                index,
                items
              ) => (
                <span
                  className="pagination-item"
                  key={page}
                >
                  {index > 0 &&
                    page -
                      items[
                        index - 1
                      ] >
                      1 && (
                      <span className="pagination-ellipsis">
                        ...
                      </span>
                    )}

                  <button
                    className={
                      page ===
                      currentPage
                        ? "pagination-page is-current"
                        : "pagination-page"
                    }
                    type="button"
                    aria-current={
                      page ===
                      currentPage
                        ? "page"
                        : undefined
                    }
                    onClick={() =>
                      changePage(
                        page
                      )
                    }
                  >
                    {page}
                  </button>
                </span>
              )
            )}

            <button
              className="pagination-button"
              type="button"
              aria-label="Next page"
              disabled={
                currentPage ===
                pages.length
              }
              onClick={() =>
                changePage(
                  currentPage + 1
                )
              }
            >
              <ChevronRight
                size={16}
              />
            </button>

            <form
              className="pagination-jump"
              onSubmit={
                jumpToPage
              }
            >
              <input
                aria-label="Jump to page"
                value={pageJump}
                onChange={(
                  event
                ) =>
                  setPageJump(
                    event.target
                      .value
                  )
                }
                inputMode="numeric"
              />
            </form>
          </nav>
        </div>

        {/* =======================================
            Learning Panel
            ======================================= */}
        <aside className="learning-panel">
          {/* =====================================
              AI Analysis
              ===================================== */}
          {analysis && (
            <StudyResults
              analysis={analysis}
              collapsed={
                studyResultsCollapsed
              }
              onToggleCollapsed={() =>
                setStudyResultsCollapsed(
                  (value) =>
                    !value
                )
              }
              onClear={
                handleClearStudyResults
              }
            />
          )}

          {/* =====================================
              Translation
              ===================================== */}
          {translations && (
            <section className="translation-panel">
              <div className="translation-panel__header">
                <div className="translation-panel__title">
                  <Languages
                    size={16}
                  />

                  <h2>
                    Translation
                  </h2>

                  <span className="translation-count">
                    {
                      translations.length
                    }
                  </span>
                </div>

                <button
                  className="translation-toggle"
                  type="button"
                  aria-expanded={
                    !translationCollapsed
                  }
                  aria-controls="translation-results-content"
                  onClick={() =>
                    setTranslationCollapsed(
                      (collapsed) =>
                        !collapsed
                    )
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

                  {translationCollapsed
                    ? "Show Translation"
                    : "Hide Translation"}
                </button>
              </div>

              <div
                id="translation-results-content"
                className="translation-list"
                hidden={
                  translationCollapsed
                }
              >
                {translations.map(
                  (
                    item,
                    index
                  ) => (
                    <article
                      className="translation-item"
                      key={index}
                    >
                      <div className="translation-item__number">
                        {String(
                          index + 1
                        ).padStart(
                          2,
                          "0"
                        )}
                      </div>

                      <div className="translation-item__content">
                        <div className="translation-block translation-block--source">
                          <span className="translation-label">
                            English
                          </span>

                          <p>
                            {
                              item.source
                            }
                          </p>
                        </div>

                        <div className="translation-divider" />

                        <div className="translation-block translation-block--target">
                          <span className="translation-label">
                            Chinese
                          </span>

                          <p>
                            {
                              item.translated
                            }
                          </p>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
            </section>
          )}

          {/* =====================================
              Dictionary
              ===================================== */}
          <section
            className={`panel-section word-panel ${
              dictionaryExpanded
                ? "word-panel--expanded"
                : "word-panel--compact"
            }`}
          >
            <div className="panel-heading">
              <div>
                <h2>
                  Dictionary
                </h2>
              </div>
            </div>

            {wordStatus ===
              "idle" && (
              <p className="panel-empty">
                Click an English word
                to look it up.
              </p>
            )}

            {wordStatus ===
              "loading" && (
              <p className="panel-empty">
                Looking up word...
              </p>
            )}

            {wordStatus ===
              "error" && (
              <div className="panel-empty">
                <p>
                  {wordError}
                </p>

                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    selectWord(
                      lastWord
                    )
                  }
                >
                  Retry
                </button>
              </div>
            )}

            {wordStatus ===
              "success" &&
              selectedWord && (
                <DictionaryCard
                  result={
                    selectedWord
                  }
                  isSaved={
                    saved
                  }
                  isSaving={
                    saving
                  }
                  isSynced={
                    synced
                  }
                  onSave={
                    saveSelectedWord
                  }
                  syncMessage={
                    syncMessage
                  }
                />
              )}
          </section>
        </aside>
      </div>
    </div>
  );
}