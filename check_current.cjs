const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check if handleClearStudyResults exists
const idx = content.indexOf('async function handleClearStudyResults()');
console.log('handleClearStudyResults index:', idx);
if (idx >= 0) {
    console.log('Context:');
    console.log(content.substring(idx, idx + 300));
}

// Check for executeClearStudyResults
const idx2 = content.indexOf('async function executeClearStudyResults()');
console.log('executeClearStudyResults index:', idx2);