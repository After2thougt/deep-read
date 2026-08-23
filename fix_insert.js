const fs = require('fs');
let content = fs.readFileSync('D:\\Projects\\deep-read\\src\\components\\Reader.jsx', 'utf8');

const idx = content.indexOf('const highlights = [');
console.log('Found at:', idx);

if (idx >= 0) {
  let braceCount = 0;
  let inBracket = false;
  let endIdx = -1;
  
  for (let i = idx; i < content.length; i++) {
    const c = content[i];
    if (c === '[') { inBracket = true; braceCount++; }
    else if (c === ']') {
      braceCount--;
      if (braceCount === 0 && inBracket) {
        for (let j = i + 1; j < content.length; j++) {
          if (content[j] === ';') { endIdx = j + 1; break; }
        }
        break;
      }
    }
  }
  
  if (endIdx > 0) {
    console.log('End of highlights at:', endIdx);
    console.log('Context:', content.substring(endIdx - 20, endIdx + 50));
    
    const insertCode = "\n\n  // Missing variable definitions\n  const paragraphAbsoluteStart = blockStart + paragraph.start;\n  const paragraphAbsoluteEnd = blockStart + paragraph.start + paragraph.text.length;\n  const paragraphText = paragraph.text;\n  const baseKey = '" + "${keyPrefix}-${paragraph.start}" + "';\n\n  // Find highlights that overlap with this paragraph\n  const overlappingHighlights = highlights\n    .filter((hl) => hl.end > paragraphAbsoluteStart && hl.start < paragraphAbsoluteEnd)\n    .map((hl) => ({\n      ...hl,\n      start: Math.max(hl.start, paragraphAbsoluteStart),\n      end: Math.min(hl.end, paragraphAbsoluteEnd),\n    }))\n    .sort((a, b) => a.start - b.start);";
  
  content = content.substring(0, endIdx) + insertCode + content.substring(endIdx);
  console.log('Inserted missing variables');
  fs.writeFileSync('D:\\Projects\\deep-read\\src\\components\\Reader.jsx', content);
} else {
  console.log('Could not find end of highlights');
}