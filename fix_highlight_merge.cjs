const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// Find the start of the function
const funcStart = content.indexOf('function renderParagraphWithHighlights(');
if (funcStart === -1) {
    console.log('ERROR: Function not found');
    process.exit(1);
}

// Find the end of the function (before startToolbarDrag)
const funcEnd = content.indexOf('\n  function startToolbarDrag(event) {', funcStart);
if (funcEnd === -1) {
    console.log('ERROR: Function end not found');
    process.exit(1);
}

const newFunction = `function renderParagraphWithHighlights(
  paragraph,
  blockStart,
  articleOffset,
  pageHighlights,
  keyPrefix
) {

  const paragraphAbsoluteStart =
    blockStart + paragraph.start;

  const paragraphText =
    paragraph.text;

  const paragraphAbsoluteEnd =
    paragraphAbsoluteStart + paragraphText.length;

  const baseKey = keyPrefix;

  // Build vocabulary highlights from savedWords prop
  const vocabularyHighlights =
    savedWords.map(word => {

      const regex =
        new RegExp(
          \`\\\\b\${word}\\\\b\`,
          "gi"
        );

      const matches = [];

      let match;

      while (
        (match = regex.exec(paragraph.text))
      ) {

        matches.push({
          start:
            blockStart +
            paragraph.start +
            match.index,

          end:
            blockStart +
            paragraph.start +
            match.index +
            match[0].length,

          text:
            match[0],

          type: "vocabulary"
        });

      }

      return matches;

    })
    .flat();

  // Combine all highlights and sort by start position
  const allHighlights = [
    ...pageHighlights.map(hl => ({ ...hl, type: "underline" })),
    ...vocabularyHighlights
  ].sort((a, b) => a.start - b.start);

  // Filter to highlights overlapping this paragraph
  const overlappingHighlights = allHighlights
    .filter(
      hl =>
        hl.end > paragraphAbsoluteStart &&
        hl.start < paragraphAbsoluteEnd
    )
    .map(hl => ({
      ...hl,
      start: Math.max(hl.start, paragraphAbsoluteStart),
      end: Math.min(hl.end, paragraphAbsoluteEnd),
    }))
    .sort((a, b) => a.start - b.start);

  // Collect all unique boundaries from highlights
  const boundaries = new Set([paragraphAbsoluteStart, paragraphAbsoluteEnd]);
  for (const hl of overlappingHighlights) {
    boundaries.add(hl.start);
    boundaries.add(hl.end);
  }
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  // Build segments: each segment is a non-overlapping text range with its highlight types
  const segments = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const segStart = sortedBoundaries[i];
    const segEnd = sortedBoundaries[i + 1];
    if (segStart >= segEnd) continue;

    // Find which highlights cover this segment
    const types = new Set();
    for (const hl of overlappingHighlights) {
      if (hl.start <= segStart && hl.end >= segEnd) {
        types.add(hl.type);
      }
    }

    segments.push({
      start: segStart,
      end: segEnd,
      types: Array.from(types)
    });
  }

  // Render each segment once
  const pieces = [];

  for (const seg of segments) {
    const segText = paragraphText.slice(
      seg.start - paragraphAbsoluteStart,
      seg.end - paragraphAbsoluteStart
    );
    if (!segText) continue;

    const hasVocabulary = seg.types.includes("vocabulary");
    const hasUnderline = seg.types.includes("underline");

    const classNames = ["word"];
    if (hasVocabulary) classNames.push("vocabulary-highlight");
    if (hasUnderline) classNames.push("underline-wavy");

    pieces.push(
      <span
        className={classNames.join(" ")}
        key={\`\${baseKey}-seg-\${seg.start}-\${seg.end}\`}
        data-text-start={seg.start - articleOffset}
        onClick={(event) => {
          const word = extractWordAtClick(event);
          if (word) onSelectWord(word);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const word = extractWordAtClick(event);
            if (word) onSelectWord(word);
          }
        }}
      >
        {segText}
      </span>
    );
  }

  return <>{pieces}</>;
`;

const beforeFunc = content.substring(0, funcStart);
const afterFunc = content.substring(funcEnd);

const newContent = beforeFunc + newFunction + afterFunc;

fs.writeFileSync(path, newContent);
console.log('Fixed: rewrote renderParagraphWithHighlights with proper segment merging');