const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find the exact function boundaries
function findFunctionEnd(content, startIdx) {
    let braceCount = 0;
    let inFunction = false;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            inFunction = true;
        } else if (content[i] === '}') {
            braceCount--;
            if (inFunction && braceCount === 0) {
                return i + 1; // Return index after closing brace
            }
        }
    }
    return -1;
}

// Find handleTranslate
const translateIdx = content.indexOf('async function handleTranslate()');
if (translateIdx >= 0) {
    const endIdx = findFunctionEnd(content, translateIdx);
    if (endIdx > 0) {
        const oldFunc = content.substring(translateIdx, endIdx);
        console.log('handleTranslate length:', oldFunc.length);
        console.log('First 200 chars:', oldFunc.substring(0, 200));
        console.log('Last 200 chars:', oldFunc.substring(oldFunc.length - 200));
    }
}

const analyzeIdx = content.indexOf('async function handleAnalyze()');
if (analyzeIdx >= 0) {
    const endIdx = findFunctionEnd(content, analyzeIdx);
    if (endIdx > 0) {
        const oldFunc = content.substring(analyzeIdx, endIdx);
        console.log('\nhandleAnalyze length:', oldFunc.length);
        console.log('First 200 chars:', oldFunc.substring(0, 200));
        console.log('Last 200 chars:', oldFunc.substring(oldFunc.length - 200));
    }
}