const fs = require('fs');
let content = fs.readFileSync('D:\\projects\\deep-read\\src\\index.css', 'utf8');

// Exact three-line block for .password-modal-overlay as seen in the file
const overlayBlock = '.password-modal-overlay {\\r\\n  @extend .delete-modal-overlay;\\r\\n}';
// Exact three-line block for .password-modal
const modalBlock = '.password-modal {\\r\\n  @extend .delete-modal;\\r\\n  /* Override icon background to neutral */\\r\\n}';

// Replacement strings
const overlayStyles = '.password-modal-overlay {\\r\\n  position: fixed;\\r\\n  inset: 0;\\r\\n  z-index: 1000;\\r\\n\\r\\n  display: flex;\\r\\n  align-items: center;\\r\\n  justify-content: center;\\r\\n\\r\\n  padding: 20px;\\r\\n\\r\\n  background: rgba(15, 23, 42, 0.45);\\r\\n\\r\\n  backdrop-filter: blur(3px);\\r\\n}';
const modalStyles = '.password-modal {\\r\\n  position: relative;\\r\\n\\r\\n  width: min(420px, 100%);\\r\\n\\r\\n  padding: 28px;\\r\\n\\r\\n  background: #fff;\\r\\n  border-radius: 16px;\\r\\n\\r\\n  box-shadow:\\r\\n    0 20px 50px rgba(15, 23, 42, 0.18),\\r\\n    0 4px 12px rgba(15, 23, 42, 0.08);\\r\\n\\r\\n  text-align: center;\\r\\n\\r\\n  animation: deleteModalIn 0.18s ease-out;\\r\\n}';

let changed = false;

if (content.includes(overlayBlock)) {
  content = content.replace(overlayBlock, overlayStyles);
  changed = true;
  console.log('Replaced .password-modal-overlay three-line block');
}

if (content.includes(modalBlock)) {
  content = content.replace(modalBlock, modalStyles);
  changed = true;
  console.log('Replaced .password-modal three-line block');
}

if (changed) {
  fs.writeFileSync('D:\\projects\\deep-read\\src\\index.css', content, 'utf8');
  console.log('Successfully updated index.css');
} else {
  console.log('No changes made - blocks not found');
  // Let's try to see what is actually there by looking for the lines with @extend
  const lines = content.split('\\r\\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('@extend')) {
      console.log('Line', i, ':', lines[i]);
      // Show surrounding lines
      if (i-1 >= 0) console.log('  before:', lines[i-1]);
      if (i+1 < lines.length) console.log('  after:', lines[i+1]);
    }
  }
}