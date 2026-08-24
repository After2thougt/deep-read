import { useEffect, useMemo, useRef, useState } from "react";
import {
  Languages,
  Sparkles,
  Moon,
  Sun,
} from "lucide-react";

import { getWords } from "../utils/text";
import { generateId } from "../utils/id";
import HighlightsPanel from "./HighlightsPanel";


function splitParagraphs(text) {
  const parts = String(text || "").split(/(\r?\n\s*\r?\n)/);
  const paragraphs = [];
  let offset = 0;

  for (const part of parts) {
    if (!part) continue;

    if (/^\r?\n\s*\r?\n$/.test(part)) {
      offset += part.length;
      continue;
    }

    paragraphs.push({
      text: part,
      start: offset,
    });

    offset += part.length;
  }

  return paragraphs;
}


function highlightBoundaries(token, tokenStart, highlights) {
  const tokenEnd = tokenStart + token.length;
  const points = new Set([0, token.length]);

  for (const item of highlights) {
    if (
      item.start > tokenStart &&
      item.start < tokenEnd
    ) {
      points.add(item.start - tokenStart);
    }

    if (
      item.end > tokenStart &&
      item.end < tokenEnd
    ) {
      points.add(item.end - tokenStart);
    }
  }

  return [...points].sort((a, b) => a - b);
}


function isHighlighted(start, end, highlights) {
  return highlights.some(
    (item) =>
      item.start < end &&
      item.end > start
  );
}function getTextPosition(container, offset, root) {
  const textNode =
    container.nodeType === Node.TEXT_NODE
      ? container
      : null;

  const element = textNode
    ? textNode.parentElement
    : container instanceof Element
      ? container
      : null;

  const anchor = element?.closest(
    "[data-text-start]"
  );

  if (!anchor || !root.contains(anchor)) {
    return null;
  }

  const start = Number(anchor.dataset.textStart);

  if (!Number.isFinite(start)) {
    return null;
  }

  return start + offset;
}


export default function Reader({
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
}) {

  const contentRef = useRef(null);
  const fontControlRef = useRef(null);
  const selectionToolbarRef = useRef(null);
  const toolbarRef = useRef(null);
  const dragStateRef = useRef(null);

  // Extract word at click position from selection
  function extractWordAtClick(event) {
    // Get the text node at click position using caretRangeFromPoint
    let textNode = null;
    let charOffset = 0;
    let range = null;

    // Try caretRangeFromPoint first (Firefox, Safari, Chrome)
    range = document.caretRangeFromPoint(event.clientX, event.clientY);
    
    if (range) {
      // If startContainer is a text node, use it directly
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = range.startContainer;
        charOffset = range.startOffset;
      } else {
        // startContainer is an element - find the text node at click position within it
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
            // Use the range to get offset within this text node
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
        // offsetNode is an element - find text node within it
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
            // Approximate offset
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
      console.log('[extractWordAtClick] No text node found');
      return null;
    }

    const text = textNode.textContent;
    if (!text) {
      console.log('[extractWordAtClick] Empty text node');
      return null;
    }

    // Clamp offset to valid range
    if (charOffset < 0) charOffset = 0;
    if (charOffset > text.length) charOffset = text.length;

    // Expand left to find word start (only letters and apostrophe)
    let start = charOffset;
    while (start > 0 && /[A-Za-z']/.test(text[start - 1])) {
      start--;
    }

    // Expand right to find word end
    let end = charOffset;
    while (end < text.length && /[A-Za-z']/.test(text[end])) {
      end++;
    }

    // Extract the word
    let word = text.slice(start, end);
    if (!word) {
      console.log('[extractWordAtClick] Empty word slice', { start, end, charOffset, textLen: text.length });
      return null;
    }

    // Clean: remove leading/trailing apostrophes
    word = word.replace(/^'+|'+$/g, '');

    // STRICT validation
    if (!word || word.length > 50) {
      console.log('[extractWordAtClick] Invalid: empty or too long', { word, len: word?.length });
      return null;
    }

    // Reject any whitespace, punctuation except apostrophe
    if (/[\s,.;:!?""()\[\]{}]/.test(word)) {
      console.log('[extractWordAtClick] Invalid: contains punctuation/space', { word });
      return null;
    }

    // Must match: letters only, or letters with single apostrophe inside (not at ends)
    if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word)) {
      console.log('[extractWordAtClick] Invalid: regex mismatch', { word });
      return null;
    }

    console.log('[extractWordAtClick] SUCCESS', {
      nodeType: textNode.nodeType,
      text: textNode.textContent,
      offset: charOffset,
      word
    });

    return word;
  }


  const [selection, setSelection] = useState(null);
  const [showFontControl, setShowFontControl] = useState(false);




  const [
    toolbarPosition,
    setToolbarPosition,
  ] = useState(() => {

    try {

      const saved = localStorage.getItem(
        "deepread:learning-toolbar-position"
      );

      if (saved) {

        const parsed =
          JSON.parse(saved);

        if (
          Number.isFinite(parsed?.x) &&
          Number.isFinite(parsed?.y)
        ) {
          return parsed;
        }
      }

    } catch {}

    return {
      x: Math.max(
        window.innerWidth - 190,
        20
      ),
      y: Math.max(
        window.innerHeight - 90,
        20
      ),
    };
  });



  const contentBlocks =
    Array.isArray(blocks) && blocks.length
      ? blocks
      : [
          {
            type: "text",
            content: String(article || ""),
          },
        ];



  const pageHighlights = useMemo(
    () =>
      highlights.filter(
        (item) =>
          item.start < pageEnd &&
          item.end > articleOffset
      ),
    [
      highlights,
      pageEnd,
      articleOffset,
    ]
  );

  useEffect(() => {

  function handleClickOutside(event) {

    if (
      !fontControlRef.current?.contains(
        event.target
      )
    ) {
      setShowFontControl(false);
    }

  }


  document.addEventListener(
    "mousedown",
    handleClickOutside
  );


  return () => {

    document.removeEventListener(
      "mousedown",
      handleClickOutside
    );

  };

}, []);


  useEffect(() => {

    function dismissSelection(event) {

      if (
        !contentRef.current?.contains(event.target) &&
        !selectionToolbarRef.current?.contains(event.target)
      ) {
        setSelection(null);
      }
    }


    function dismissWithEscape(event) {

      if (event.key === "Escape") {
        setSelection(null);
      }
    }


    document.addEventListener(
      "mousedown",
      dismissSelection
    );

    document.addEventListener(
      "keydown",
      dismissWithEscape
    );


    return () => {

      document.removeEventListener(
        "mousedown",
        dismissSelection
      );

      document.removeEventListener(
        "keydown",
        dismissWithEscape
      );
    };


  }, [])

  // Toolbar drag handling
  useEffect(() => {
    function handlePointerMove(event) {
      const drag = dragStateRef.current;
      const toolbar = toolbarRef.current;
      if (!drag || !toolbar) return;

      const rect = toolbar.getBoundingClientRect();
      const margin = 12;

      const x = Math.max(
        margin,
        Math.min(
          event.clientX - drag.offsetX,
          window.innerWidth - rect.width - margin
        )
      );

      const y = Math.max(
        margin,
        Math.min(
          event.clientY - drag.offsetY,
          window.innerHeight - rect.height - margin
        )
      );

      setToolbarPosition({ x, y });
    }

    function handlePointerUp() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      document.body.classList.remove("is-dragging-toolbar");
      setToolbarPosition((position) => {
        try {
          localStorage.setItem(
            "deepread:learning-toolbar-position",
            JSON.stringify(position)
          );
        } catch {}
        return position;
      });
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  
useEffect(() => {

    function keepToolbarInViewport() {

      const toolbar = toolbarRef.current;

      if (!toolbar) return;


      const rect =
        toolbar.getBoundingClientRect();

      const margin = 12;


      setToolbarPosition((position)=>{

        const next = {

          x: Math.max(
            margin,
            Math.min(
              position.x,
              window.innerWidth -
                rect.width -
                margin
            )
          ),

          y: Math.max(
            margin,
            Math.min(
              position.y,
              window.innerHeight -
                rect.height -
                margin
            )
          ),
        };


        if (
          next.x === position.x &&
          next.y === position.y
        ) {
          return position;
        }


        return next;
      });

    }


    window.addEventListener(
      "resize",
      keepToolbarInViewport
    );


    return () =>
      window.removeEventListener(
        "resize",
        keepToolbarInViewport
      );


  }, []);


  function renderParagraphWithHighlights(
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
          `\\b${word}\\b`,
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
        key={`${baseKey}-seg-${seg.start}-${seg.end}`}
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
}

  function startToolbarDrag(event) {

    if (event.button !== 0) {
      return;
    }


    const toolbar =
      toolbarRef.current;


    if (!toolbar) return;


    const rect =
      toolbar.getBoundingClientRect();


    dragStateRef.current = {

      offsetX:
        event.clientX - rect.left,

      offsetY:
        event.clientY - rect.top,

    };


    document.body.classList.add(
      "is-dragging-toolbar"
    );


    event.preventDefault();

  }




  function handleSelection() {

    const browserSelection =
      window.getSelection();


    const range =
      browserSelection?.rangeCount
        ? browserSelection.getRangeAt(0)
        : null;


    const root =
      contentRef.current;



    if (
      !range ||
      !root ||
      range.collapsed ||
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {

      setSelection(null);
      return;

    }



    const start =
      getTextPosition(
        range.startContainer,
        range.startOffset,
        root
      );


    const end =
      getTextPosition(
        range.endContainer,
        range.endOffset,
        root
      );


    if (
      start == null ||
      end == null ||
      end <= start
    ) {

      setSelection(null);
      return;

    }


    const text =
      String(article || "")
        .slice(start, end);



    if (!text.trim()) {

      setSelection(null);
      return;

    }



    const rect =
      range.getBoundingClientRect();



    setSelection({

      start,

      end,

      text,

      rect: {

        top: rect.top,

        left: rect.left,

        width: rect.width,

        height: rect.height,

      },

    });

  }




  function saveUnderline() {

    if (!selection) return;


    onSaveUnderline({

      id: generateId("underline"),

      start:
        articleOffset +
        selection.start,

      end:
        articleOffset +
        selection.end,

      text:
        selection.text,

      style: "wavy",

    });


    window.getSelection()
      ?.removeAllRanges();


    setSelection(null);

  }




  function renderToken(token, tokenStart, key) {

    const absoluteTokenStart =
      articleOffset + tokenStart;


    const boundaries =
      highlightBoundaries(
        token,
        absoluteTokenStart,
        pageHighlights
      );



    const pieces =
      boundaries
        .slice(0, -1)
        .map((boundary,index)=>{


          const nextBoundary =
            boundaries[index + 1];


          const piece =
            token.slice(
              boundary,
              nextBoundary
            );


          const marked =
            isHighlighted(
              absoluteTokenStart + boundary,
              absoluteTokenStart + nextBoundary,
              pageHighlights
            );


          return (

            <span

              className={
                marked
                  ? "underline-wavy"
                  : undefined
              }

              data-text-start={
                tokenStart +
                boundary
              }

              key={`${key}-${boundary}`}

            >

              {piece}

            </span>

          );

        });



    const isWord =
      /^[A-Za-z]+(?:'[A-Za-z]+)?$/
        .test(token);



    if (!isWord) {

      return (
        <span key={key}>
          {pieces}
        </span>
      );

    }



    return (

      <span

        className="word"

        key={key}

        role="button"

        tabIndex={0}

        onClick={(event) => {
            const word = extractWordAtClick(event);
            if (word) onSelectWord(word);
          }}

        onKeyDown={(event) => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            const word = extractWordAtClick(event);
            if (word) onSelectWord(word);
          }
        }}

      >

        {pieces}

      </span>

    );

  }
    return (
    <main className="reader reading-surface">

      <div className="reader-heading">
        <div>
          <p className="eyebrow">
            Reading room
          </p>
        </div>
        <div
  className="font-control"
  ref={fontControlRef}
>

  <button
  className="font-toggle-button"
  type="button"
  onClick={() =>
    setShowFontControl(v => !v)
  }
>
  Aa
</button>

  <button
    className="theme-toggle-button"
    type="button"
    onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
  >
    {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
  </button>


  {showFontControl && (
    <div className="font-popover">

      <div className="font-popover-header">
        <span>A</span>
        <span>{fontSize}px</span>
      </div>


      <input
        type="range"
        min="12"
        max="32"
        step="1"
        value={fontSize}
        onChange={(event) =>
          setFontSize(
            Number(event.target.value)
          )
        }
      />

    </div>
  )}

</div>
      </div>

      <section
        className="content"
        aria-label="Article reader"
        ref={contentRef}
        
        onMouseUp={() =>
          window.setTimeout(
            handleSelection,
            0
          )
        }
        onTouchEnd={() =>
          window.setTimeout(
            handleSelection,
            0
          )
        }
      >

        {!contentBlocks.some(
          (block)=>
            block.type === "text" &&
            block.content
        ) &&
        !contentBlocks.some(
          (block)=>
            block.type === "image"
        ) ? (

          <p className="empty-reader">
            Paste an English article above to start reading.
          </p>

        ) : (

          (()=>{

            let contentOffset = 0;


            return contentBlocks.map(
              (block, blockIndex)=>{


                if (
                  block.type === "image"
                ) {

                  return (

                    <div
                      className="article-image-block"
                      key={
                        block.id ||
                        `${block.content}-${blockIndex}`
                      }
                    >

                      <img
                        className="article-image"
                        src={block.content}
                        alt=""
                      />

                    </div>

                  );

                }



                const paragraphs =
                  splitParagraphs(
                    block.content
                  );



                const blockStart =
                Number.isFinite(block.textOffset)
                  ? block.textOffset
                  : contentOffset;



                contentOffset +=
                  String(block.content || "")
                    .length;



                return paragraphs.map(
                  (
                    paragraph,
                    paragraphIndex
                  )=>{


                    let tokenOffset =
                      blockStart +
                      paragraph.start;



                    return (

                      <div
                        className="article-paragraph"
                        key={
                          `${block.id || blockIndex}-${paragraph.start}`
                        }
                      >

                        <div
                            className="paragraph-body"
                            style={{
                              fontSize: `${fontSize || 18}px`,
                            }}
                          >
                            {renderParagraphWithHighlights(
                            paragraph,
                            blockStart,
                            articleOffset,
                            pageHighlights,
                            `${blockIndex}-${paragraphIndex}`
                          )}
                          </div>

                      </div>

                    );

                  }
                );


              }
            );


          })()

        )}

      </section>




      <div

        ref={toolbarRef}

        className="learning-toolbar-floating"

        style={{

          position:"fixed",

          left:`${toolbarPosition.x}px`,

          top:`${toolbarPosition.y}px`,

        }}

      >

        <div

          className="learning-toolbar-drag-handle"

          onPointerDown={startToolbarDrag}

          title="Drag toolbar"

        >

          ⋮⋮

        </div>


        <div className="learning-toolbar-actions">


          <button

            className="learning-tool-button"

            type="button"

            disabled={
              !article.trim() ||
              translating
            }

            onClick={
              onTranslateArticle
            }

          >

            <Languages size={17}/>

            {
              translating
                ? "Translating..."
                : "Translate"
            }

          </button>



          <button

            className="learning-tool-button"

            type="button"

            disabled={
              !article.trim() ||
              analyzing
            }

            onClick={
              onAnalyzeArticle
            }

          >

            <Sparkles size={17}/>

            {
              analyzing
                ? "Analyzing..."
                : "Analyze"
            }

          </button>


        </div>


      </div>




      {
        selection && (

          <div

            className="selection-toolbar"

            ref={selectionToolbarRef}

            style={{

              position:"fixed",

              top:`${Math.max(
                12,
                selection.rect.top - 52
              )}px`,

              left:`${Math.max(
                12,
                selection.rect.left +
                selection.rect.width / 2
              )}px`,

              transform:
                "translateX(-50%)"

            }}

          >

            <button

              className="selection-tool-button"

              type="button"

              onClick={saveUnderline}

            >

              〰 Underline

            </button>

          </div>

        )
      }





            <HighlightsPanel
        pageHighlights={pageHighlights}
        onUpdateUnderline={onUpdateUnderline}
        onRemoveUnderline={onRemoveUnderline}
      /></main>
  );

}