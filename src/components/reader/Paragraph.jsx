import React, { useMemo } from "react";

// Memoized vocabulary highlights per paragraph
function useVocabularyHighlights(paragraphText, savedWords, blockStart, paragraphStart) {
  return useMemo(() => {
    if (!savedWords || savedWords.length === 0 || !paragraphText) {
      return [];
    }

    const highlights = [];
    for (const word of savedWords) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      let match;
      while ((match = regex.exec(paragraphText)) !== null) {
        highlights.push({
          start: blockStart + paragraphStart + match.index,
          end: blockStart + paragraphStart + match.index + match[0].length,
          text: match[0],
          type: "vocabulary"
        });
      }
    }
    return highlights;
  }, [paragraphText, savedWords, blockStart, paragraphStart]);
}

// Memoized paragraph segments computation
function useParagraphSegments(paragraph, blockStart, articleOffset, pageHighlights, vocabularyHighlights) {
  return useMemo(() => {
    const paragraphAbsoluteStart = blockStart + paragraph.start;
    const paragraphText = paragraph.text;
    const paragraphAbsoluteEnd = paragraphAbsoluteStart + paragraphText.length;

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

    return { segments, paragraphText, paragraphAbsoluteStart };
  }, [paragraph, blockStart, articleOffset, pageHighlights, vocabularyHighlights]);
}

function Paragraph({
  paragraph,
  blockStart,
  articleOffset,
  pageHighlights,
  savedWords,
  onSelectWord,
  keyPrefix
}) {
  const vocabularyHighlights = useVocabularyHighlights(
    paragraph.text,
    savedWords,
    blockStart,
    paragraph.start
  );

  const { segments, paragraphText, paragraphAbsoluteStart } = useParagraphSegments(
    paragraph,
    blockStart,
    articleOffset,
    pageHighlights,
    vocabularyHighlights
  );

  // Extract word at click position from selection
  function extractWordAtClick(event) {
    let textNode = null;
    let charOffset = 0;
    let range = null;

    // Try caretRangeFromPoint first (Firefox, Safari, Chrome)
    range = document.caretRangeFromPoint(event.clientX, event.clientY);

    if (range) {
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = range.startContainer;
        charOffset = range.startOffset;
      } else {
        const walker = document.createTreeWalker(
          range.startContainer,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let node;
        while (node = walker.nextNode()) {
          const rect = node.getBoundingClientRect();
          if (rect.left <= event.clientX && rect.right >= event.clientX &&
              rect.top <= event.clientY && rect.bottom >= event.clientY) {
            textNode = node;
            const testRange = document.createRange();
            testRange.setStart(textNode, 0);
            testRange.setEnd(range.startContainer, range.startOffset);
            charOffset = testRange.toString().length;
            break;
          }
        }
      }
    }

    // Fallback: caretPositionFromPoint (Chrome/Edge)
    if (!textNode && document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
        textNode = pos.offsetNode;
        charOffset = pos.offset;
      } else if (pos && pos.offsetNode) {
        const walker = document.createTreeWalker(
          pos.offsetNode,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let node;
        while (node = walker.nextNode()) {
          const rect = node.getBoundingClientRect();
          if (rect.left <= event.clientX && rect.right >= event.clientX &&
              rect.top <= event.clientY && rect.bottom >= event.clientY) {
            textNode = node;
            charOffset = 0;
            break;
          }
        }
      }
    }

    // Last fallback: search in event.target
    if (!textNode) {
      const walker = document.createTreeWalker(
        event.target,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while (node = walker.nextNode()) {
        const rect = node.getBoundingClientRect();
        if (rect.left <= event.clientX && rect.right >= event.clientX &&
            rect.top <= event.clientY && rect.bottom >= event.clientY) {
          textNode = node;
          charOffset = 0;
          break;
        }
      }
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    const text = textNode.textContent;
    if (!text) {
      return null;
    }

    if (charOffset < 0) charOffset = 0;
    if (charOffset > text.length) charOffset = text.length;

    let start = charOffset;
    while (start > 0 && /[A-Za-z']/.test(text[start - 1])) {
      start--;
    }

    let end = charOffset;
    while (end < text.length && /[A-Za-z']/.test(text[end])) {
      end++;
    }

    let word = text.slice(start, end);
    if (!word) {
      return null;
    }

    word = word.replace(/^'+|'+$/g, '');

    if (!word || word.length > 50) {
      return null;
    }

    if (/[\s,.;:!?""()[\]{}]/.test(word)) {
      return null;
    }

    if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word)) {
      return null;
    }

    return word;
  }

  const pieces = segments.map((seg) => {
    const segText = paragraphText.slice(
      seg.start - paragraphAbsoluteStart,
      seg.end - paragraphAbsoluteStart
    );
    if (!segText) return null;

    const hasVocabulary = seg.types.includes("vocabulary");
    const hasUnderline = seg.types.includes("underline");

    const classNames = ["word"];
    if (hasVocabulary) classNames.push("vocabulary-highlight");
    if (hasUnderline) classNames.push("underline-wavy");

    const underlineStyle = hasUnderline ? {
      textDecorationLine: "underline",
      textDecorationStyle: "wavy",
      textDecorationThickness: "1px",
      textUnderlineOffset: "2px",
      textDecorationColor: "#eab308",
    } : undefined;

    return (
      <span
        className={classNames.join(" ")}
        style={underlineStyle}
        key={`${keyPrefix}-seg-${seg.start}-${seg.end}`}
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
  });

  return <>{pieces}</>;
}

// Wrap with React.memo for performance
const MemoizedParagraph = React.memo(Paragraph, (prevProps, nextProps) => {
  return (
    prevProps.paragraph.text === nextProps.paragraph.text &&
    prevProps.blockStart === nextProps.blockStart &&
    prevProps.articleOffset === nextProps.articleOffset &&
    prevProps.pageHighlights === nextProps.pageHighlights &&
    prevProps.savedWords === nextProps.savedWords &&
    prevProps.onSelectWord === nextProps.onSelectWord &&
    prevProps.keyPrefix === nextProps.keyPrefix
  );
});

export default MemoizedParagraph;