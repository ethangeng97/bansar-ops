// ============================================================================
// excel-export.js — 把数组导成 .xlsx 下载
// 用法:
//   await exportToXlsx({
//     filename: "shipments.xlsx",
//     sheetName: "作业列表",
//     columns: [{ key: "order_no", label: "作业号", width: 18 }, ...],
//     rows: [{ order_no: "...", ... }, ...],
//   });
// xlsx 是动态 import 的，按需加载（仅打开 56 舱单 / 列表导出时才下载 chunk）
// ============================================================================

let _xlsxPromise = null;
async function getXLSX() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx");
  return _xlsxPromise;
}

export async function exportToXlsx({ filename = "export.xlsx", sheetName = "Sheet1", columns, rows }) {
  const XLSX = await getXLSX();
  // 表头
  const header = columns.map(c => c.label || c.key);
  // 数据
  const data = (rows || []).map(r => columns.map(c => {
    let v = r[c.key];
    if (typeof c.format === "function") v = c.format(v, r);
    if (v == null) return "";
    return v;
  }));
  const aoa = [header, ...data];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 列宽
  ws["!cols"] = columns.map(c => ({ wch: c.width || 14 }));
  // 表头加粗（XLSX community 不支持太多 style，简单处理）
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// parseXlsx — 把上传的 .xls / .xlsx 解成 row 数组
// 用法:
//   const rows = await parseXlsx(file);  // [{header1: val, header2: val, ...}, ...]
// 默认以第一行为 header
// ============================================================================
export async function parseXlsx(file) {
  const XLSX = await getXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // 用第一行作为 header，缺失值返回空串
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}
