const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check state marker
const stateMarker = `const [analyzing, setAnalyzing] =
    useState(false);

  const [fontSize, setFontSize] =`;
console.log('State marker found:', content.includes(stateMarker));

// Check handleClearStudyResults
const idx = content.indexOf('async function handleClearStudyResults()');
console.log('handleClearStudyResults index:', idx);
if (idx >= 0) {
    console.log('Context:');
    console.log(content.substring(idx, idx + 200));
}