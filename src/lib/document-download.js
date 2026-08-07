let _pdfDepsPromise = null;

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
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  if (hasPdfPage) pdf.addPage("a4", "p");
  const image = canvas.toDataURL("image/jpeg", 0.92);
  const imageWidthMm = pageWidthMm;
  const imageHeightMm = pageWidthMm * canvas.height / canvas.width;
  if (imageHeightMm <= pageHeightMm) {
    pdf.addImage(image, "JPEG", 0, 0, imageWidthMm, imageHeightMm, undefined, "FAST");
  } else {
    const fittedWidthMm = pageHeightMm * canvas.width / canvas.height;
    const x = Math.max(0, (pageWidthMm - fittedWidthMm) / 2);
    pdf.addImage(image, "JPEG", x, 0, fittedWidthMm, pageHeightMm, undefined, "FAST");
  }
  return true;
}

export async function createDocumentPdfBlob({
  pageSelector,
  root = document,
  scale,
  singlePagePerElement = false,
}) {
  const pages = Array.from(root.querySelectorAll(pageSelector));
  if (pages.length === 0) throw new Error("文件页面还没渲染完成，请稍后再试");

  await waitForAssets(pages);
  const { jsPDF, html2canvas } = await getPdfDeps();
  if (!jsPDF || !html2canvas) throw new Error("PDF 生成组件加载失败");

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  let hasPdfPage = false;
  for (const page of pages) {
    const canvas = await html2canvas(page, {
      scale: scale || Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: false,
      logging: false,
      ignoreElements: element => element.classList?.contains("no-print"),
    });
    hasPdfPage = singlePagePerElement
      ? addCanvasSinglePage(pdf, canvas, hasPdfPage)
      : addCanvasPages(pdf, canvas, collectBreakpoints(page, canvas), hasPdfPage);
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

export async function downloadDocumentPdf({ filename, pageSelector, root = document }) {
  const blob = await createDocumentPdfBlob({ pageSelector, root });
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
