// DraftBL.jsx — 提单确认件
// 复用 BLLayout 共享布局，传入 mode="draft"
import BLLayout from "./BLLayout.jsx";

export default function DraftBL({ shipmentId, onBack }) {
  return <BLLayout shipmentId={shipmentId} onBack={onBack} mode="draft" />;
}
