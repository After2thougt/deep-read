const fs = require('fs');
const path = 'D:/Projects/deep-read/src/pages/ReaderPage.jsx';

let content = fs.readFileSync(path, 'utf8');

// The exact pattern with correct whitespace (using \r\n)
const refInsertMarker = `  const activeAnalysisRequestId =\r\n    useRef(null);\r\n\r\n  const readerPageRef =`;

const refInsertReplacement = `  const activeAnalysisRequestId =\r\n    useRef(null);\r\n\r\n  const analysisAbortControllerRef =\r\n    useRef(null);\r\n\r\n  const translationAbortControllerRef =\r\n    useRef(null);\r\n\r\n  const readerPageRef =`;

if (content.includes(refInsertMarker)) {
    content = content.replace(refInsertMarker, refInsertReplacement);
    fs.writeFileSync(path, content);
    console.log('Added AbortController refs successfully');
} else {
    console.log('Marker not found!');
}