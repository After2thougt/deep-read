const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find the exact state declarations
const analyzingIdx = content.indexOf('const [analyzing, setAnalyzing]');
console.log('analyzingIdx:', analyzingIdx);
if (analyzingIdx >= 0) {
    console.log('Context:');
    console.log(content.substring(analyzingIdx, analyzingIdx + 300));
}