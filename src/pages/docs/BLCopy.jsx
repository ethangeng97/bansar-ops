// BLCopy.jsx — 提单副本
// 复用 BLLayout 共享布局，传入 mode="copy"
import BLLayout from "./BLLayout.jsx";

export default function BLCopy({ shipmentId, onBack, variant }) {
  return <BLLayout shipmentId={shipmentId} onBack={onBack} mode="copy" variant={variant} />;
}
