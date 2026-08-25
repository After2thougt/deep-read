export function initialEditorBlocks(article, blocks) {
  return Array.isArray(blocks) && blocks.length
    ? blocks
    : [{ type: "text", content: article || "" }];
}

export function serializeEditor(blocks) {
  return JSON.stringify(blocks);
}

export function editorSourceSignature(article, blocks) {
  return JSON.stringify(blocks?.map((block) => ({
    type: block?.type??"n/a",
    content: block?.type === "text"
      ? String(block?.content??"").replace(/\n+$/, "")
      : block?.content??"",
  })));
}
