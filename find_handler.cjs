const fs = require('fs');
const content = fs.readFileSync('D:/Projects/deep-read/backend/server.js', 'utf8');

// Find the start and end of the from-url handler
const startMarker = "POST /api/articles/images/from-url";
const startIdx = content.indexOf(startMarker);
if (startIdx === -1) {
  console.log('Start marker not found');
  process.exit(1);
}

// Find the end - look for the next app. route or the closing });
// The handler ends with }); followed by blank line then app.get or similar
let endMarker = '});\n\napp.get';
let endIdx = content.indexOf(endMarker, startIdx);
if (endIdx === -1) {
  // Try alternative
  endMarker = '});\n\n';
  endIdx = content.indexOf(endMarker, startIdx);
}
if (endIdx === -1) {
  console.log('End marker not found');
  process.exit(1);
}
endIdx += endMarker.length;

console.log('Found at:', startIdx, 'to', endIdx);
console.log('---SNIPPET---');
console.log(content.substring(startIdx, endIdx));

// Also save the exact snippet to a file for reference
fs.writeFileSync('D:/Projects/deep-read/old_handler.txt', content.substring(startIdx, endIdx));
console.log('Saved to old_handler.txt');