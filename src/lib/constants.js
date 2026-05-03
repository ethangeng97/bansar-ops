export const BUSINESS_TYPES = [
  { key: "sea_export", label: "海运出口", labelEn: "Sea Export", enabled: true },
  { key: "sea_import", label: "海运进口", labelEn: "Sea Import", enabled: false },
  { key: "air_export", label: "空运出口", labelEn: "Air Export", enabled: false },
  { key: "air_import", label: "空运进口", labelEn: "Air Import", enabled: false },
  { key: "express",    label: "国际快递", labelEn: "Express", enabled: false },
  { key: "fba",        label: "FBA", labelEn: "FBA", enabled: false },
];

export const SHIPMENT_TYPES = [
  { key: "FCL",     label: "整箱 FCL" },
  { key: "LCL",     label: "拼箱 LCL" },
  { key: "Console", label: "自拼柜 Console" },
];

export const SERVICE_TYPES = [
  { key: "booking",    label: "订舱", labelEn: "Booking" },
  { key: "trucking",   label: "拖车", labelEn: "Trucking" },
  { key: "customs",    label: "报关", labelEn: "Customs" },
  { key: "warehouse",  label: "仓储", labelEn: "Warehouse" },
  { key: "clearance",  label: "清关", labelEn: "Clearance" },
  { key: "delivery",   label: "派送", labelEn: "Delivery" },
];

export const CARGO_TYPES = [
  { key: "general",    label: "普货", labelEn: "General" },
  { key: "dangerous",  label: "危险品", labelEn: "Dangerous" },
  { key: "oversize",   label: "超限货物", labelEn: "Oversize" },
  { key: "reefer",     label: "冷藏货", labelEn: "Reefer" },
  { key: "breakbulk",  label: "散杂货", labelEn: "Break Bulk" },
];

export const TRADE_TERMS = ["FOB", "CIF", "EXW", "CFR", "DDP", "DAP", "FCA", "CPT", "CIP", "DAT"];
export const CONTAINER_TYPES = ["20GP", "40GP", "40HQ", "45HQ", "20RF", "40RF"];
export const CONTAINER_OWNERS = ["COC", "SOC"];
export const BL_TYPES = ["Original", "Telex", "SWB"];
export const FREIGHT_TERMS = ["Prepaid", "Collect", "3rd Party"];
export const TRANSPORT_TERMS = ["CY-CY", "SD-SD", "SD-CY", "CY-SD"];

export const STATUS_CONFIGS = {
  qc_status:     { label: "QC Status",     options: ["QC Approved", "QC Reject", "Loading First", "Waiting QC Report", "Under Review", "Supplier QC Self"] },
  space_status:  { label: "Space Status",  options: ["Booked", "Wait Confirm", "Wait Info", "Cancelled"] },
  local_payment: { label: "Payment",       options: ["Paid", "Waiting", "Partial", "N/A"] },
  telex_release: { label: "Telex Release", options: ["Done", "Pending", "N/A"] },
  bl_status:     { label: "B/L Status",    options: ["Done", "Draft", "Pending", "Amendment"] },
};

export const STATUS_COLORS = {
  "QC Approved": "#10b981", "QC Reject": "#ef4444", "Loading First": "#f59e0b",
  "Waiting QC Report": "#6366f1", "Under Review": "#8b5cf6", "Supplier QC Self": "#94a3b8",
  "Booked": "#10b981", "Wait Confirm": "#f59e0b", "Wait Info": "#6366f1", "Cancelled": "#ef4444",
  "Paid": "#10b981", "Waiting": "#f59e0b", "Partial": "#6366f1", "N/A": "#94a3b8",
  "Done": "#10b981", "Pending": "#f59e0b", "Draft": "#6366f1", "Amendment": "#f59e0b",
  "FOB": "#0ea5e9", "CIF": "#8b5cf6", "EXW": "#f59e0b", "DDP": "#10b981",
};

// ═══════════════════════════════════════════════════════════════
// SOP 节点定义（5 个）+ 状态枚举
// 用于：Portal 待办列表、订单详情 SOP 进度 tab、列表筛选
// ═══════════════════════════════════════════════════════════════

export const SOP_NODES = [
  {
    code: "qc",
    zh: "验货",
    en: "QC Inspection",
    field: "qc_status",
    icon: "check",
    options: [
      { v: "未验货",     en: "Not Arranged",  done: false },
      { v: "审核中",     en: "Under Review",  done: false },
      { v: "验货未通过", en: "QC Rejected",   done: false, danger: true },
      { v: "验货通过",   en: "QC Approved",   done: true },
    ],
  },
  {
    code: "booking",
    zh: "订舱",
    en: "Booking",
    field: "space_status",
    icon: "ship",
    options: [
      { v: "未订舱", en: "Not Booked", done: false },
      { v: "已订舱", en: "Booked",     done: true  },
    ],
  },
  {
    code: "hbl",
    zh: "HB提单",
    en: "HB/L",
    field: "hbl_status",
    icon: "filelist",
    requiresHbl: true,         // 仅当 has_hbl=true 时显示
    options: [
      { v: "未签单", en: "Not Issued",      done: false },
      { v: "已签单", en: "B/L Signed",      done: false },
      { v: "已放单", en: "B/L Released",    done: true  },
      { v: "已电放", en: "Telex Released",  done: true  },
    ],
  },
  {
    code: "mbl",
    zh: "MB提单",
    en: "MB/L",
    field: "mbl_status",
    icon: "file",
    options: [
      { v: "未签单", en: "Not Issued",      done: false },
      { v: "已签单", en: "B/L Signed",      done: false },
      { v: "已放单", en: "B/L Released",    done: true  },
      { v: "已电放", en: "Telex Released",  done: true  },
    ],
  },
  {
    code: "finance",
    zh: "费用",
    en: "Finance",
    field: "finance_status",
    icon: "dollar",
    options: [
      { v: "未创建",       en: "Not Created",      done: false },
      { v: "已创建",       en: "Created",          done: false },
      { v: "对账中",       en: "Reconciling",      done: false },
      { v: "费用已确认",   en: "Confirmed",        done: false },
      { v: "已开票",       en: "Invoiced",         done: false },
      { v: "已销账",       en: "Settled",          done: true  },
    ],
  },
];

// 给一个状态值，返回它在该节点选项列表里是不是 "done" 状态
export function isNodeDone(node, value) {
  if (!value) return false;
  const opt = node.options.find(o => o.v === value);
  return !!(opt && opt.done);
}

// 返回订单在该节点的当前状态（值 + 可读 label + done 标志）
export function nodeStatusOf(shipment, node) {
  const v = shipment[node.field];
  const opt = node.options.find(o => o.v === v);
  return {
    value: v || node.options[0].v,    // 没值就用第一个选项作为默认
    label: opt?.v || node.options[0].v,
    en: opt?.en || node.options[0].en,
    done: !!(opt && opt.done),
    danger: !!(opt && opt.danger),
  };
}

// 给定订单，返回需要在 SOP 进度里展示的节点列表（HBL 需 has_hbl=true 才显示）
export function applicableNodesFor(shipment) {
  return SOP_NODES.filter(n => !n.requiresHbl || shipment.has_hbl);
}

// ═══════════════════════════════════════════════════════════════
// 订单生命周期 lifecycle
// ═══════════════════════════════════════════════════════════════

export const LIFECYCLE = {
  PROCESSING: { v: "处理中", en: "Processing", color: "#52c41a" },
  COMPLETED:  { v: "已完结", en: "Completed",  color: "#1990FF" },
  CLOSED:     { v: "已关闭", en: "Closed",     color: "#888888" },
};

export function lifecycleOf(shipment) {
  const v = shipment.lifecycle || "处理中";
  if (v === "已完结") return LIFECYCLE.COMPLETED;
  if (v === "已关闭") return LIFECYCLE.CLOSED;
  return LIFECYCLE.PROCESSING;
}

