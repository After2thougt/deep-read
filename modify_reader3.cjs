const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// 1. Remove savedWords state from Reader - exact match with CRLF
const savedWordsStateMarker = `const [showFontControl, setShowFontControl] = useState(false);\r\n  const [savedWords, setSavedWords] = useState([]);\r\n\r\n\r\n  const [`;

const savedWordsStateReplacement = `const [showFontControl, setShowFontControl] = useState(false);\r\n\r\n\r\n  const [`;

if (content.includes(savedWordsStateMarker)) {
    content = content.replace(savedWordsStateMarker, savedWordsStateReplacement);
    console.log('Removed savedWords state from Reader');
} else {
    console.log('ERROR: Could not find savedWordsStateMarker');
}

// 2. Add savedWords to the component props - exact match
const propsMarker = `highlights = [],\r\n  onSelectWord,\r\n  onSaveUnderline,`;

const propsReplacement = `highlights = [],\r\n  savedWords = [],\r\n  onSelectWord,\r\n  onSaveUnderline,`;

if (content.includes(propsMarker)) {
    content = content.replace(propsMarker, propsReplacement);
    console.log('Added savedWords to Reader props');
} else {
    console.log('ERROR: Could not find propsMarker');
}

// 3. Remove the loadVocabulary useEffect - exact match
const loadVocabEffectMarker = `// Load vocabulary\r\n  useEffect(() => {\r\n    async function loadVocabulary() {\r\n      try {\r\n        const res = await fetch("/api/vocabulary?limit=10000");\r\n        const data = await res.json();\r\n        setSavedWords(data.items.map((item) => item.word.toLowerCase()));\r\n      } catch (e) {\r\n        console.error(e);\r\n      }\r\n    }\r\n    loadVocabulary();\r\n  }, []);`;

if (content.includes(loadVocabEffectMarker)) {
    content = content.replace(loadVocabEffectMarker, '');
    console.log('Removed loadVocabulary effect from Reader');
} else {
    console.log('ERROR: Could not find loadVocabEffectMarker');
}

fs.writeFileSync(path, content);
console.log('Done');