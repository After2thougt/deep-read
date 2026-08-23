const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

const idx = content.indexOf('async function handleTranslate()');
console.log('Full handleTranslate function:');
console.log(content.substring(idx, idx + 1200));

const idx2 = content.indexOf('async function handleAnalyze()');
console.log('\n\nFull handleAnalyze function:');
console.log(content.substring(idx2, idx2 + 1200));