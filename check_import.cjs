const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check the import section
const idx = content.indexOf('import Reader from');
console.log('Import Reader index:', idx);
if (idx >= 0) {
    console.log('Context:');
    console.log(content.substring(idx, idx + 300));
}