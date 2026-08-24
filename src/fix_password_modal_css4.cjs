const fs = require('fs');
let content = fs.readFileSync('D:\\projects\\deep-read\\src\\index.css', 'utf8');

// First, replace the .password-modal-overlay @extend
const overlayExtend = '.password-modal-overlay {\\r\\n  @extend .delete-modal-overlay;\\r\\n}';
const overlayStyles = '.password-modal-overlay {\\r\\n  position: fixed;\\r\\n  inset: 0;\\r\\n  z-index: 1000;\\r\\n\\r\\n  display: flex;\\r\\n  align-items: center;\\r\\n  justify-content: center;\\r\\n\\r\\n  padding: 20px;\\r\\n\\r\\n  background: rgba(15, 23, 42, 0.45);\\r\\n\\r\\n  backdrop-filter: blur(3px);\\r\\n}';

if (content.includes(overlayExtend)) {
  content = content.replace(overlayExtend, overlayStyles);
  console.log('Replaced .password-modal-overlay @extend');
} else {
  console.log('.password-modal-overlay @extend not found');
}

// Second, replace the .password-modal @extend
const modalExtend = '.password-modal {\\r\\n  @extend .delete-modal;\\r\\n  /* Override icon background to neutral */\\r\\n}';
// We need to copy the .delete-modal styles and then add the icon override
const modalStyles = '.password-modal {\\r\\n  position: relative;\\r\\n\\r\\n  width: min(420px, 100%);\\r\\n\\r\\n  padding: 28px;\\r\\n\\r\\n  background: #fff;\\r\\n  border-radius: 16px;\\r\\n\\r\\n  box-shadow:\\r\\n    0 20px 50px rgba(15, 23, 42, 0.18),\\r\\n    0 4px 12px rgba(15, 23, 42, 0.08);\\r\\n\\r\\n  text-align: center;\\r\\n\\r\\n  animation: deleteModalIn 0.18s ease-out;\\r\\n}';

if (content.includes(modalExtend)) {
  content = content.replace(modalExtend, modalStyles);
  console.log('Replaced .password-modal @extend (keeping icon override comment)');
} else {
  console.log('.password-modal @extend not found');
}

// Now we need to add the icon override inside the .password-modal block.
// Since we replaced the entire .password-modal block, we need to add the icon styles after the closing brace of .password-modal? 
// Actually, we replaced the whole block, so we need to include the icon styles inside the block.
// But we didn't. Let's adjust: we want to keep the icon override, so we should have included it in the modalStyles.
// However, the icon styles are separate: .password-modal-icon and .password-modal-icon svg.
// Those are already defined below, so we don't need to put them inside .password-modal.
// The comment said "/* Override icon background to neutral */" and then we had the icon styles below.
// So after replacing the .password-modal block, we still have the icon styles below, which is good.
// But we removed the comment. That's okay.

// However, we must ensure that the .password-modal-icon and .password-modal-icon svg are present.
// They are already in the file after the .password-modal block, so we are fine.

// Now write back
fs.writeFileSync('D:\\projects\\deep-read\\src\\index.css', content, 'utf8');
console.log('Done');