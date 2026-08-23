const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check exact formatting
const idx1 = content.indexOf('savedWords, setSavedWords');
console.log('savedWords state context:');
console.log(JSON.stringify(content.substring(idx1 - 100, idx1 + 100)));

const idx2 = content.indexOf('export default function Reader({');
console.log('props context:');
console.log(JSON.stringify(content.substring(idx2, idx2 + 400)));

const idx3 = content.indexOf('// Load vocabulary');
console.log('loadVocab context:');
console.log(JSON.stringify(content.substring(idx3, idx3 + 300)));