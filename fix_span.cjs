const fs = require("fs");
let content = fs.readFileSync("src/components/reader/Paragraph.jsx", "utf8");

const oldSpan = `    return (
      <span
        className={classNames.join(" ")}
        key={\`${keyPrefix}-seg-${seg.start}-${seg.end}\`}
        data-text-start={seg.start - articleOffset}`;

const newSpan = `    return (
      <span
        className={classNames.join(" ")}
        style={underlineStyle}
        key={\`${keyPrefix}-seg-${seg.start}-${seg.end}\`}
        data-text-start={seg.start - articleOffset}`;

if (content.includes(oldSpan)) {
  content = content.replace(oldSpan, newSpan);
  fs.writeFileSync("src/components/reader/Paragraph.jsx", content, "utf8");
  console.log("Done - style added");
} else {
  console.log("NOT FOUND");
  const idx = content.indexOf("key={\\`${keyPrefix}");
  console.log("Context:", JSON.stringify(content.substring(idx, idx + 200)));
}