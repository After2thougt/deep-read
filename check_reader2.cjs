const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// Check exact context for each
const idx1 = content.indexOf('const [showFontControl, setShowFontControl]');
console.log('showFontControl context:');
console.log(JSON.stringify(content.substring(idx1, idx1 + 150)));

const idx2 = content.indexOf('highlights = [],');
console.log('highlights context:');
console.log(JSON.stringify(content.substring(idx2, idx2 + 150)));

const idx3 = content.indexOf('// Load vocabulary');
console.log('loadVocab context:');
console.log(JSON.stringify(content.substring(idx3, idx3 + 200)));