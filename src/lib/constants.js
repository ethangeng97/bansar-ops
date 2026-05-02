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
