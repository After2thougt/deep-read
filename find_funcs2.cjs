const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

const idx = content.indexOf('async function handleTranslate()');
console.log('handleTranslate index:', idx);
if (idx >= 0) {
    console.log('Full handleTranslate function:');
    console.log(content.substring(idx, idx + 800));
}

const idx2 = content.indexOf('async function handleAnalyze()');
console.log('\nhandleAnalyze index:', idx2);
if (idx2 >= 0) {
    console.log('Full handleAnalyze function:');
    console.log(content.substring(idx2, idx2 + 800));
}