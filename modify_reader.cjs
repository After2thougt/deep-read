const fs = require('fs');
const path = 'D:/Projects/deep-read/src/components/Reader.jsx';

let content = fs.readFileSync(path, 'utf8');

// 1. Remove savedWords state from Reader (it will come from props)
const savedWordsStateMarker = `const [selection, setSelection] = useState(null);
  const [showFontControl, setShowFontControl] = useState(false);
  const [savedWords, setSavedWords] = useState([]);`;

const savedWordsStateReplacement = `const [selection, setSelection] = useState(null);
  const [showFontControl, setShowFontControl] = useState(false);`;

if (content.includes(savedWordsStateMarker)) {
    content = content.replace(savedWordsStateMarker, savedWordsStateReplacement);
    console.log('Removed savedWords state from Reader');
} else {
    console.log('ERROR: Could not find savedWordsStateMarker');
}

// 2. Add savedWords to the component props
const propsMarker = `export default function Reader({
  article,
  blocks = null,
  fontSize = 18,
  setFontSize,
  articleOffset = 0,
  pageEnd = Infinity,
  highlights = [],
  onSelectWord,
  onSaveUnderline,
  onRemoveUnderline,
  onUpdateUnderline,
  onTranslateArticle,
  onAnalyzeArticle,
  translating = false,
  analyzing = false,
  theme = "light",
  setTheme,
}) {`;

const propsReplacement = `export default function Reader({
  article,
  blocks = null,
  fontSize = 18,
  setFontSize,
  articleOffset = 0,
  pageEnd = Infinity,
  highlights = [],
  savedWords = [],
  onSelectWord,
  onSaveUnderline,
  onRemoveUnderline,
  onUpdateUnderline,
  onTranslateArticle,
  onAnalyzeArticle,
  translating = false,
  analyzing = false,
  theme = "light",
  setTheme,
}) {`;

if (content.includes(propsMarker)) {
    content = content.replace(propsMarker, propsReplacement);
    console.log('Added savedWords to Reader props');
} else {
    console.log('ERROR: Could not find propsMarker');
}

// 3. Remove the loadVocabulary useEffect since it's now in ReaderPage
const loadVocabEffectMarker = `// Load vocabulary
  useEffect(() => {
    async function loadVocabulary() {
      try {
        const res = await fetch("/api/vocabulary?limit=10000");
        const data = await res.json();
        setSavedWords(data.items.map((item) => item.word.toLowerCase()));
      } catch (e) {
        console.error(e);
      }
    }
    loadVocabulary();
  }, []);`;

if (content.includes(loadVocabEffectMarker)) {
    content = content.replace(loadVocabEffectMarker, '');
    console.log('Removed loadVocabulary effect from Reader');
} else {
    console.log('ERROR: Could not find loadVocabEffectMarker');
}

// 4. Fix renderParagraphWithHighlights to properly merge highlights
// First let me find the function
const renderFuncIdx = content.indexOf('function renderParagraphWithHighlights(');
if (renderFuncIdx >= 0) {
    // Find the end of this function
    let braceCount = 0;
    let inFunction = false;
    let endIdx = -1;
    for (let i = renderFuncIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            inFunction = true;
        } else if (content[i] === '}') {
            braceCount--;
            if (inFunction && braceCount === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }
    
    if (endIdx > 0) {
        const oldFunc = content.substring(renderFuncIdx, endIdx);
        console.log('Found renderParagraphWithHighlights, length:', oldFunc.length);
        
        // New implementation that properly merges highlights
        const newFunc = `function renderParagraphWithHighlights(
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

  // Merge overlapping highlights of different types
  // We want to create spans that can have multiple highlight types
  const mergedHighlights = [];
  for (const hl of overlappingHighlights) {
    const existingIdx = mergedHighlights.findIndex(
      m => !(m.end <= hl.start || m.start >= hl.end)
    );
    
    if (existingIdx === -1) {
      // No overlap, add new
      mergedHighlights.push({ ...hl, types: [hl.type] });
    } else {
      // Overlap exists - merge the types
      const existing = mergedHighlights[existingIdx];
      const newStart = Math.min(existing.start, hl.start);
      const newEnd = Math.max(existing.end, hl.end);
      
      // Split if necessary - this is complex, let's use a simpler approach:
      // Instead of merging spans, we'll track types per character position
      // For now, just add as separate highlight - the CSS will handle layering
      mergedHighlights.push({ ...hl, types: [hl.type] });
    }
  }

  // Simpler approach: render each highlight separately, but use proper layering
  const pieces = [];
  let cursor = paragraphAbsoluteStart;

  for (const hl of overlappingHighlights) {
    if (cursor < hl.start) {
      const normalText = paragraphText.slice(
        cursor - paragraphAbsoluteStart,
        hl.start - paragraphAbsoluteStart
      );
      pieces.push(
        <span
          className="word"
          key={\`\${baseKey}-plain-\${cursor}\`}
          role="button"
          tabIndex={0}
          data-text-start={cursor - articleOffset}
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
          {normalText}
        </span>
      );
    }
    
    const highlightText = paragraphText.slice(
      hl.start - paragraphAbsoluteStart,
      hl.end - paragraphAbsoluteStart
    );
    
    // Determine CSS classes - support multiple highlight types
    const classNames = ["word"];
    if (hl.type === "vocabulary" || (hl.types && hl.types.includes("vocabulary"))) {
      classNames.push("vocabulary-highlight");
    } else {
      classNames.push("underline-wavy");
    }
    
    pieces.push(
      <span
        className={classNames.join(" ")}
        key={\`\${baseKey}-hl-\${hl.id || hl.start}-\${hl.start}\`}
        data-text-start={hl.start - articleOffset}
        onClick={(event) => {
          const word = extractWordAtClick(event);
          if (word) onSelectWord(word);
        }}
      >
        {highlightText}
      </span>
    );
    
    cursor = hl.end;
  }

  if (cursor < paragraphAbsoluteEnd) {
    const normalText = paragraphText.slice(cursor - paragraphAbsoluteStart);
    pieces.push(
      <span
        className="word"
        key={\`\${baseKey}-plain-\${cursor}\`}
        role="button"
        tabIndex={0}
        data-text-start={cursor - articleOffset}
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
        {normalText}
      </span>
    );
  }

  return <>{pieces}</>;`;

        content = content.substring(0, renderFuncIdx) + newFunc + content.substring(endIdx);
        console.log('Updated renderParagraphWithHighlights');
    } else {
        console.log('ERROR: Could not find end of renderParagraphWithHighlights');
    }
} else {
    console.log('ERROR: Could not find renderParagraphWithHighlights');
}

fs.writeFileSync(path, content);
console.log('Done');