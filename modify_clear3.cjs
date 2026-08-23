const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// 2. Add state for confirmation modal - use CRLF line endings
const stateInsertMarker = `const [analyzing, setAnalyzing] =\r\n    useState(false);\r\n\r\n  const [fontSize, setFontSize] =`;
const stateInsertReplacement = `const [analyzing, setAnalyzing] =\r\n    useState(false);\r\n\r\n  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);\r\n\r\n  const [fontSize, setFontSize] =`;

if (content.includes(stateInsertMarker)) {
    content = content.replace(stateInsertMarker, stateInsertReplacement);
    console.log('Added clearConfirmOpen state');
} else {
    console.log('ERROR: Could not find state insert marker');
}

// 3. Refactor handleClearStudyResults - get exact content
const oldHandleClearIdx = content.indexOf('async function handleClearStudyResults()');
if (oldHandleClearIdx >= 0) {
    // Find the end of this function
    let braceCount = 0;
    let inFunction = false;
    let endIdx = -1;
    for (let i = oldHandleClearIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            inFunction = true;
        } else if (content[i] === '}') {
            braceCount--;
            if (inFunction && braceCount === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }
    
    if (endIdx > 0) {
        const oldHandleClear = content.substring(oldHandleClearIdx, endIdx);
        console.log('Found handleClearStudyResults, length:', oldHandleClear.length);
        
        const newHandleClear = `async function executeClearStudyResults() {
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
  }`;

        content = content.substring(0, oldHandleClearIdx) + newHandleClear + content.substring(endIdx);
        console.log('Refactored handleClearStudyResults');
    } else {
        console.log('ERROR: Could not find end of handleClearStudyResults');
    }
} else {
    console.log('ERROR: Could not find handleClearStudyResults');
}

// 4. Add ConfirmModal to JSX - find the saveMessage toast area
const modalInsertMarker = `{saveMessage && (`;
const modalInsertReplacement = `{clearConfirmOpen && (
      <ConfirmModal
        open={clearConfirmOpen}
        title="Clear Study Results?"
        message="Are you sure you want to clear the study results? This action cannot be undone."
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={executeClearStudyResults}
        confirmText="Clear"
      />
    )}

    {saveMessage && (`;

if (content.includes(modalInsertMarker)) {
    content = content.replace(modalInsertMarker, modalInsertReplacement);
    console.log('Added ConfirmModal to JSX');
} else {
    console.log('ERROR: Could not find modal insert marker');
}

fs.writeFileSync(path, content);
console.log('Done');