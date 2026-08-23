const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// 1. Add savedWords state after other states (after line with studyResultsCollapsed)
const stateInsertMarker = `const [
    studyResultsCollapsed,
    setStudyResultsCollapsed,
  ] = useState(false);

  const [
    translationCollapsed,
    setTranslationCollapsed,
  ] = useState(false);`;

const stateInsertReplacement = `const [
    studyResultsCollapsed,
    setStudyResultsCollapsed,
  ] = useState(false);

  const [
    translationCollapsed,
    setTranslationCollapsed,
  ] = useState(false);

  const [savedWords, setSavedWords] = useState([]);`;

if (content.includes(stateInsertMarker)) {
    content = content.replace(stateInsertMarker, stateInsertReplacement);
    console.log('Added savedWords state');
} else {
    console.log('ERROR: Could not find state insert marker');
}

// 2. Add loadVocabulary effect after the fontSize effect (around line 940-950)
const loadVocabMarker = `useEffect(() => {
  localStorage.setItem(
    "reader-font-size",
    String(fontSize)
  );
}, [fontSize]);`;

const loadVocabReplacement = `useEffect(() => {
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
}, []);`;

if (content.includes(loadVocabMarker)) {
    content = content.replace(loadVocabMarker, loadVocabReplacement);
    console.log('Added loadVocabulary effect');
} else {
    console.log('ERROR: Could not find loadVocabMarker');
}

// 3. Update saveSelectedWord to also update savedWords state
const saveSelectedWordMarker = `async function saveSelectedWord() {
    setSaving(true);
    setSyncMessage("");

    try {
      await saveVocabulary({
        ...selectedWord,
        articleId:
          articleId || null,
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
  }`;

const saveSelectedWordReplacement = `async function saveSelectedWord() {
    setSaving(true);
    setSyncMessage("");

    try {
      await saveVocabulary({
        ...selectedWord,
        articleId:
          articleId || null,
      });

      // Immediately update savedWords for instant highlight update
      setSavedWords(prev => {
        const word = selectedWord.word.toLowerCase();
        if (!prev.includes(word)) {
          return [...prev, word];
        }
        return prev;
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
  }`;

if (content.includes(saveSelectedWordMarker)) {
    content = content.replace(saveSelectedWordMarker, saveSelectedWordReplacement);
    console.log('Updated saveSelectedWord');
} else {
    console.log('ERROR: Could not find saveSelectedWordMarker');
}

// 4. Pass savedWords to Reader component
const readerPropsMarker = `            <Reader
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
            translating={`;

const readerPropsReplacement = `            <Reader
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
            translating={`;

if (content.includes(readerPropsMarker)) {
    content = content.replace(readerPropsMarker, readerPropsReplacement);
    console.log('Added savedWords to Reader props');
} else {
    console.log('ERROR: Could not find readerPropsMarker');
}

fs.writeFileSync(path, content);
console.log('Done');