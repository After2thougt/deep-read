const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find handleTranslate function using regex
const translateRegex = /async function handleTranslate\(\) \{[\s\S]*?^\s{2}\}/m;
const match = content.match(translateRegex);

if (match) {
    console.log('Found handleTranslate:');
    console.log(match[0].substring(0, 500));
    console.log('---');
} else {
    console.log('handleTranslate not found with regex');
}

// Try different regex
const translateRegex2 = /async function handleTranslate\(\) \{[\s\S]*?\n  \}/;
const match2 = content.match(translateRegex2);
if (match2) {
    console.log('Found handleTranslate with regex2:');
    console.log(match2[0].substring(0, 500));
} else {
    console.log('Not found with regex2 either');
}

console.log('\n---Trying handleAnalyze---');
const analyzeRegex = /async function handleAnalyze\(\) \{[\s\S]*?^\s{2}\}/m;
const match3 = content.match(analyzeRegex);
if (match3) {
    console.log('Found handleAnalyze:');
    console.log(match3[0].substring(0, 500));
} else {
    console.log('handleAnalyze not found with regex');
}