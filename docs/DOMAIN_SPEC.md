# Bansar OPS — 业务领域规格（Domain Spec）

> **用途**：这份文档是 bansar-ops 系统**沉淀的业务规则**的可移植规格，给将来重做的**多租户商用产品**当蓝图用。
> 它描述「系统做什么、规则是什么」，**不绑定** React / Supabase / 当前 UI——那些是可抛弃的实现。
>
> **怎么用**：新产品从底座重做时，照这份规格设计领域模型、API、数据库，而不是对着旧 `.jsx` 考古。
> 当前实现的源文件位置在每节末尾标注，供需要时回查验证。
>
> 维护：`生成于 2026-06-02`，基于当时代码 + 线上库。规则若与现行为冲突，以代码为准并回来更新本文件。

---

## 0. 给新产品的三条总则

1. **UI 全抛，逻辑全留**。值钱的是本文档里的规则 + 数据库 schema + 踩过的坑，不是界面。
2. **多租户是第一块砖**。现系统是单公司自用，无 `tenant_id`。商用必须每表带租户、RLS 按租户隔离——见 §11，事后补极痛。
3. **逻辑进服务层，别埋进页面**。现系统大量规则写在 `.jsx` 里（这是重写最大的障碍）。新系统把领域逻辑做成框架无关模块（现系统 `src/lib/spot-inventory.js` 是正确范式：逻辑在 lib，UI 只调用）。

---

## 1. 系统概览与限界上下文

货代（货运代理）操作系统，服务**海运出口**业务。两个前端共享同一后端：

- **OPS**（内部）：录单、订舱、现舱、费用、账单、收付款、开票、单证。
- **Portal**（外部客户/海外代理）：看自己的订单、单据、应收账单、下载发票。

限界上下文（建议新系统按此分模块）：

| 上下文 | 职责 | 核心实体 |
|--------|------|---------|
| 订单 Orders | 海运出口作业全生命周期 + SOP | shipments, cargo_items, shipment_containers |
| 现舱 Spot | 舱位库存、划给客户、退关改配 | spot_bookings, spot_booking_cancellations |
| 财务 Finance | 费用→账单→对账单→发票→收付款 | charges, bills, statements, invoices, payments |
| 开票 Invoicing | 开票申请工作流（含拆票） | invoice_requests, invoice_charges/bills |
| 主数据 Master | 客商、港口、船司、费用项、汇率 | customers, ports, carriers, charge_items, exchange_rates |
| 权限 IAM | 角色、数据范围、租户隔离 | roles, user_profiles |
| 集成 Integration | 船司 ETA/截单、站内通知 | shipment_notifications + edge functions |

数据规模参考（线上现状）：shipments ~739、charges ~1981、payments ~1803、bills ~70、spot_bookings ~44、customers ~274。

---

## 2. 核心领域模型

实体清单（现表名 → 含义）：

- **shipments** — 海运出口订单（核心聚合根），~107 字段
- **cargo_items** — 货物明细行（品名/件毛体/HS）
- **shipment_containers** — 集装箱（箱号/封号/箱型/VGM），唯一键 `(booking_no, container_no)`
- **container_items** — Portal 装箱明细（OPS→Portal 同步），唯一键 `shipment_id`
- **spot_bookings** — 现舱（舱位库存）
- **spot_booking_cancellations** — 退关/改配留痕
- **charges** — 费用行（应收/应付）
- **bills** — 账单（一组费用的结算单元）
- **statements** — 对账单（按期间汇总账单）
- **invoices / invoice_bills / invoice_charges** — 发票及其与账单/费用的关联
- **payments / payment_bills** — 收付款及核销分摊
- **invoice_requests / _bills / _files** — 开票申请工作流
- **customers** — 客商（多类型：客户/供应商/船东/订舱代理/海外代理/车队/报关行/仓库）；suppliers/overseas_agents 为细分
- **charge_items** — 费用类型字典（name_zh/name_en/code）
- **exchange_rates** — 汇率（到 CNY）
- **charge_templates / charge_template_items** — 费用模板
- **roles** — 角色定义（数据驱动 RBAC）
- **user_profiles** — 用户（含 role、customer_id）
- **shipment_notifications** — 站内通知（ETA 变更/截单临期）
- **shipment_attachments** — 运营附件（宽松可见）
- **shipment_documents** — 单证（严格按 customer_id）

> **命名口径警告（新系统务必统一）**：`direction` 字段在 **charges 存中文「应收/应付」**，而在 **bills/payments/invoices/statements 存英文「AR/AP」**。这是历史遗留坑（见 §12）。新系统：**全用 `AR`/`AP` 枚举**。

---

## 3. 订单（海运出口）

### 3.1 订单号生成
- 格式：`BSOEF` + `YYMM`（年后两位+月两位）+ `00001`（5 位序号），分票加 `-N` 后缀。
- 正则：`^BSOEF\d{4}\d{5}(?:-\d+)?$`
- 算法：取当月最大序号 + 1，补零到 5 位；批量建单时递增分配。
- 示例：`BSOEF2601000001`、`BSOEF2601000001-3`（第 1 单的第 3 个分票）。
- **新系统建议**：前缀、位数应做成**租户级可配置**（白标），不写死 `BSOEF`。

### 3.2 生命周期 lifecycle
- 取值：`处理中` → `已完结` → `已关闭`。
- **锁定**：`lifecycle ∈ {已完结, 已关闭}` 时 `isLocked=true`，禁止编辑/删除/改 SOP/导入导出/工作流确认。

### 3.3 SOP 工作流（5 节点）
每个节点 = shipments 上一个状态字段 + 枚举 + 「done」判定：

| 节点 | 字段 | 完成值（done） | 备注 |
|------|------|---------------|------|
| 验货 QC | `qc_status` | 验货通过 | 有"验货未通过"危险态 |
| 订舱 Booking | `space_status` | 已订舱 | 见 §4 现舱联动 |
| HBL | `hbl_status` | 已放单/已电放 | **仅当 `has_hbl=true` 才出现** |
| MBL | `mbl_status` | 已放单/已电放 | |
| 费用 Finance | `finance_status` | 已销账 | 多阶段（未创建→…→已销账）|

- `applicableNodesFor(shipment)`：`has_hbl=false` 时跳过 HBL 节点。
- 待办统计 = 各节点未 done 的票数。

### 3.4 自拼/拼箱（Console：母单—分票）
- `shipment_type`：`FCL`（整柜单票）/ `LCL`（拼箱单票）/ `Console`（自拼，可拆分票）。
- 母单判定：`shipment_type=Console` 且 order_no **无** `-N` 后缀。
- 分票判定：`Console` 且 order_no **有** `-N`；母单号 = 去掉 `-N`。
- 字段继承（母单保存时同步到分票）：`vessel, voyage, pol/pol_code, pod/pod_code, destination/destination_code, etd, atd`。
- 母单合计（由分票汇总，写回母单字段）：`qty_packages`=Σ整数、`weight`=Σ(3 位小数)、`volume`=Σ(4 位小数）。触发时机：建/删分票、改分票件毛体、改货物明细。
- 删除限制：母单下有分票时禁止删母单（先逐个删分票）。
- 补建母单：分票发现母单缺失时，可从分票复制 booking 级字段重建母单。

### 3.5 业务/揽货类型
- `business_type`：仅 `sea_export` 启用（其余 sea_import/air_*/express/fba 预留禁用）。
- `solicit_type`：`代理货` / `自揽货` / `待订舱`。

来源：`src/lib/constants.js`(SOP_NODES, lifecycle)、`src/lib/shipment-fields.js`(字段白名单)、`src/pages/Orders.jsx`(母单/分票、生命周期)、`src/pages/SpotBookings.jsx`(订单号生成)。

---

## 4. 现舱（Spot Bookings）

### 4.1 模型
- 字段：船期(carrier/vessel/voyage/route/pol/pod/etd/eta)、柜(container_size/type, `total_qty`)、截单(si/vgm/customs/port_cutoff)、价格(purchase_price, sell_price_min/max, currency)、船司侧(booking_no, mbl_no)、关联(partner_id/name=客户, booking_agent_id/name=订舱代理)、status、operator_id。
- 反向关联：`shipments.spot_booking_id → spot_bookings.id`（ON DELETE SET NULL）。

### 4.2 计算式库存（核心）
> **可用舱位 = `total_qty` − Σ(关联 shipments 的 `qty_container`)**

不存"可用数"，实时算。建单占用、删单/退关释放。

### 4.3 状态机
取值：`可售 / 部分已售 / 全部已售 / 已截单 / 已取消`。
- 自动重算 `recalcSpotStatus`：`sold>=total`→全部已售；`sold>0`→部分已售；否则可售。
- **手动锁定**：`已截单`/`已取消` 默认**不被自动重算覆盖**（`LOCKED_STATUSES`）。
- `force=true` 时强制重算——用于「截单后退关」要放开 `已截单` 让腾出的柜重新可售（`已取消` 不放）。

### 4.4 划给客户（allocation）
- 一次可给多个客户批量建单；校验：客户非空、每行柜数≥1、总分配≤剩余。
- 新建 shipment 继承现舱：carrier/vessel/voyage/pol/pod/etd/eta/booking_no/mbl_no，且 `spot_booking_id=spot.id`，并带常量 `business_type=sea_export, shipment_type=FCL, lifecycle=处理中, finance_status=未创建, has_hbl=true, solicit_type=代理货`，自动带客户常用 shipper/consignee/notify。
- 建单后立即 `recalcSpotStatus`。

### 4.5 退关 / 改配 / 部分退关
> **退关 ≠ 删订单**：订单是业务记录（客户/费用/审计挂其上），退关只解除/减少与现舱的占用，订单保留。

`returnSlotToSpot(shipment, {mode})` 三模式：

| 模式 | 对订单做什么 | 现舱重算 |
|------|------------|---------|
| `cancel`（整柜退关）| `spot_booking_id=null`, `space_status=Cancelled`, 盖 `space_released_at` | 旧现舱（若 `已截单` 则 force 放开）|
| `partial`（部分退关）| `qty_container -= returnQty`，仍占用同一现舱 | 旧现舱 |
| `reassign`（改配）| `spot_booking_id`→新现舱，并同步船期/订舱号(carrier/vessel/voyage/pol/pod/etd/eta/booking_no/mbl_no) | 旧 + 新都重算 |

### 4.6 留痕（spot_booking_cancellations）
每次退关/改配写一条审计：源现舱、改配目标、订单、**快照**(order_no/customer/船期)、mode、qty_returned、reason、cancel_fee+currency、operator。**best-effort**（写失败不回滚已完成的退柜）。

### 4.7 订舱号互斥
同一 `booking_no` 不能同时存在于 spot_bookings 和 shipments（建/改现舱时双向校验）。防重复购舱。

### 4.8 `qty_container` 怪癖
- 类型是 **text**（可能 `"1"` / `"2x40HC"` / 空）。
- 统一用 `numQty()` 解析：取前缀整数，无法识别 fallback=1。
- **新系统建议**：拆成结构化 `container_qty:int` + `container_spec`，别再用 text 混存。

来源：`migrations/022,023,025,035`、`src/lib/spot-inventory.js`、`src/pages/SpotBookings.jsx`。

---

## 5. 财务（费用 → 账单 → 对账单 → 发票 → 收付款）

### 5.1 费用 charges
- 关键字段：shipment_id、charge_item_id（费用类型）、`direction`（**中文「应收/应付」**）、partner_id（结算单位）、quantity、unit、unit_price、currency、exchange_rate、tax_rate(%)、status、bill_id、remark、sort_order。
- 金额公式：
  - `amount_total = quantity × unit_price × (1 + tax_rate/100)`
  - `amount_cny = amount_total × exchange_rate`
  - （可持久化；缺失时按公式算）
- status：`draft / confirmed / settled`。
- 规则：**允许负数**（折扣/抵扣）；保存校验必填 = 费用名称 + 结算单位 + 金额（金额非 0）。
- 建账单前校验：所选费用已保存、未绑其他账单、**同结算单位 + 同币种**。

### 5.2 账单 bills
- 字段：bill_no、direction(**AR/AP**)、partner_id、currency、amount_total、`settled_amount`(触发器维护，前端只读)、status、invoice_no、statement_id(**bigint**)。
- 状态：`unsettled / partial / settled / void`（由核销额自动推：≤0 未核销，≥总额 已核销，之间 部分；void 手动）。

### 5.3 对账单 statements
- 按 partner + 期间(period_from/to) 汇总一组 bills（`bills.statement_id`）。
- 可从对账单发起开票申请。解绑 = 清 bills.statement_id + statement 置 void。

### 5.4 发票 invoices
- `invoice_no` 唯一性按 `(invoice_no, direction)`。
- `kind`：`business / non_business`（non_business 仅 admin 可见）。
- 关联：`invoice_bills`（账单维度）、`invoice_charges`（费用维度，拆票用）。
- 拆票：一个开票申请→按税率分组生成多张发票，回写 `charges.invoice_no`，`bills.invoice_no` 多号用 `/` 拼接去重。

### 5.5 收付款 payments
- `payment_no` 由 RPC 生成：`RCV-YYYY-NNNN`(AR) / `PAY-YYYY-NNNN`(AP)，**不可手输**。
- 核销：payment →（payment_bills N:N）→ bills，**触发器自动重算** bills.settled_amount/status。
- 校验：日期非空、金额>0、partner 非空、分摊合计≤本笔、分摊≥0。

### 5.6 汇率 & 多币种
- `exchange_rates`：currency、rate_to_cny、effective_from/to；按生效日取最新。
- 费用选币种自动带汇率（已手填则不覆盖）。

### 5.7 费用模板
- `charge_templates`(partner_id, name, direction, 唯一 (partner_id,name,direction)) + items。
- 选结算单位→套用同方向模板，一次插入整组费用。

来源：`migrations/004(payments),005(templates),006(invoices),029(invoice_split),030(bills/invoices RLS)`、`src/pages/{ChargesList,BillsList,StatementsList,InvoiceEditor,PaymentEditor}.jsx`、`Orders.jsx` 内费用面板。

---

## 6. 开票申请工作流（invoice_requests）
- `request_no`：`IR-YYYY-NNNN`。状态：`pending / completed / rejected / cancelled`。
- 流程：选账单→建申请（校验同结算单位/同币种/全为应收/不重复）→（可上传发票文件）→财务完成开票（拆票 RPC 生成发票+回写）→completed。
- 关键 RPC（SECURITY DEFINER + REVOKE anon）：`create_invoice_request`、`complete_invoice_request[_split]`、`reject/cancel_invoice_request`。
- 权限：完成开票仅 `admin / finance / finance_ar`。

来源：`migrations/027,029`、`src/pages/InvoiceRequestsList.jsx`。

---

## 7. 权限 / 角色 / 数据隔离（RBAC + RLS）

### 7.1 角色（数据驱动，roles 表）
字段：`key, label, is_internal, data_scope(all/ar/ap/none), page_access[]`。系统角色：

| key | 内部? | data_scope | 用途 |
|-----|------|-----------|------|
| admin | ✓ | all | 全权 |
| operator | ✓ | all | 订舱/操作/文档 |
| sales | ✓ | all | 订舱/文档（无费用）|
| finance | ✓ | all | 全部财务 |
| finance_ar | ✓ | ar | 仅应收 + 开票 |
| finance_ap | ✓ | ap | 仅应付（无开票）|
| customer | ✗ | none | Portal：自己的订单+单据 |
| supplier | ✗ | none | Portal：关联订单 |
| overseas_agent | ✗ | none | Portal：可见代理订单 |

### 7.2 三层防御
1. **页面级**（前端）：`canAccessPage(role, page)` 按 `page_access` 白名单。
2. **数据级**（RLS）：内部角色 PERMISSIVE 全权（`current_user_role() = ANY internal_roles()`）；外部客户 `partner_id/customer_id = current_user_customer_id()`。
3. **RPC 级**：SECURITY DEFINER 内手工查角色 + REVOKE anon。

### 7.3 AR/AP 财务隔离（RESTRICTIVE 叠加）
- 在 charges/bills/payments/invoices/statements 等表加 RESTRICTIVE 策略：`data_scope` 非 ar/ap 全放行；为 ar 只见应收、ap 只见应付。
- **注意中英文**：charges 比对中文「应收/应付」，bills/payments/invoices 比对「AR/AP」。

### 7.4 helper（关键，多租户要改）
`current_user_role()`、`current_user_customer_id()`、`current_user_data_scope()`、`internal_roles()`（动态聚合 is_internal 角色）。

来源：`migrations/028(rbac),030`、`src/lib/permissions.js`、`src/App.jsx`。

---

## 8. Portal vs OPS 可见性 + 单证系统
- 同后端、同表、靠 RLS 区分：OPS=内部角色全权；Portal=按 customer_id 过滤。
- 客户只读**应收**账单（`direction=AR AND partner_id=自己`）、只读自己的 `business` 发票。
- **两套单证（坑）**：
  - `shipment_attachments`：**宽松**——能看父 shipment 就能看（`can_see_shipment(customer, customer_id)`）。
  - `shipment_documents` / `invoice_request_files`：**严格**——按 `customer_id`。
  - 后果：客户看不到供应商上传到 attachments 的文件 / 或反之可见性不一致。**新系统统一一套权限模型**。
- 海外代理：`is_internal=false`，可见与其相关的 shipments（靠 can_see_shipment + 冗余 customer 字段）。

---

## 9. 外部集成 + 通知

### 9.1 Maersk ETA/开船自动同步
- 列：`eta_carrier/etd_carrier/atd_carrier`（船司值，始终覆盖）、`eta_synced_at`、`eta_track_status`。人工值与船司值并存，首次同步空则回填，之后人工优先、不一致标红。
- 端点：OAuth2 + `track-and-trace-private/events`（DCSA 里程碑解析：到港 EST/ACT@pod、开船 EST/ACT@pol）。
- 定时：每 6h 批量（pg_cron→pg_net→edge function，`x-cron-key` 鉴权，并发 8，单次≤800 票，按 `eta_synced_at` 最旧优先）。
- 前置：票有 booking_no 或 mbl_no；carrier ∈ MAERSK/SEALAND/MCC。

### 9.2 Maersk 截单提醒（deadlines）
- 列：`si_cutoff/vgm_cutoff/cy_cutoff`、`deadlines_raw(jsonb)`、`deadlines_synced_at/status`。
- 流程：船名→IMO→拉 shipment-deadlines（需 ISOCountryCode/portOfLoad/IMO/voyage）；按本地时间+国家时区→timestamptz。
- 定时：每 12h 批量拉；每小时扫 24h 内临期生成站内通知（同票同字段未处理不重复）。
- **坑**：portOfLoad 要城市英文名、voyage 取后 4 位、429/502/503 退避重试（spike arrest）、首次同步不告警。

### 9.3 站内通知 shipment_notifications
- 字段：shipment_id、kind(eta_change/etd_change/atd_change/deadline_soon)、field、old/new_value、summary、source(maersk_auto/manual/deadline_auto)、is_resolved。
- 仅内部可见；客户不可见。前端铃铛每 60s 刷新。
- 写入走 service_role（edge function 绕 RLS）。

> 集成类**依赖船司授权**：账号未获批/customerCode 不匹配会 403（现状 Invoice Summary 即卡此）。新系统设计成"集成可插拔 + 多船司适配器"。

来源：`migrations/026,031,033,034`、`supabase/functions/_shared/{track,deadlines}.ts`、`track-eta[-batch]`、`track-deadlines-batch`。

---

## 10. 导入 / 导出
导入（输入→产出）：
- **提单 BL**（Maersk PDF 文本）→ mbl/booking/船期/收发货/件毛体/箱封号。
- **舱单 Sino56/兴港**（.xls）→ 船期/箱/货明细 + HBL→分票启发式映射。
- **SI 补料**（Word/Excel）→ 船期/收发货/唛头/HS/条款。
- **装箱单**（.xlsx）→ 仅写 cargo_items。
- **现舱**（.xlsx）→ spot_bookings（按 booking_no 去重）。
- **客商**（.xlsx）→ customers/suppliers/agents（按 code/name+type upsert）。

导出：
- **草稿提单**（SI Format Excel 模板填充）。
- **Sino56 56 舱单**（.xls，沿用 56 系统布局）。

---

## 11. ⚠️ 多租户改造清单（新产品底座关键）

现系统单租户、无 `tenant_id`。商用必做：

1. 新增 `tenants` 表；用户↔租户↔角色：`user_tenant_roles(user_id, tenant_id, role)`（一人可属多租户/多角色）。
2. **所有业务表加 `tenant_id`**（shipments/charges/bills/spot_bookings/...），含冗余可见性字段。
3. **所有 RLS 的 USING/WITH CHECK 加 `tenant_id = current_tenant_id()`**；helper 改 `current_user_role(tenant)`、`internal_roles(tenant)`。
4. **RPC 内权限检查加租户校验**（否则跨租户改数据）。
5. **Storage 路径加租户前缀** `{tenant_id}/{customer_id}/...`（否则可猜路径越权）。
6. 白标/可配置：订单号规则、费用模板、本币、公司抬头、启用的业务类型——做成租户配置，别写死。
7. 风险点：任何忘加 `tenant_id` 条件的查询/RPC/signed-URL 都是跨租户数据泄露。建议用「默认拒绝 + 强制租户上下文」的基类封装，杜绝裸查询。

---

## 12. ⚠️ 已知坑 / 技术债（新系统要规避）

1. **`direction` 中英文不统一**：charges=中文「应收/应付」，bills/payments/invoices/statements=「AR/AP」。曾导致全局费用列表查不到数据。→ 新系统**全用 AR/AP**。
2. **`qty_container` 是 text**（"2x40HC"），靠 `numQty` 兜底。→ 拆成结构化字段。
3. **两套单证可见性**（attachments 宽松 / documents 严格）不一致。→ 统一权限模型。
4. **bills.status 历史枚举混用**（曾有 draft/issued/paid 与 unsettled/partial/settled/void 两套）。→ 单一状态机。
5. **6 张表 RLS 未开**：charge_items, exchange_rates, pkg_units, cargo_types, charge_templates, charge_template_items（anon 可读改，含报价模板）。→ 新系统所有表默认开 RLS。
6. **业务逻辑埋在 .jsx**（含财务计算、校验、状态机）。→ 进服务层 + 加测试。
7. **派生值口径分散**：amount_total/amount_cny/settled_amount 有时存库有时现算。→ 明确"唯一计算源"（DB 生成列或服务层），前端只读。
8. **无 TypeScript、无自动化测试**。→ 新系统核心域上 TS + 测试。
9. **单据/导入解析器对船司格式强耦合**（Maersk PDF/Sino56 布局）。→ 适配器化。

---

## 13. 枚举速查

- lifecycle：`处理中 / 已完结 / 已关闭`
- spot status：`可售 / 部分已售 / 全部已售 / 已截单 / 已取消`
- shipment_type：`FCL / LCL / Console`
- solicit_type：`代理货 / 自揽货 / 待订舱`
- charges.direction：`应收 / 应付`（**坑**）；其他财务表 direction：`AR / AP`
- charges.status：`draft / confirmed / settled`
- bills.status：`unsettled / partial / settled / void`
- invoices.kind：`business / non_business`
- payments：`active / voided`；payment_no：`RCV-YYYY-NNNN` / `PAY-YYYY-NNNN`
- invoice_requests.status：`pending / completed / rejected / cancelled`
- 退关 mode：`cancel / partial / reassign`
- 角色：`admin / operator / sales / finance / finance_ar / finance_ap / customer / supplier / overseas_agent`
- data_scope：`all / ar / ap / none`
- SOP 字段：`qc_status / space_status / hbl_status / mbl_status / finance_status`

---

*本规格基于 2026-06-02 的代码与线上库提炼，覆盖订单/现舱/财务/开票/权限/集成/单证七大域。新产品按此搭建，UI 重新设计、底座做多租户即可与现系统功能对齐。*
