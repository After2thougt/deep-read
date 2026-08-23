const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// Count braces
let open = 0;
let close = 0;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') open++;
    if (content[i] === '}') close++;
}

console.log('Open braces:', open);
console.log('Close braces:', close);
console.log('Diff:', open - close);

// Find export default function
const idx = content.indexOf('export default function Reader({');
console.log('Export default at:', idx);

// Find all braces after that
let braceCount = 0;
let inFunction = false;
for (let i = idx; i < content.length; i++) {
    if (content[i] === '{') {
        braceCount++;
        inFunction = true;
    } else if (content[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
            console.log('Function should end at:', i);
            console.log('Context around end:', content.substring(i - 50, i + 50));
            break;
        }
    }
}