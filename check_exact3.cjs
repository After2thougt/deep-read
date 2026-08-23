const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check loadVocabMarker - find the exact pattern
const idx = content.indexOf('localStorage.setItem');
console.log('First localStorage.setItem:');
console.log(JSON.stringify(content.substring(idx, idx + 300)));

// Check all occurrences
let pos = content.indexOf('localStorage.setItem("reader-font-size"');
while (pos >= 0) {
    console.log('Found at:', pos);
    console.log(JSON.stringify(content.substring(pos, pos + 300)));
    pos = content.indexOf('localStorage.setItem("reader-font-size"', pos + 1);
}

// Check saveSelectedWordMarker exact
const idx2 = content.indexOf('await saveVocabulary({');
console.log('saveVocabulary context:');
console.log(JSON.stringify(content.substring(idx2, idx2 + 400)));