const fs = require('fs');
let content = fs.readFileSync('D:\\projects\\deep-read\\src\\index.css', 'utf8');

// Exact strings from the file (as seen above)
const overlayExtendExact = '.password-modal-overlay {\\r\\n  @extend .delete-modal-overlay;\\r\\n}';
const modalExtendExact = '.password-modal {\\r\\n  @extend .delete-modal;\\r\\n  /* Override icon background to neutral */\\r\\n}';

// Replacement strings
const overlayStyles = '.password-modal-overlay {\\r\\n  position: fixed;\\r\\n  inset: 0;\\r\\n  z-index: 1000;\\r\\n\\r\\n  display: flex;\\r\\n  align-items: center;\\r\\n  justify-content: center;\\r\\n\\r\\n  padding: 20px;\\r\\n\\r\\n  background: rgba(15, 23, 42, 0.45);\\r\\n\\r\\n  backdrop-filter: blur(3px);\\r\\n}';

const modalStyles = '.password-modal {\\r\\n  position: relative;\\r\\n\\r\\n  width: min(420px, 100%);\\r\\n\\r\\n  padding: 28px;\\r\\n\\r\\n  background: #fff;\\r\\n  border-radius: 16px;\\r\\n\\r\\n  box-shadow:\\r\\n    0 20px 50px rgba(15, 23, 42, 0.18),\\r\\n    0 4px 12px rgba(15, 23, 42, 0.08);\\r\\n\\r\\n  text-align: center;\\r\\n\\r\\n  animation: deleteModalIn 0.18s ease-out;\\r\\n}';

let changed = false;

if (content.includes(overlayExtendExact)) {
  content = content.replace(overlayExtendExact, overlayStyles);
  changed = true;
  console.log('Replaced .password-modal-overlay @extend');
}

if (content.includes(modalExtendExact)) {
  content = content.replace(modalExtendExact, modalStyles);
  changed = true;
  console.log('Replaced .password-modal @extend');
}

if (changed) {
  fs.writeFileSync('D:\\projects\\deep-read\\src\\index.css', content, 'utf8');
  console.log('Successfully updated index.css');
} else {
  console.log('No changes made - exact strings not found');
  // Let's try to see what is actually there
  const lines = content.split('\\r\\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('.password-modal-overlay')) {
      console.log('Line', i, ':', lines[i]);
      if (i+1 < lines.length) console.log('Next line:', lines[i+1]);
      if (i+2 < lines.length) console.log('Line after:', lines[i+2]);
    }
    if (lines[i].includes('.password-modal')) {
      console.log('Line', i, ':', lines[i]);
      if (i+1 < lines.length) console.log('Next line:', lines[i+1]);
      if (i+2 < lines.length) console.log('Line after:', lines[i+2]);
    }
  }
}