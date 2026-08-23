const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// 2. Add loadVocabulary effect after fontSize effect - exact match
const loadVocabMarker = `localStorage.setItem(\r\n    "reader-font-size",\r\n    String(fontSize)\r\n  );\r\n}, [fontSize]);\r\n\r\n\r\nfunction increaseFont() {`;

const loadVocabReplacement = `localStorage.setItem(\r\n    "reader-font-size",\r\n    String(fontSize)\r\n  );\r\n}, [fontSize]);\r\n\r\n// Load vocabulary\r\nuseEffect(() => {\r\n  async function loadVocabulary() {\r\n    try {\r\n      const res = await fetch("/api/vocabulary?limit=10000");\r\n      const data = await res.json();\r\n      setSavedWords(data.items.map((item) => item.word.toLowerCase()));\r\n    } catch (e) {\r\n      console.error(e);\r\n    }\r\n  }\r\n  loadVocabulary();\r\n}, []);\r\n\r\n\r\nfunction increaseFont() {`;

if (content.includes(loadVocabMarker)) {
    content = content.replace(loadVocabMarker, loadVocabReplacement);
    console.log('Added loadVocabulary effect');
} else {
    console.log('ERROR: Could not find loadVocabMarker');
}

// 3. Update saveSelectedWord to also update savedWords state - exact match
const saveSelectedWordMarker = `await saveVocabulary({\r\n        ...selectedWord,\r\n        articleId:\r\n          articleId || null,\r\n      });\r\n\r\n      setSaved(true);`;

const saveSelectedWordReplacement = `await saveVocabulary({\r\n        ...selectedWord,\r\n        articleId:\r\n          articleId || null,\r\n      });\r\n\r\n      // Immediately update savedWords for instant highlight update\r\n      setSavedWords(prev => {\r        const word = selectedWord.word.toLowerCase();\r        if (!prev.includes(word)) {\r          return [...prev, word];\r        }\r        return prev;\r      });\r\n\r\n      setSaved(true);`;

if (content.includes(saveSelectedWordMarker)) {
    content = content.replace(saveSelectedWordMarker, saveSelectedWordReplacement);
    console.log('Updated saveSelectedWord');
} else {
    console.log('ERROR: Could not find saveSelectedWordMarker');
}

fs.writeFileSync(path, content);
console.log('Done');