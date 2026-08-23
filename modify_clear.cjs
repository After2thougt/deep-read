const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// 1. Add ConfirmModal import after Reader import
const oldImport = `import Reader from "../components/Reader";`;
const newImport = `import Reader from "../components/Reader";
import ConfirmModal from "../components/ConfirmModal";`;

if (content.includes(oldImport)) {
    content = content.replace(oldImport, newImport);
    console.log('Added ConfirmModal import');
} else {
    console.log('ERROR: Could not find Reader import');
}

// 2. Add state for confirmation modal after other state declarations
// Find the last useState before the handleClearStudyResults function
const stateInsertMarker = `const [analyzing, setAnalyzing] =
    useState(false);

  const [fontSize, setFontSize] =`;
const stateInsertReplacement = `const [analyzing, setAnalyzing] =
    useState(false);

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const [fontSize, setFontSize] =`;

if (content.includes(stateInsertMarker)) {
    content = content.replace(stateInsertMarker, stateInsertReplacement);
    console.log('Added clearConfirmOpen state');
} else {
    console.log('ERROR: Could not find state insert marker');
}

// 3. Refactor handleClearStudyResults - rename to executeClearStudyResults and create new handleClearStudyResults that opens modal
const oldHandleClear = `async function handleClearStudyResults() {
    if (
      !window.confirm(
        "Clear Study Results?\\n\\nThis deletes the cached AI analysis for this saved article. The next analysis will call AI again."
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
    }
  }`;

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

if (content.includes(oldHandleClear)) {
    content = content.replace(oldHandleClear, newHandleClear);
    console.log('Refactored handleClearStudyResults');
} else {
    console.log('ERROR: Could not find old handleClearStudyResults');
}

// 4. Update StudyResults onClear to use handleClearStudyResults (which now opens modal)
// This should already work since we're passing handleClearStudyResults as onClear

// 5. Add ConfirmModal to JSX - find the return statement area
// We'll add it near the end of the component, before the closing div
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