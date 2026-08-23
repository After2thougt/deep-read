const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find the exact location where the function should end
const idx = content.indexOf('return <>{pieces}</>;');
console.log('Found at:', idx);
if (idx >= 0) {
    console.log('Context:');
    console.log(JSON.stringify(content.substring(idx, idx + 100)));
}