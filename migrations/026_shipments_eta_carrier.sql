-- 026_shipments_eta_carrier.sql
-- ETA 自动同步（Phase 1：Maersk 官方 Track & Trace）所需列
--
-- 设计：船司抓回来的 ETA 始终写入 eta_carrier（独立列），不直接覆盖人工填的 eta。
--   - 若 eta 为空 → 同步时顺带把 eta_carrier 复制进 eta（首次自动带出）
--   - 若 eta 已填且与 eta_carrier 不一致 → 不覆盖，UI 对比两列标红提示"与船司不符"
-- eta_synced_at：最近一次成功向船司查询的时间（用于显示"X 前更新"和定时任务筛选）
-- eta_track_status：最近一次查询的结果状态（ok / not_found / unsupported_carrier / error），便于排查

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_carrier      date;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_synced_at    timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_track_status text;
