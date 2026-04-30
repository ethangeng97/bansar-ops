let _lang = "zh";
export const setLang = (l) => { _lang = l; };
export const getLang = () => _lang;

const ZH = {
  // Nav
  "Dashboard": "工作台",
  "Orders": "订单",
  "Charges": "费用",
  "Billing": "账单",
  "Payments": "收付款",
  "Documents": "文档",
  "Settings": "设置",
  "Manage": "管理",
  
  // Order
  "New Order": "新建订单",
  "Order List": "订单列表",
  "Order Detail": "订单详情",
  "Order No": "订单编号",
  "Business Type": "业务类型",
  "Cargo Type": "货物类型",
  "Trade Terms": "贸易条款",
  "Service Types": "业务类型",
  
  // Service types
  "Booking": "订舱",
  "Trucking": "拖车",
  "Customs": "报关",
  "Warehouse": "仓储",
  "Clearance": "清关",
  "Delivery": "派送",
  
  // Cargo types
  "General": "普货",
  "Dangerous": "危险品",
  "Oversize": "超限货物",
  "Reefer": "冷藏货",
  "Break Bulk": "散杂货",
  
  // Shipping
  "Carrier": "船公司",
  "Agent": "订舱代理",
  "POL": "起运港",
  "POD": "卸货港",
  "Destination": "目的港",
  "Vessel": "船名",
  "Voyage": "航次",
  "Terminal": "码头",
  "ETD": "ETD",
  "ATD": "ATD",
  "ETA": "ETA",
  "SI Cutoff": "截单时间",
  "CY Cutoff": "截关时间",
  "Container Type": "箱型",
  "Container Owner": "箱类型",
  "QTY": "箱量",
  
  // BL
  "Shipper": "发货人",
  "Consignee": "收货人",
  "Notify Party": "通知方",
  "MBL No": "主提单号",
  "HBL No": "分提单号",
  "BL Type": "提单形式",
  "Original": "正本",
  "Telex Release": "电放",
  "SWB": "海运单",
  "Freight Terms": "付款方式",
  "Freight Prepaid": "预付",
  "Freight Collect": "到付",
  "Freight 3rd Party": "第三方付款",
  "Transport Terms": "运输条款",
  
  // Cargo
  "Container No": "柜号",
  "Seal No": "封号",
  "Description": "品名",
  "Marks": "唛头",
  "Weight (kg)": "毛重 KGS",
  "Volume": "体积 CBM",
  "Packages": "件数",
  
  // Common
  "Save": "保存",
  "Cancel": "取消",
  "Edit": "编辑",
  "Delete": "删除",
  "Back": "返回",
  "Search": "搜索",
  "Filter": "筛选",
  "Export": "导出",
  "Import": "导入",
  "Total": "合计",
  "Status": "状态",
  "Notes": "备注",
  "Type": "类型",
  "Actions": "操作",
  "Supplier": "委托方",
  "Customer": "客户",
  "Loading...": "加载中...",
  "No data": "暂无数据",
  "Confirm": "确认",
  
  // Charges
  "Charge Type": "费用类型",
  "Amount": "金额",
  "Currency": "币种",
  "Direction": "方向",
  "AR": "应收",
  "AP": "应付",
  "Settled": "已销账",
  "Unsettled": "未销账",
  
  // Pagination
  "per page": "每页",
  "records": "条",
  "page": "页",
};

export function t(key) {
  if (_lang === "zh") return ZH[key] || key;
  return key;
}

export function tSupplier(name) {
  return name || "";
}
