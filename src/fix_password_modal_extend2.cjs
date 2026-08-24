const fs = require('fs');
let content = fs.readFileSync('D:\\projects\\deep-read\\src\\index.css', 'utf8');
let lines = content.split('\\r\\n');

// Function to replace a block given the start line index and the expected pattern
function replaceBlock(startLine, endLine, replacement) {
  // We'll replace lines from startLine to endLine inclusive with the replacement lines
  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine + 1);
  lines = before.concat(replacement.split('\\r\\n')).concat(after);
}

// Find .password-modal-overlay block
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '.password-modal-overlay {') {
    // Find the next line that contains '@extend'
    let j = i + 1;
    while (j < lines.length && !lines[j].includes('@extend')) {
      j++;
    }
    if (j < lines.length) {
      // Find the closing brace after that
      let k = j;
      while (k < lines.length && !lines[k].trim().endsWith('}')) {
        k++;
      }
      if (k < lines.length) {
        // Replace from i to k with overlayStyles
        const overlayStyles = [
          '.password-modal-overlay {',
          '  position: fixed;',
          '  inset: 0;',
          '  z-index: 1000;',
          '',
          '  display: flex;',
          '  align-items: center;',
          '  justify-content: center;',
          '',
          '  padding: 20px;',
          '',
          '  background: rgba(15, 23, 42, 0.45);',
          '',
          '  backdrop-filter: blur(3px);',
          '}'
        ];
        replaceBlock(i, k, overlayStyles.join('\\r\\n'));
        console.log('Replaced .password-modal-overlay block');
        break; // assuming only one
      }
    }
  }
}

// Find .password-modal block
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '.password-modal {') {
    // Find the next line that contains '@extend'
    let j = i + 1;
    while (j < lines.length && !lines[j].includes('@extend')) {
      j++;
    }
    if (j < lines.length) {
      // Find the closing brace after that
      let k = j;
      while (k < lines.length && !lines[k].trim().endsWith('}')) {
        k++;
      }
      if (k < lines.length) {
        // Replace from i to k with modalStyles
        const modalStyles = [
          '.password-modal {',
          '  position: relative;',
          '',
          '  width: min(420px, 100%);',
          '',
          '  padding: 28px;',
          '',
          '  background: #fff;',
          '  border-radius: 16px;',
          '',
          '  box-shadow:',
          '    0 20px 50px rgba(15, 23, 42, 0.18),',
          '    0 4px 12px rgba(15, 23, 42, 0.08);',
          '',
          '  text-align: center;',
          '',
          '  animation: deleteModalIn 0.18s ease-out;',
          '}'
        ];
        replaceBlock(i, k, modalStyles.join('\\r\\n'));
        console.log('Replaced .password-modal block');
        break; // assuming only one
      }
    }
  }
}

content = lines.join('\\r\\n');
fs.writeFileSync('D:\\projects\\deep-read\\src\\index.css', content, 'utf8');
console.log('Done');