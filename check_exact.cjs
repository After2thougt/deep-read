const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check exact whitespace around analyzing state
const idx = content.indexOf('const [analyzing, setAnalyzing]');
console.log('Context with exact chars:');
console.log(JSON.stringify(content.substring(idx, idx + 200)));