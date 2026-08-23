const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Update handleTranslate function
const oldHandleTranslate = `async function handleTranslate() {
    if (translations) {
      setTranslationCollapsed(
        false
      );

      return;
    }

    if (!article.trim()) {
      return;
    }

    const requestGeneration =
      ++translationRequestGeneration.current;

    const requestedPage =
      currentPage;

    setTranslating(true);
    setTranslateError("");

    try {
      const result =
        await translateArticle(
          pageContent,
          "zh",
          {
            articleId,
            pageNumber:
              requestedPage,
          }
        );

      if (
        translationRequestGeneration.current ===
          requestGeneration &&
        currentPage ===
          requestedPage
      ) {
        setTranslations(
          Array.isArray(
            result?.paragraphs
          )
            ? result.paragraphs
            : []
        );

        setTranslationCollapsed(
          false
        );
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
  }`;

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

if (content.includes(oldHandleTranslate)) {
    content = content.replace(oldHandleTranslate, newHandleTranslate);
    console.log('Updated handleTranslate successfully');
} else {
    console.log('Old handleTranslate not found - trying alternative');
    // Try with slightly different formatting
    const altOldHandleTranslate = `async function handleTranslate() {
    if (translations) {
      setTranslationCollapsed(
        false
      );

      return;
    }

    if (!article.trim()) {
      return;
    }

    const requestGeneration =
      ++translationRequestGeneration.current;

    const requestedPage =
      currentPage;

    setTranslating(true);
    setTranslateError("");

    try {
      const result =
        await translateArticle(
          pageContent,
          "zh",
          {
            articleId,
            pageNumber:
              requestedPage,
          }
        );

      if (
        translationRequestGeneration.current ===
          requestGeneration &&
        currentPage ===
          requestedPage
      ) {
        setTranslations(
          Array.isArray(
            result?.paragraphs
          )
            ? result.paragraphs
            : []
        );

        setTranslationCollapsed(
          false
        );
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
  }`;
    if (content.includes(altOldHandleTranslate)) {
        content = content.replace(altOldHandleTranslate, newHandleTranslate);
        console.log('Updated handleTranslate successfully (alt format)');
    } else {
        console.log('ERROR: Could not find old handleTranslate in either format');
    }
}

fs.writeFileSync(path, content);
console.log('Done updating handleTranslate');