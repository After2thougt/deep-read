const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check for handleClearStudyResults (the new one that opens modal)
const idx = content.indexOf('function handleClearStudyResults()');
console.log('handleClearStudyResults (new) index:', idx);
if (idx >= 0) {
    console.log('Context:');
    console.log(content.substring(idx, idx + 200));
}

// Check state
const stateIdx = content.indexOf('const [clearConfirmOpen');
console.log('clearConfirmOpen state index:', stateIdx);

// Check modal in JSX
const modalIdx = content.indexOf('clearConfirmOpen && (');
console.log('Modal JSX index:', modalIdx);

// Check import
const importIdx = content.indexOf('import ConfirmModal');
console.log('ConfirmModal import index:', importIdx);