// BLOriginal.jsx — 提单正本
// 复用 BLLayout 共享布局，传入 mode="original"
import BLLayout from "./BLLayout.jsx";

export default function BLOriginal({ shipmentId, onBack, variant }) {
  return <BLLayout shipmentId={shipmentId} onBack={onBack} mode="original" variant={variant} />;
}
