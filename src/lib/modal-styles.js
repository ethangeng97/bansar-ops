// 弹窗按钮通用样式（纯常量，配套 components/tms.jsx 的 ModalShell 使用）
// 单独放一个文件：避免在导出组件的 tms.jsx 里混导出常量触发 react-refresh 规则
export const modalBtnPrimary = {
  padding: "6px 16px", background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
  borderRadius: 3, fontSize: 12, cursor: "pointer", fontWeight: 600,
};
export const modalBtnSecondary = {
  padding: "6px 16px", background: "#fff", color: "#333", border: "1px solid #d9d9d9",
  borderRadius: 3, fontSize: 12, cursor: "pointer",
};
