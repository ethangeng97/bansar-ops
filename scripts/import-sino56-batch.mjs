// ============================================================================
// import-sino56-batch.mjs — 批量把 Sino56 .xls 舱单数据写入对应 shipments
//
// 按 mbl_no 匹配 shipments 行：
//   - PATCH shipments 主字段（vessel/voyage/pod/booking_no/shipper/...，白名单过滤）
//   - INSERT shipment_containers（每箱一行；parse 40HC → size=40 + type=HC）
//   - INSERT cargo_items（每条货物明细一行；本批 5 份都没有明细，所以实际跳过）
//
// 用法:
//   预览：    node scripts/import-sino56-batch.mjs ~/Desktop/bl
//   写入：    SUPABASE_SERVICE_KEY=eyJ... node scripts/import-sino56-batch.mjs ~/Desktop/bl --apply
//   替换：    SUPABASE_SERVICE_KEY=eyJ... node scripts/import-sino56-batch.mjs ~/Desktop/bl --replace
//             （--replace 在 INSERT 前先 DELETE 该 shipment 的 containers + cargo_items）
// ============================================================================
import fs from "fs";
import path from "path";
import { parseSino56Manifest, flattenSino56ForApply } from "../src/lib/sino56-manifest.js";
import { filterShipmentPayload } from "../src/lib/shipment-fields.js";

const SUPABASE_URL = "https://pewdvheoaqofmzwhwwvu.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY || "";

const args = process.argv.slice(2);
const apply = args.includes("--apply") || args.includes("--replace");
const replace = args.includes("--replace");
const folder = (args.find(a => !a.startsWith("--")) || "~/Desktop/bl").replace(/^~/, process.env.HOME);

if (apply && !KEY) {
  console.error("✗ --apply / --replace 需要 SUPABASE_SERVICE_KEY 环境变量");
  process.exit(1);
}

async function sb(p, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${p} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function parseSize(t) {
  const m = String(t || "").match(/^(\d{2})(.*)$/);
  return m ? { container_size: m[1], container_type: m[2] || "GP" } : { container_size: null, container_type: t || null };
}

const files = fs.readdirSync(folder).filter(f => /\.xls$/i.test(f)).sort();
if (files.length === 0) { console.error("✗ 没有 .xls 文件：" + folder); process.exit(1); }

console.log(`📂 ${folder} — ${files.length} 个文件`);
console.log(`📋 模式：${apply ? (replace ? "写入 (REPLACE)" : "写入 (APPEND)") : "预览 (dry-run)"}\n`);

let okCount = 0, skipCount = 0, failCount = 0;
const summary = [];

for (const f of files) {
  console.log("─".repeat(72));
  console.log(`📄 ${f}`);
  try {
    const buf = fs.readFileSync(path.join(folder, f));
    const data = await parseSino56Manifest(buf);
    const { fields, extras } = flattenSino56ForApply(data);

    if (!data.mbl_no) { console.log("  ✗ 文件里没有 MBL"); failCount++; continue; }

    // 查 shipment
    const ships = apply || !apply
      ? await (async () => {
          if (!KEY && !apply) {
            // 预览也想看 shipment 状态，先用 publishable key（如果有 RLS 限制可能查不到，那也只是预览缺失）
            return null;
          }
          return await sb(`/shipments?mbl_no=eq.${encodeURIComponent(data.mbl_no)}&select=id,order_no,mbl_no,vessel,voyage,pod,container_no,seal_no,qty_packages,weight,volume`);
        })()
      : null;

    let ship = null;
    if (ships && ships.length === 1) ship = ships[0];
    else if (ships && ships.length > 1) { console.log(`  ✗ 找到 ${ships.length} 条 shipments 匹配 mbl_no=${data.mbl_no}，请人工确认`); failCount++; continue; }
    else if (ships && ships.length === 0) { console.log(`  ✗ shipments 表里没有 mbl_no=${data.mbl_no}`); failCount++; continue; }

    if (ship) console.log(`  → shipment ${ship.order_no} (id=${ship.id.slice(0, 8)}…)`);
    else console.log(`  → MBL=${data.mbl_no} (未查询 shipment，需 service key)`);

    // 准备 patch
    const cleanFields = filterShipmentPayload(fields, { silent: true });
    console.log(`  字段：${Object.entries(cleanFields).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(", ")}`);
    console.log(`  集装箱：${extras.containers.length} 个；货物明细：${extras.cargoLines.length} 条`);

    if (!apply) { okCount++; summary.push(`✓ ${data.mbl_no} (preview)`); continue; }

    if (!ship) { failCount++; continue; }

    // ===== APPLY =====
    // 1. shipments PATCH
    await sb(`/shipments?id=eq.${ship.id}`, {
      method: "PATCH",
      body: JSON.stringify(cleanFields),
    });
    console.log("  ✓ shipments 主字段已更新");

    // 2. shipment_containers
    if (replace) {
      await sb(`/shipment_containers?shipment_id=eq.${ship.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      console.log("  ✓ 已删除旧 shipment_containers");
    }
    if (extras.containers.length > 0) {
      const rows = extras.containers.map((c, i) => {
        const { container_size, container_type } = parseSize(c.container_type);
        return {
          shipment_id: ship.id,
          container_size,
          container_type,
          qty: 1,
          container_no: c.container_no || null,
          seal_no: c.seal_no || null,
          cargo_qty: c.qty || null,
          cargo_weight: c.weight || null,
          cargo_volume: c.volume || null,
          sort_order: i,
        };
      });
      await sb(`/shipment_containers`, { method: "POST", body: JSON.stringify(rows) });
      console.log(`  ✓ 插入 ${rows.length} 个 shipment_containers`);
    }

    // 3. cargo_items
    if (replace) {
      await sb(`/cargo_items?shipment_id=eq.${ship.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      console.log("  ✓ 已删除旧 cargo_items");
    }
    if (extras.cargoLines.length > 0) {
      const rows = extras.cargoLines.map((cl, i) => ({
        shipment_id: ship.id,
        hbl_no: cl.hbl_no || data.mbl_no || null,
        container_no: cl.container_no || null,
        seal_no: cl.seal_no || null,
        container_type: cl.container_type || null,
        product_name_en: cl.product_name_en || null,
        hs_code: cl.hs_code || null,
        qty: cl.qty != null ? parseInt(cl.qty) : null,
        package_unit: cl.package_unit || "CARTONS",
        gross_weight: cl.gross_weight != null ? parseFloat(cl.gross_weight) : null,
        volume: cl.volume != null ? parseFloat(cl.volume) : null,
        marks: cl.marks || null,
        un: cl.un || null,
        cl: cl.cl || null,
        sort_order: i + 1,
      }));
      await sb(`/cargo_items`, { method: "POST", body: JSON.stringify(rows) });
      console.log(`  ✓ 插入 ${rows.length} 条 cargo_items`);
    }

    okCount++;
    summary.push(`✓ ${data.mbl_no} → ${ship.order_no}`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failCount++;
    summary.push(`✗ ${f}: ${e.message}`);
  }
}

console.log("─".repeat(72));
console.log(`完成：${okCount} 成功 / ${skipCount} 跳过 / ${failCount} 失败`);
summary.forEach(l => console.log("  " + l));
