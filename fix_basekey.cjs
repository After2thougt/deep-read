const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find the function and add baseKey definition after paragraphAbsoluteEnd
const oldText = `  const paragraphAbsoluteEnd =
    paragraphAbsoluteStart + paragraphText.length;

  // Build vocabulary highlights from savedWords prop`;

const newText = `  const paragraphAbsoluteEnd =
    paragraphAbsoluteStart + paragraphText.length;

  const baseKey = keyPrefix;

  // Build vocabulary highlights from savedWords prop`;

if (content.includes(oldText)) {
    content = content.replace(oldText, newText);
    console.log('Fixed: added baseKey definition');
} else {
    console.log('ERROR: Could not find pattern');
}

fs.writeFileSync(path, content);
console.log('Done');