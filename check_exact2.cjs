const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check exact formatting of studyResultsCollapsed
const idx1 = content.indexOf('studyResultsCollapsed');
console.log('studyResultsCollapsed context:');
console.log(JSON.stringify(content.substring(idx1, idx1 + 300)));

// Check loadVocabMarker
const idx2 = content.indexOf('localStorage.setItem("reader-font-size"');
console.log('loadVocabMarker context:');
console.log(JSON.stringify(content.substring(idx2, idx2 + 300)));

// Check saveSelectedWord
const idx3 = content.indexOf('async function saveSelectedWord()');
console.log('saveSelectedWord context:');
console.log(JSON.stringify(content.substring(idx3, idx3 + 500)));

// Check readerPropsMarker
const idx4 = content.indexOf('article={pageContent}');
console.log('readerPropsMarker context:');
console.log(JSON.stringify(content.substring(idx4, idx4 + 500)));