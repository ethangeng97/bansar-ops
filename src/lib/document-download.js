let _pdfDepsPromise = null;

const PDF_TEXT_LAYER_ATTRIBUTE = "data-pdf-editable-text";
const PDF_TEXT_LAYER_SELECTOR = `[${PDF_TEXT_LAYER_ATTRIBUTE}]`;

// jsPDF's built-in Helvetica/Courier fonts use the WinAnsi character set.
// Keep unsupported text (most notably CJK) in the background image so it never
// turns into mojibake, while normal B/L English and numbers remain true PDF text.
const WIN_ANSI_TEXT = /^[\t\n\r\x20-\x7e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]*$/;

async function getPdfDeps() {
  if (!_pdfDepsPromise) {
    _pdfDepsPromise = Promise.all([
      import("jspdf"),
      import("html2canvas"),
    ]).then(([jspdfMod, html2canvasMod]) => ({
      jsPDF: jspdfMod.jsPDF || jspdfMod.default?.jsPDF,
      html2canvas: html2canvasMod.default || html2canvasMod,
    }));
  }
  return _pdfDepsPromise;
}

export function sanitizeFileStem(value) {
  const cleaned = Array.from(String(value || "document"), ch => {
    const code = ch.charCodeAt(0);
    return code < 32 || '<>:"/\\|?*'.includes(ch) ? "-" : ch;
  }).join("");
  return cleaned
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[. -]+$/g, "")
    .trim()
    .slice(0, 160) || "document";
}

export function validatePdfEditPassword(password, confirmation = password) {
  if (!password) return "请输入编辑密码";
  if (password.length < 6) return "编辑密码至少需要 6 位";
  if (password.length > 32) return "编辑密码最多支持 32 位";
  if (!/^[\x20-\x7e]+$/.test(password)) return "编辑密码只支持英文、数字和英文符号";
  if (password !== confirmation) return "两次输入的密码不一致";
  return "";
}

async function waitForAssets(elements) {
  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => {});
  }
  const images = elements.flatMap(element => Array.from(element.querySelectorAll("img")));
  await Promise.all(images.map(async image => {
    if (image.complete) {
      if (typeof image.decode === "function") {
        await image.decode().catch(() => {});
      }
      return;
    }
    await new Promise(resolve => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}

function collectBreakpoints(element, canvas) {
  const elementRect = element.getBoundingClientRect();
  const scaleY = canvas.height / Math.max(elementRect.height, 1);
  const points = new Set([0, canvas.height]);

  element.querySelectorAll("tr, .pdf-keep-together").forEach(node => {
    const rect = node.getBoundingClientRect();
    const top = Math.round((rect.top - elementRect.top) * scaleY);
    const bottom = Math.round((rect.bottom - elementRect.top) * scaleY);
    if (top > 0 && top < canvas.height) points.add(top);
    if (bottom > 0 && bottom < canvas.height) points.add(bottom);
  });

  return Array.from(points).sort((a, b) => a - b);
}

function chooseSliceEnd(start, idealEnd, canvasHeight, pageHeightPx, breakpoints) {
  if (idealEnd >= canvasHeight) return canvasHeight;
  const minimumUsefulEnd = start + pageHeightPx * 0.7;
  const candidates = breakpoints.filter(point =>
    point >= minimumUsefulEnd && point <= idealEnd
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : idealEnd;
}

function addCanvasPages(pdf, canvas, breakpoints, hasPdfPage) {
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const pageHeightPx = Math.floor(canvas.width * pageHeightMm / pageWidthMm);

  if (canvas.height <= pageHeightPx * 1.03) {
    if (hasPdfPage) pdf.addPage("a4", "p");
    const image = canvas.toDataURL("image/jpeg", 0.95);
    const imageHeightMm = Math.min(pageHeightMm, pageWidthMm * canvas.height / canvas.width);
    pdf.addImage(image, "JPEG", 0, 0, pageWidthMm, imageHeightMm, undefined, "FAST");
    return true;
  }

  let sliceStart = 0;
  let pageAdded = hasPdfPage;
  while (sliceStart < canvas.height) {
    const idealEnd = Math.min(sliceStart + pageHeightPx, canvas.height);
    const sliceEnd = chooseSliceEnd(
      sliceStart,
      idealEnd,
      canvas.height,
      pageHeightPx,
      breakpoints
    );
    const sliceHeight = Math.max(1, sliceEnd - sliceStart);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeight;
    const context = sliceCanvas.getContext("2d");
    if (!context) throw new Error("PDF 分页画布创建失败");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    context.drawImage(
      canvas,
      0, sliceStart, canvas.width, sliceHeight,
      0, 0, canvas.width, sliceHeight
    );

    if (pageAdded) pdf.addPage("a4", "p");
    const image = sliceCanvas.toDataURL("image/jpeg", 0.95);
    const imageHeightMm = pageWidthMm * sliceHeight / canvas.width;
    pdf.addImage(image, "JPEG", 0, 0, pageWidthMm, imageHeightMm, undefined, "FAST");
    pageAdded = true;
    sliceStart = sliceEnd;
  }
  return pageAdded;
}

function addCanvasSinglePage(pdf, canvas, hasPdfPage) {
  return addCanvasSinglePageWithPlacement(pdf, canvas, hasPdfPage).hasPdfPage;
}

function addCanvasSinglePageWithPlacement(pdf, canvas, hasPdfPage) {
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  if (hasPdfPage) pdf.addPage("a4", "p");
  const image = canvas.toDataURL("image/jpeg", 0.92);
  const imageWidthMm = pageWidthMm;
  const imageHeightMm = pageWidthMm * canvas.height / canvas.width;
  let placement;
  if (imageHeightMm <= pageHeightMm) {
    pdf.addImage(image, "JPEG", 0, 0, imageWidthMm, imageHeightMm, undefined, "FAST");
    placement = { x: 0, y: 0, width: imageWidthMm, height: imageHeightMm };
  } else {
    const fittedWidthMm = pageHeightMm * canvas.width / canvas.height;
    const x = Math.max(0, (pageWidthMm - fittedWidthMm) / 2);
    pdf.addImage(image, "JPEG", x, 0, fittedWidthMm, pageHeightMm, undefined, "FAST");
    placement = { x, y: 0, width: fittedWidthMm, height: pageHeightMm };
  }
  return { hasPdfPage: true, placement };
}

function shouldKeepTextInRaster(textNode, page) {
  const text = textNode.nodeValue || "";
  if (!text.trim() || !WIN_ANSI_TEXT.test(text)) return true;

  for (let element = textNode.parentElement; element && element !== page; element = element.parentElement) {
    if (element.matches?.(".hbl-watermark, [data-pdf-raster-text]")) return true;
    const style = window.getComputedStyle(element);
    if (style.transform && style.transform !== "none") return true;
    if (Number.parseFloat(style.opacity || "1") < 0.98) return true;
  }
  return false;
}

function wrapEditableText(page) {
  const view = page.ownerDocument.defaultView || window;
  const filter = view.NodeFilter || NodeFilter;
  const walker = page.ownerDocument.createTreeWalker(page, filter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const tag = node.parentElement?.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    if (!shouldKeepTextInRaster(node, page)) nodes.push(node);
  }

  return nodes.map(node => {
    const wrapper = page.ownerDocument.createElement("span");
    wrapper.setAttribute(PDF_TEXT_LAYER_ATTRIBUTE, "");
    node.parentNode.replaceChild(wrapper, node);
    wrapper.appendChild(node);
    return wrapper;
  });
}

function restoreEditableText(wrappers) {
  for (const wrapper of wrappers) {
    const parent = wrapper.parentNode;
    if (!parent) continue;
    while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
    parent.removeChild(wrapper);
  }
}

function parseRgb(color) {
  const values = String(color || "").match(/[\d.]+/g)?.map(Number) || [];
  return values.length >= 3
    ? values.slice(0, 3).map(value => Math.max(0, Math.min(255, Math.round(value))))
    : [0, 0, 0];
}

function collectEditableTextRuns(page, wrappers) {
  const pageRect = page.getBoundingClientRect();
  const runs = [];

  for (const wrapper of wrappers) {
    const textNode = wrapper.firstChild;
    const value = textNode?.nodeValue || "";
    if (!value) continue;

    const style = window.getComputedStyle(wrapper);
    const fontSizePx = Number.parseFloat(style.fontSize) || 10;
    const lines = [];
    let current = null;

    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "\n" || value[index] === "\r") {
        current = null;
        continue;
      }
      const range = page.ownerDocument.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const rect = range.getBoundingClientRect();
      range.detach?.();
      if (!rect.width && !rect.height) continue;

      if (!current || Math.abs(current.top - rect.top) > 1.5) {
        current = { start: index, end: index + 1, top: rect.top };
        lines.push(current);
      } else {
        current.end = index + 1;
      }
    }

    for (const line of lines) {
      let start = line.start;
      let end = line.end;
      while (start < end && /[\t \u00a0]/.test(value[start])) start += 1;
      while (end > start && /[\t \u00a0]/.test(value[end - 1])) end -= 1;
      if (start >= end) continue;

      const text = value.slice(start, end).replace(/\u00a0/g, " ");
      const range = page.ownerDocument.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const rect = range.getBoundingClientRect();
      range.detach?.();
      if (!rect.width || !rect.height) continue;

      const weight = Number.parseInt(style.fontWeight, 10);
      const bold = style.fontWeight === "bold" || (!Number.isNaN(weight) && weight >= 600);
      const italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
      const family = /consolas|courier|monospace/i.test(style.fontFamily) ? "courier" : "helvetica";

      runs.push({
        text,
        x: rect.left - pageRect.left,
        baseline: rect.bottom - fontSizePx * 0.18 - pageRect.top,
        width: rect.width,
        fontSizePx,
        family,
        fontStyle: bold ? (italic ? "bolditalic" : "bold") : (italic ? "italic" : "normal"),
        color: parseRgb(style.color),
      });
    }
  }

  return { pageRect, runs };
}

function hideEditableTextInClone(clonedDocument) {
  clonedDocument.querySelectorAll(PDF_TEXT_LAYER_SELECTOR).forEach(element => {
    element.style.setProperty("color", "transparent", "important");
    element.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    element.style.setProperty("-webkit-text-stroke-color", "transparent", "important");
    element.style.setProperty("text-decoration-color", "transparent", "important");
    element.style.setProperty("text-shadow", "none", "important");
  });
}

function addEditableTextLayer(pdf, textLayer, placement) {
  const { pageRect, runs } = textLayer;
  const mmPerCssPxX = placement.width / Math.max(pageRect.width, 1);
  const mmPerCssPxY = placement.height / Math.max(pageRect.height, 1);
  const pointsPerMm = 72 / 25.4;

  for (const run of runs) {
    pdf.setFont(run.family, run.fontStyle);
    pdf.setFontSize(Math.max(1, run.fontSizePx * mmPerCssPxY * pointsPerMm));
    pdf.setTextColor(...run.color);

    const targetWidth = run.width * mmPerCssPxX;
    const naturalWidth = pdf.getTextWidth(run.text);
    const horizontalScale = naturalWidth > 0
      ? Math.max(0.35, Math.min(3, targetWidth / naturalWidth))
      : 1;

    pdf.text(
      run.text,
      placement.x + run.x * mmPerCssPxX,
      placement.y + run.baseline * mmPerCssPxY,
      { baseline: "alphabetic", horizontalScale }
    );
  }
}

export async function createDocumentPdfBlob({
  pageSelector,
  root = document,
  scale,
  singlePagePerElement = false,
  editableText = false,
  editPassword = "",
}) {
  const pages = Array.from(root.querySelectorAll(pageSelector));
  if (pages.length === 0) throw new Error("文件页面还没渲染完成，请稍后再试");

  await waitForAssets(pages);
  const { jsPDF, html2canvas } = await getPdfDeps();
  if (!jsPDF || !html2canvas) throw new Error("PDF 生成组件加载失败");

  const pdfOptions = { orientation: "p", unit: "mm", format: "a4", compress: true };
  if (editPassword) {
    pdfOptions.encryption = {
      userPassword: "",
      ownerPassword: editPassword,
      userPermissions: ["print", "copy"],
    };
  }
  const pdf = new jsPDF(pdfOptions);
  let hasPdfPage = false;
  for (const page of pages) {
    const wrappers = editableText ? wrapEditableText(page) : [];
    const textLayer = editableText ? collectEditableTextRuns(page, wrappers) : null;
    let canvas;
    try {
      canvas = await html2canvas(page, {
        scale: scale || Math.max(2, window.devicePixelRatio || 1),
        backgroundColor: "#ffffff",
        useCORS: true,
        allowTaint: false,
        logging: false,
        ignoreElements: element => element.classList?.contains("no-print"),
        onclone: editableText ? hideEditableTextInClone : undefined,
      });
    } finally {
      restoreEditableText(wrappers);
    }

    if (editableText) {
      const result = addCanvasSinglePageWithPlacement(pdf, canvas, hasPdfPage);
      hasPdfPage = result.hasPdfPage;
      addEditableTextLayer(pdf, textLayer, result.placement);
    } else {
      hasPdfPage = singlePagePerElement
        ? addCanvasSinglePage(pdf, canvas, hasPdfPage)
        : addCanvasPages(pdf, canvas, collectBreakpoints(page, canvas), hasPdfPage);
    }
  }

  return pdf.output("blob");
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadDocumentPdf({
  filename,
  pageSelector,
  root = document,
  singlePagePerElement = false,
  editableText = false,
  editPassword = "",
}) {
  const blob = await createDocumentPdfBlob({
    pageSelector,
    root,
    singlePagePerElement,
    editableText,
    editPassword,
  });
  downloadBlob(blob, `${sanitizeFileStem(filename)}.pdf`);
}

export function downloadDocumentHtml({ filename, rootSelector = ".doc-page" }) {
  const root = document.querySelector(rootSelector);
  if (!root) throw new Error("文件页面还没渲染完成，请稍后再试");

  const clone = root.cloneNode(true);
  clone.querySelectorAll(".no-print").forEach(element => element.remove());
  const headStyles = Array.from(
    document.head.querySelectorAll('style, link[rel="stylesheet"]')
  ).map(element => element.outerHTML).join("\n");
  const safeFilename = sanitizeFileStem(filename);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <base href="${location.origin}/" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(safeFilename)}</title>
  ${headStyles}
  <style>html, body { margin: 0; background: #fff; }</style>
</head>
<body>
${clone.outerHTML}
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Word / WPS 只认 table 排版：网页里用 CSS grid / flex / 多栏 / 绝对定位排出来的版面，
// 打开 .doc 时会全部变成上下堆叠。下面按网页上“实际算出来”的样式，把这些容器
// 换成等效的表格，让 Word 版和网页 / PDF 版保持同一个版面。
// ---------------------------------------------------------------------------
const BOX_PROPS = ["Top", "Right", "Bottom", "Left"];

function isTransparent(color) {
  return !color || color === "transparent" || /rgba\(.*,\s*0\)$/.test(color);
}

// 把子元素的边框 / 底色 / 内边距搬到表格单元格上（Word 里 div 的边框会变成段落线）
// 格子只写内容区高度：LibreOffice / WPS 会在 height 之外再加上下内边距，写整格高度会越变越高
function contentHeight(source, computed) {
  const extra = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]
    .reduce((sum, key) => sum + (parseFloat(computed[key]) || 0), 0);
  return Math.max(0, Math.round(source.getBoundingClientRect().height - extra));
}

function moveBoxToCell(cell, element, computed) {
  for (const side of BOX_PROPS) {
    const width = computed[`border${side}Width`];
    const style = computed[`border${side}Style`];
    if (style !== "none" && parseFloat(width) > 0) {
      cell.style[`border${side}`] = `${width} ${style} ${computed[`border${side}Color`]}`;
    }
    cell.style[`padding${side}`] = computed[`padding${side}`];
  }
  if (!isTransparent(computed.backgroundColor)) cell.style.background = computed.backgroundColor;
  cell.style.textAlign = computed.textAlign === "start" ? "left" : computed.textAlign;
  Object.assign(element.style, { border: "none", padding: "0", background: "transparent", minHeight: "0" });
}

function makeLayoutTable(source, computed) {
  const table = document.createElement("table");
  const width = Math.round(source.getBoundingClientRect().width);
  table.setAttribute("width", String(width));
  table.setAttribute("cellspacing", "0");
  table.setAttribute("cellpadding", "0");
  table.style.width = `${width}px`;
  table.style.borderCollapse = "collapse";
  table.style.tableLayout = "fixed";  // 按设定的列宽排，不让内容撑宽某一列
  if (!isTransparent(computed.backgroundColor)) table.style.background = computed.backgroundColor;
  table.style.marginTop = computed.marginTop;
  table.style.marginBottom = computed.marginBottom;
  return table;
}

function gridSpan(childComputed, columnCount) {
  const end = childComputed.gridColumnEnd;
  const start = childComputed.gridColumnStart;
  if (end === "-1") return columnCount - (parseInt(start) || 1) + 1;
  const spanMatch = /span\s+(\d+)/.exec(end) || /span\s+(\d+)/.exec(start);
  if (spanMatch) return Math.min(columnCount, parseInt(spanMatch[1]));
  if (parseInt(end) && parseInt(start)) return Math.max(1, parseInt(end) - parseInt(start));
  return 1;
}

function convertLayoutForWord(pairs, isPage = () => false) {
  const movedIntoCell = new Set();  // 已经搬进表格单元格的子元素，边框已由单元格负责
  for (const { source, element } of pairs) {
    if (!element.isConnected && !element.parentNode) continue;
    const computed = getComputedStyle(source);
    const sourceChildren = Array.from(source.children);
    const children = Array.from(element.children);
    if (children.length !== sourceChildren.length) continue;

    if (computed.display === "grid" && children.length > 0) {
      const columns = computed.gridTemplateColumns.split(/\s+/).map(parseFloat).filter(n => n > 0);
      if (columns.length === 0) continue;
      const table = makeLayoutTable(source, computed);
      const colgroup = document.createElement("colgroup");
      columns.forEach(c => {
        const col = document.createElement("col");
        col.setAttribute("width", String(Math.round(c)));
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);
      let row = null;
      let used = columns.length;
      const cells = [];
      children.forEach((child, i) => {
        const childComputed = getComputedStyle(sourceChildren[i]);
        const span = gridSpan(childComputed, columns.length);
        if (used + span > columns.length) {
          row = table.insertRow();
          used = 0;
        }
        const cell = row.insertCell();
        if (span > 1) cell.colSpan = span;
        // 用网页上实际的像素宽度（Word 的纸张可用宽度和网页“纸张”内容区一样），比百分比稳定
        const share = columns.slice(used, used + span).reduce((a, b) => a + b, 0);
        cell.setAttribute("width", String(Math.round(share)));
        cell.style.width = `${Math.round(share)}px`;
        cell.style.verticalAlign = childComputed.display === "flex" && childComputed.justifyContent === "center" ? "middle" : "top";
        cell.style.height = `${contentHeight(sourceChildren[i], childComputed)}px`;
        moveBoxToCell(cell, child, childComputed);
        movedIntoCell.add(child);
        cell.appendChild(child);
        cells.push({ cell, row: table.rows.length - 1, start: used, end: used + span });
        used += span;
      });
      // 网格外框画在四周的格子上（Word 对表格本身的边框支持不稳定）
      const lastRow = table.rows.length - 1;
      for (const { cell, row: r, start, end } of cells) {
        const edge = side => `${computed[`border${side}Width`]} ${computed[`border${side}Style`]} ${computed[`border${side}Color`]}`;
        const has = side => computed[`border${side}Style`] !== "none" && parseFloat(computed[`border${side}Width`]) > 0;
        if (r === 0 && has("Top")) cell.style.borderTop = edge("Top");
        if (r === lastRow && has("Bottom")) cell.style.borderBottom = edge("Bottom");
        if (start === 0 && has("Left")) cell.style.borderLeft = edge("Left");
        if (end === columns.length && has("Right")) cell.style.borderRight = edge("Right");
      }
      Object.assign(element.style, { display: "block", border: "none", padding: "0" });
      element.appendChild(table);
      continue;
    }

    const isRowFlex = (computed.display === "flex" || computed.display === "inline-flex")
      && !computed.flexDirection.startsWith("column");
    if (isRowFlex && children.length > 1) {
      const table = makeLayoutTable(source, { ...computed, borderTopStyle: "none", borderRightStyle: "none", borderBottomStyle: "none", borderLeftStyle: "none", backgroundColor: "transparent" });
      const row = table.insertRow();
      const lastIdx = children.length - 1;
      children.forEach((child, i) => {
        const rect = sourceChildren[i].getBoundingClientRect();
        const cell = row.insertCell();
        cell.setAttribute("width", String(Math.round(rect.width)));
        cell.style.width = `${Math.round(rect.width)}px`;
        cell.style.padding = "0";
        cell.style.border = "none";
        cell.style.verticalAlign = computed.alignItems === "center" ? "middle"
          : computed.alignItems === "flex-end" ? "bottom" : "top";
        if (i === lastIdx && lastIdx > 0 && /space-between|flex-end|end/.test(computed.justifyContent)) {
          cell.style.textAlign = "right";
        } else if (computed.justifyContent === "center") {
          cell.style.textAlign = "center";
        }
        movedIntoCell.add(child);
        cell.appendChild(child);
      });
      element.style.display = "block";
      element.appendChild(table);
      continue;
    }

    // 带边框 / 底色的块（提示框、抬头信息框）：Word 会把每一行文字各画一个框，包成单格表格
    const hasBorder = BOX_PROPS.some(side => computed[`border${side}Style`] !== "none" && parseFloat(computed[`border${side}Width`]) > 0);
    if (element.tagName === "DIV" && computed.display === "block" && !movedIntoCell.has(element) && !isPage(element)
        && (hasBorder || !isTransparent(computed.backgroundColor)) && !parseInt(computed.columnCount)) {
      const table = makeLayoutTable(source, { ...computed, marginTop: "0", marginBottom: "0" });
      const cell = table.insertRow().insertCell();
      cell.style.verticalAlign = "top";
      while (element.firstChild) cell.appendChild(element.firstChild);
      moveBoxToCell(cell, element, computed);
      // 块里直接的文字没有自己的标签，字号 / 字体要写到格子上，否则 Word 用默认的宋体 / Times
      for (const prop of ["fontSize", "fontFamily", "fontWeight", "color", "lineHeight"]) cell.style[prop] = computed[prop];
      element.appendChild(table);
      continue;
    }

    // 两栏排版（column-count）：按条目对半分到左右两个格子
    const columnCount = parseInt(computed.columnCount);
    if (columnCount > 1) {
      const table = makeLayoutTable(source, { ...computed, borderTopStyle: "none", borderRightStyle: "none", borderBottomStyle: "none", borderLeftStyle: "none", backgroundColor: "transparent" });
      const row = table.insertRow();
      const perColumn = Math.ceil(children.length / columnCount);
      for (let c = 0; c < columnCount; c++) {
        const cell = row.insertCell();
        cell.setAttribute("width", `${(100 / columnCount).toFixed(2)}%`);
        cell.style.verticalAlign = "top";
        cell.style.padding = "0 6px";
        cell.style.textAlign = computed.textAlign;
        children.slice(c * perColumn, (c + 1) * perColumn).forEach(child => cell.appendChild(child));
      }
      element.style.columnCount = "auto";
      element.removeAttribute("class");  // 页面 <style> 里的 column-count 规则也不能再生效
      element.appendChild(table);
    }
  }
}

// 导出 .doc（Word 能打开的 HTML）。Word 的 HTML 排版很弱：不认 flex / max-width / 绝对定位，
// 没有分节信息时还会用“Web 版式”打开、纸张跟着默认设置走。这里把这些都补上，
// 让 Word 里的样子尽量和网页 / PDF 一致：A4 纵向、固定页边距、图片按网页上显示的大小写死。
export function downloadDocumentWord({ filename, rootSelector = ".doc-page", pageSelector, pageMargin = "14mm" }) {
  const root = document.querySelector(rootSelector);
  if (!root) throw new Error("文件页面还没渲染完成，请稍后再试");

  const clone = root.cloneNode(true);
  // 原页面和克隆里的元素一一对应，后面按原页面实际算出的样式改写克隆
  const sourceNodes = Array.from(root.querySelectorAll("*"));
  const pairs = Array.from(clone.querySelectorAll("*")).map((element, idx) => ({ element, source: sourceNodes[idx] }))
    .filter(pair => pair.source);
  clone.querySelectorAll(".no-print").forEach(element => element.remove());
  // Word 里表格单元格不继承 table / div 上的字号、字体，按网页实际算出的样式逐格写死
  pairs.forEach(({ element, source }) => {
    if (!/^(TD|TH|DIV|SPAN|P|B|STRONG)$/.test(element.tagName)) return;
    const computed = getComputedStyle(source);
    element.style.fontSize = `${+(parseFloat(computed.fontSize) * 0.75).toFixed(2)}pt`;
    element.style.fontFamily = computed.fontFamily;
    element.style.fontWeight = computed.fontWeight;
    element.style.color = computed.color;
    // 含图片（公章 / logo）的格子不能锁死行高，否则 Word / WPS 只露出图片顶部一条
    if (computed.lineHeight.endsWith("px") && !source.querySelector("img")) {
      element.style.lineHeight = computed.lineHeight;
    }
  });
  const sourceImages = Array.from(root.querySelectorAll("img"));
  Array.from(clone.querySelectorAll("img")).forEach((img, idx) => {
    const source = sourceImages[idx];
    if (!source) return;
    const rect = source.getBoundingClientRect();
    if (rect.width && rect.height) {
      img.setAttribute("width", String(Math.round(rect.width)));
      img.setAttribute("height", String(Math.round(rect.height)));
      img.style.width = `${Math.round(rect.width)}px`;
      img.style.height = `${Math.round(rect.height)}px`;
    }
    img.src = source.currentSrc || source.src;
    if (getComputedStyle(source).position === "absolute") {
      // 公章：网页上是绝对定位在格子右上角，Word 里改成靠右浮动
      img.style.position = "static";
      img.setAttribute("align", getComputedStyle(source).left !== "auto" && getComputedStyle(source).right === "auto" ? "left" : "right");
    }
  });

  // 水印（斜着的大字）Word 里没法叠在正文下面，去掉；其余绝对定位的元素（签名线等）改回正常排版
  pairs.forEach(({ element, source }) => {
    if (/watermark/.test(source.className)) { element.remove(); return; }
    if (element.tagName !== "IMG" && getComputedStyle(source).position === "absolute") {
      Object.assign(element.style, { position: "static", left: "", right: "", top: "", bottom: "" });
    }
  });
  // 复选框：网页上是 CSS 画的方框 + ::after 对勾，Word 里换成 ☑ / ☐ 字符
  pairs.forEach(({ element, source }) => {
    if (!source.classList.contains("chk")) return;
    element.textContent = source.classList.contains("checked") ? "☑" : "☐";
    Object.assign(element.style, { border: "none", width: "auto", height: "auto", fontSize: "11pt" });
  });
  // 网页里靠 white-space: pre-wrap 显示的换行（地址、品名等），Word 不认，换成 <br>
  pairs.forEach(({ element, source }) => {
    if (!/^pre/.test(getComputedStyle(source).whiteSpace)) return;
    Array.from(element.childNodes).forEach(node => {
      if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue.includes("\n")) return;
      const fragment = document.createDocumentFragment();
      node.nodeValue.split("\n").forEach((line, i) => {
        if (i > 0) fragment.appendChild(document.createElement("br"));
        fragment.appendChild(document.createTextNode(line.replace(/ {2,}/g, m => "\u00a0".repeat(m.length))));
      });
      node.replaceWith(fragment);
    });
  });
  // 原有的 <table>：列宽、行高都按网页实际尺寸写死（Word 里行高是“最小值”，内容多时仍会撑开）
  pairs.forEach(({ element, source }) => {
    if (element.tagName === "TABLE") {
      const width = Math.round(source.getBoundingClientRect().width);
      element.setAttribute("width", String(width));
      element.style.width = `${width}px`;
      element.style.tableLayout = "fixed";
    } else if (element.tagName === "TD" || element.tagName === "TH") {
      const rect = source.getBoundingClientRect();
      element.style.height = `${contentHeight(source, getComputedStyle(source))}px`;
      if (!source.colSpan || source.colSpan === 1) {
        element.setAttribute("width", String(Math.round(rect.width)));
        element.style.width = `${Math.round(rect.width)}px`;
      }
    }
  });
  // “纸张”本身的白底 / 阴影不用包成表格，后面会整个重置
  convertLayoutForWord(pairs.filter(({ element }) => clone.contains(element)),
    element => !!pageSelector && element.matches(pageSelector));
  // Word / WPS 会把表格往左移“单元格左内边距”那么多，好让文字和正文对齐；
  // 各表格内边距不同（6 / 10 / 12px）就会导致左右边缘错开，这里统一成同一个左右内边距
  // 里面套着整张表格的格子（如提单的货物表）不加内边距，否则里面的表格会被挤出右边
  clone.querySelectorAll("td, th").forEach(cell => {
    const pad = cell.querySelector("table") ? "0" : "6px";
    cell.style.paddingLeft = pad;
    cell.style.paddingRight = pad;
  });
  clone.style.background = "#fff";
  clone.style.minHeight = "0";
  if (pageSelector) {
    // 网页上的“纸张”是 210mm 宽 + 内边距；Word 里由分节的纸张和页边距负责
    clone.querySelectorAll(pageSelector).forEach((page, idx) => {
      Object.assign(page.style, { width: "auto", minHeight: "0", padding: "0", margin: "0", boxShadow: "none" });
      // 多页文件（如提单正面 + 背面条款）：每张纸之间插分页符
      if (idx > 0) {
        const pageBreak = document.createElement("br");
        pageBreak.setAttribute("clear", "all");
        pageBreak.setAttribute("style", "page-break-before:always;mso-break-type:page-break");
        page.parentNode.insertBefore(pageBreak, page);
      }
    });
  }
  // 网页“纸张”的内容区和 Word 页面（A4 减页边距）不一定一样宽（比如纸张是 content-box，
  // 210mm 再加内边距）；表格宽度都是按网页像素写死的，这里按比例缩到 Word 页面里，避免右边被裁掉
  const pageSource = (pageSelector && root.querySelector(pageSelector)) || root;
  const pageStyle = getComputedStyle(pageSource);
  const pageInner = pageSource.clientWidth - parseFloat(pageStyle.paddingLeft || 0) - parseFloat(pageStyle.paddingRight || 0);
  const wordInner = (210 - 2 * (parseFloat(pageMargin) || 14)) * 96 / 25.4;
  const widthScale = pageInner > 0 ? Math.min(1, wordInner / pageInner) : 1;
  if (widthScale < 0.995) {
    clone.querySelectorAll("table, td, th, col").forEach(element => {
      const attr = element.getAttribute("width");
      if (attr && /^\d+(\.\d+)?$/.test(attr)) element.setAttribute("width", String(Math.round(Number(attr) * widthScale)));
      if (element.style.width.endsWith("px")) element.style.width = `${Math.round(parseFloat(element.style.width) * widthScale)}px`;
    });
  }
  // Word 按 pt 排版，网页样式里的 px 换成 pt（1px = 0.75pt），字号和间距才和网页一致
  clone.querySelectorAll("[style]").forEach(element => {
    const style = element.getAttribute("style");
    if (style.includes("px")) {
      element.setAttribute("style", style.replace(/(-?\d*\.?\d+)px/g, (_, n) => `${+(Number(n) * 0.75).toFixed(2)}pt`));
    }
    // 行高按网页锁死（含图片的格子前面已跳过 line-height）
    if (/line-height:\s*[\d.]+pt/.test(element.getAttribute("style"))) {
      element.setAttribute("style", `${element.getAttribute("style")};mso-line-height-rule:exactly`);
    }
  });
  clone.querySelectorAll("table").forEach(table => {
    if (table.style.width === "100%") table.setAttribute("width", "100%");
    table.setAttribute("cellspacing", "0");
  });

  const headStyles = Array.from(
    document.head.querySelectorAll('style, link[rel="stylesheet"]')
  ).map(element => element.outerHTML).join("\n");
  const safeFilename = sanitizeFileStem(filename);
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" /><base href="${location.origin}/" /><title>${escapeHtml(safeFilename)}</title>
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
    ${headStyles}
    <style>
      @page WordSection1{size:21cm 29.7cm;margin:${pageMargin};mso-page-orientation:portrait}
      div.WordSection1{page:WordSection1}
      html,body{margin:0;background:#fff}
    </style>
    </head><body><div class="WordSection1">${clone.outerHTML}</div></body></html>`;
  downloadBlob(new Blob(["\ufeff", doc], { type: "application/msword;charset=utf-8" }), `${safeFilename}.doc`);
}

export function printDocument(filename) {
  const previousTitle = document.title;
  let restored = false;
  const restoreTitle = () => {
    if (restored) return;
    restored = true;
    window.removeEventListener("afterprint", restoreTitle);
    document.title = previousTitle;
  };

  document.title = sanitizeFileStem(filename);
  window.addEventListener("afterprint", restoreTitle, { once: true });
  setTimeout(() => window.print(), 50);
  setTimeout(restoreTitle, 60000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
