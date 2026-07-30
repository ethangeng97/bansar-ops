const PLACEHOLDER_MARKS = new Set(["N/M", "NM", "NO MARK", "NO MARKS"]);

function normalizeBlock(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .trim();
}

function markKey(value) {
  return normalizeBlock(value).toUpperCase().replace(/\s+/g, " ");
}

function isPlaceholderMark(value) {
  return PLACEHOLDER_MARKS.has(markKey(value));
}

export function combineMarks(shipmentMarks, cargoItems = [], fallback = "N/M") {
  const blocks = [];
  const seen = new Set();
  const add = (value) => {
    const text = normalizeBlock(value);
    if (!text) return;
    for (const block of text.split(/\n\s*\n/).map(normalizeBlock).filter(Boolean)) {
      const key = markKey(block);
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(block);
    }
  };

  add(shipmentMarks);
  for (const item of cargoItems || []) add(item?.marks);

  const hasRealMarks = blocks.some(block => !isPlaceholderMark(block));
  const filtered = hasRealMarks ? blocks.filter(block => !isPlaceholderMark(block)) : blocks;
  return filtered.join("\n\n") || fallback;
}
