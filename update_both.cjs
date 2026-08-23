const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find function boundaries
function findFunctionEnd(content, startIdx) {
    let braceCount = 0;
    let inFunction = false;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            inFunction = true;
        } else if (content[i] === '}') {
            braceCount--;
            if (inFunction && braceCount === 0) {
                return i + 1;
            }
        }
    }
    return -1;
}

// Get exact old functions
const translateIdx = content.indexOf('async function handleTranslate()');
const translateEnd = findFunctionEnd(content, translateIdx);
const oldHandleTranslate = content.substring(translateIdx, translateEnd);

const analyzeIdx = content.indexOf('async function handleAnalyze()');
const analyzeEnd = findFunctionEnd(content, analyzeIdx);
const oldHandleAnalyze = content.substring(analyzeIdx, analyzeEnd);

console.log('Found handleTranslate, length:', oldHandleTranslate.length);
console.log('Found handleAnalyze, length:', oldHandleAnalyze.length);

// New handleTranslate with AbortController
const newHandleTranslate = `async function handleTranslate() {
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
  }`;

// New handleAnalyze with AbortController
const newHandleAnalyze = `async function handleAnalyze() {
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
    const requestId = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;

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
  }`;

// Replace
let newContent = content;
if (newContent.includes(oldHandleTranslate)) {
    newContent = newContent.replace(oldHandleTranslate, newHandleTranslate);
    console.log('Replaced handleTranslate');
} else {
    console.log('ERROR: oldHandleTranslate not found in content');
}

if (newContent.includes(oldHandleAnalyze)) {
    newContent = newContent.replace(oldHandleAnalyze, newHandleAnalyze);
    console.log('Replaced handleAnalyze');
} else {
    console.log('ERROR: oldHandleAnalyze not found in content');
}

fs.writeFileSync(path, newContent);
console.log('Done updating both functions');