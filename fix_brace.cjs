const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// The file ends with </main>\n  ); but missing the closing } for the component function
// Find the end and add the closing brace
if (content.trimEnd().endsWith(');')) {
    // Add the closing brace before the last );
    content = content.trimEnd().replace(/\);$/, '  }\n);');
    fs.writeFileSync(path, content);
    console.log('Added missing closing brace for component function');
} else {
    console.log('Could not find expected pattern');
}

console.log('Done');