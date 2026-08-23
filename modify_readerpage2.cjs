const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// 1. Add savedWords state after translationCollapsed state
const stateInsertMarker = `studyResultsCollapsed,\r\n    setStudyResultsCollapsed,\r\n  ] = useState(false);\r\n\r\n  const [\r\n    translationCollapsed,\r\n    setTranslationCollapsed,\r\n  ] = useState(false);\r\n\r\n  const [currentPage, setCurrentPage] =`;

const stateInsertReplacement = `studyResultsCollapsed,\r\n    setStudyResultsCollapsed,\r\n  ] = useState(false);\r\n\r\n  const [\r\n    translationCollapsed,\r\n    setTranslationCollapsed,\r\n  ] = useState(false);\r\n\r\n  const [savedWords, setSavedWords] = useState([]);\r\n\r\n  const [currentPage, setCurrentPage] =`;

if (content.includes(stateInsertMarker)) {
    content = content.replace(stateInsertMarker, stateInsertReplacement);
    console.log('Added savedWords state');
} else {
    console.log('ERROR: Could not find state insert marker');
}

// 2. Add loadVocabulary effect after fontSize effect
const loadVocabMarker = `localStorage.setItem(\r\n    "reader-font-size",\r\n    String(fontSize)\r\n  );\r\n}, [fontSize]);\r\n\r\nfunction increaseFont() {`;

const loadVocabReplacement = `localStorage.setItem(\r\n    "reader-font-size",\r\n    String(fontSize)\r\n  );\r\n}, [fontSize]);\r\n\r\n// Load vocabulary\r\nuseEffect(() => {\r\n  async function loadVocabulary() {\r\n    try {\r\n      const res = await fetch("/api/vocabulary?limit=10000");\r\n      const data = await res.json();\r\n      setSavedWords(data.items.map((item) => item.word.toLowerCase()));\r\n    } catch (e) {\r\n      console.error(e);\r\n    }\r\n  }\r\n  loadVocabulary();\r\n}, []);\r\n\r\nfunction increaseFont() {`;

if (content.includes(loadVocabMarker)) {
    content = content.replace(loadVocabMarker, loadVocabReplacement);
    console.log('Added loadVocabulary effect');
} else {
    console.log('ERROR: Could not find loadVocabMarker');
}

// 3. Update saveSelectedWord to also update savedWords state
const saveSelectedWordMarker = `await saveVocabulary({\r\n        ...selectedWord,\r\n        articleId:\r          articleId || null,\r\n      });\r\n\r\n      setSaved(true);`;

const saveSelectedWordReplacement = `await saveVocabulary({\r\n        ...selectedWord,\r\n        articleId:\r          articleId || null,\r\n      });\r\n\r      // Immediately update savedWords for instant highlight update\r      setSavedWords(prev => {\r        const word = selectedWord.word.toLowerCase();\r        if (!prev.includes(word)) {\r          return [...prev, word];\r        }\r        return prev;\r      });\r\n      setSaved(true);`;

if (content.includes(saveSelectedWordMarker)) {
    content = content.replace(saveSelectedWordMarker, saveSelectedWordReplacement);
    console.log('Updated saveSelectedWord');
} else {
    console.log('ERROR: Could not find saveSelectedWordMarker');
}

// 4. Pass savedWords to Reader component
const readerPropsMarker = `highlights={highlights}\r\n            onSelectWord={`;

const readerPropsReplacement = `highlights={highlights}\r\n            savedWords={savedWords}\r\n            onSelectWord={`;

if (content.includes(readerPropsMarker)) {
    content = content.replace(readerPropsMarker, readerPropsReplacement);
    console.log('Added savedWords to Reader props');
} else {
    console.log('ERROR: Could not find readerPropsMarker');
}

fs.writeFileSync(path, content);
console.log('Done');