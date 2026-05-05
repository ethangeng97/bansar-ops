// TelexRelease.jsx — 电放件
// 复用 BLLayout 共享布局，传入 mode="telex"
import BLLayout from "./BLLayout.jsx";

export default function TelexRelease({ shipmentId, onBack }) {
  return <BLLayout shipmentId={shipmentId} onBack={onBack} mode="telex" />;
}
