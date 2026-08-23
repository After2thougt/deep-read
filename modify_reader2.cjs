const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// 1. Remove savedWords state from Reader - exact match
const savedWordsStateMarker = `const [showFontControl, setShowFontControl] = useState(false);
  const [savedWords, setSavedWords] = useState([]);


  const [`;

const savedWordsStateReplacement = `const [showFontControl, setShowFontControl] = useState(false);


  const [`;

if (content.includes(savedWordsStateMarker)) {
    content = content.replace(savedWordsStateMarker, savedWordsStateReplacement);
    console.log('Removed savedWords state from Reader');
} else {
    console.log('ERROR: Could not find savedWordsStateMarker');
}

// 2. Add savedWords to the component props - exact match
const propsMarker = `highlights = [],
  onSelectWord,
  onSaveUnderline,`;

const propsReplacement = `highlights = [],
  savedWords = [],
  onSelectWord,
  onSaveUnderline,`;

if (content.includes(propsMarker)) {
    content = content.replace(propsMarker, propsReplacement);
    console.log('Added savedWords to Reader props');
} else {
    console.log('ERROR: Could not find propsMarker');
}

// 3. Remove the loadVocabulary useEffect - exact match
const loadVocabEffectMarker = `// Load vocabulary
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

if (content.includes(loadVocabEffectMarker)) {
    content = content.replace(loadVocabEffectMarker, '');
    console.log('Removed loadVocabulary effect from Reader');
} else {
    console.log('ERROR: Could not find loadVocabEffectMarker');
}

fs.writeFileSync(path, content);
console.log('Done');