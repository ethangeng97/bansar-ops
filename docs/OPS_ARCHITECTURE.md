# Bansar OPS System — Architecture & Requirements

## 1. System Overview

### 1.1 Two Frontends, One Database
- **portal.bansargroup.com** — 客户端 + 操作端（录单、装柜、客户查询）
- **ops.bansargroup.com** — 内部操作系统（录单、装柜、费用、账单、收付款、文档）
- **Supabase (shared)** — 同一个数据库，两边数据共享
- 两边都能录单，Portal 继续保留现有功能

### 1.2 Tech Stack
- Frontend: Vite + React 18, no framework dependencies
- Database: Supabase (PostgreSQL + RLS + Auth)
- Deployment: Vercel (new project for ops)
- PDF/Doc: jsPDF / docx.js / xlsx export
- Language: 中英文双语（按角色切换，同 portal）

---

## 2. Module 1: 录单模块

### 2.1 业务类型
1. **海运出口** ← 现在做
   - 整箱 FCL
   - 拼箱 LCL
   - 自拼柜 Console Box（MBL + 多个 HBL）
2. 海运进口 ← 留接口
3. 空运出口 ← 留接口
4. 空运进口 ← 留接口
5. 国际快递 ← 留接口
6. FBA ← 留接口

### 2.2 订单编号
- 自动生成，用户可自定义前缀规则
- 示例：BG-SE-2026-0001（公司前缀-业务类型-年份-序号）
- 在 Manage/Settings 页面配置规则

### 2.3 订单列表页
- 一行一票，带筛选（状态、客户、承运人、日期范围等）
- 每行有勾选框（批量操作）
- 进程状态与 portal 打通（QC、放舱、付款、电放等）
- 分页显示

### 2.4 订单详情页

#### Page 1: 订单信息

**Part 1 — 基本信息**
| 字段 | 说明 |
|------|------|
| 订单编号 | 自动生成 |
| 委托单位 | 即 supplier/委托方 |
| 业务类型 | 订舱/拖车/报关/仓储/清关/派送 |
| 贸易条款 | FOB/CIF/DDP/EXW/CFR/DAP/FCA/CPT/CIP/DAT |
| 货物类型 | 普货/危险品/超限货物/冷藏货/散杂货 |
| 业务编号 PO# | |
| 客户业务编号 Customer PO# | |

**Part 2 — 运输信息**
| 字段 | 说明 |
|------|------|
| 船公司 Carrier | |
| 订舱代理 Agent | 一代代码 |
| 起运港 POL | |
| 卸货港 POD | |
| 目的港 Destination | |
| 箱量 QTY | |
| 箱型 Container Type | 20GP/40GP/40HQ/45HQ/20RF/40RF |
| 箱类型 | COC/SOC |
| 船名 Vessel | |
| 航次 Voyage | |
| 码头 Terminal | |
| ETD/ATD/ETA | |
| 截单时间 SI Cutoff | |
| 截关时间 CY Cutoff | |

**Part 3 — 提单信息**
| 字段 | 说明 |
|------|------|
| Shipper | 发货人 |
| Consignee | 收货人 |
| Notify Party | 通知方 |

**Part 4 — 货物明细**
| 字段 | 说明 |
|------|------|
| B/L No | 主提单号（MBL） |
| HBL No | 分提单号（自拼柜场景） |
| Container No | 柜号 |
| Seal No | 封号 |
| Description | 品名 |
| Marks | 唛头 |
| QTY | 件数 |
| Weight | 毛重 KGS |
| Volume | 体积 CBM |
| 付款方式 | Freight Prepaid / Collect / 3rd Party |
| 运输条款 | CY-CY / SD-SD / SD-CY / CY-SD |
| 提单形式 | 正本 / 电放 Telex / SWB |

#### Page 2: 费用 & 账单（见模块2）

### 2.5 提单结构
- **整箱 FCL**: 一票一个 MBL
- **自拼柜 Console Box**: 一个 MBL + 多个 HBL
  - MBL 挂在 container 层级
  - HBL 挂在每个分票（shipment/分单）层级
  - 费用可以挂在 MBL 或 HBL 层级

---

## 3. Module 2: 费用模块

### 3.1 费用类型管理
- 预设类型：海运费、THC、报关费、文件费、拖车费、仓储费、验货费等
- 可自定义新增（CRUD）
- 每个类型定义：
  - 默认币种（USD/RMB/EUR/GBP）
  - 计算方式（按柜 per container / 按票 per shipment / 按重量 / 按体积 / 固定金额）
  - 按柜型区分价格（20GP/40GP/40HQ/45HQ 各不同价）

### 3.2 费用模板
- 按委托方（supplier/customer）定义模板
- 选择委托方时自动套用模板，生成一组费用
- 可手动调整金额、增删费用项

### 3.3 费用录入
- 方向：应收 AR（客户付给我们）/ 应付 AP（我们付给船司/供应商）
- 每条费用：费用类型 + 金额 + 币种 + 方向 + 关联对象（container 或 shipment）
- 状态：未结 / 已开票 / 已销账

### 3.4 币种
- RMB（主要）、USD、EUR、GBP
- 每条费用独立记录币种
- 对账单按币种分组显示

### 3.5 账单管理
- **单票对账单**：一个 shipment/container 的所有费用汇总
- **月账单**：按客户 + 月份汇总所有费用
- 状态：草稿 / 已确认 / 已发送

### 3.6 开票记录
- 录入发票号、开票日期、金额
- 关联到对账单或具体费用
- 完成名义开票

### 3.7 收付款记录
- 记录每笔收款/付款：日期、金额、币种、付款方/收款方、银行信息
- 关联到具体费用或账单

### 3.8 核销（销账）
- 将收付款记录与具体费用匹配
- 一笔付款可以核销多条费用
- 一条费用可以被多笔付款部分核销
- 显示未核销余额

---

## 4. 文档生成

### 4.1 文档类型
| 文档 | 格式 | 说明 |
|------|------|------|
| 提单确认件 | PDF | BL confirmation |
| 装箱单 | PDF/Excel | Packing list |
| 单票对账单 | PDF/Excel | Debit note per shipment |
| 月账单 | PDF/Excel | Monthly statement |
| 报关单 | PDF | Customs declaration |

### 4.2 实现方式
- HTML 模板 + 数据填充 → 渲染为 PDF/Word/Excel
- 模板可自定义（后续）

---

## 5. Database Schema (New Tables for OPS)

### 5.1 费用相关
```
charge_types        — 费用类型（预设+自定义）
charge_templates    — 按客户的费用模板
charges             — 核心费用表（AR/AP + 金额 + 币种 + 关联）
currencies          — 币种（RMB/USD/EUR/GBP）
```

### 5.2 账单相关
```
invoices            — 对账单/月账单
invoice_items       — 账单明细（关联 charges）
billing_records     — 开票记录（发票号等）
```

### 5.3 收付款相关
```
payments            — 收付款记录
settlements         — 核销记录（payment ↔ charge）
```

### 5.4 文档相关
```
documents           — 生成的文档记录
document_templates  — 模板定义
```

### 5.5 订单编号相关
```
order_sequences     — 编号序列（按前缀规则）
order_number_rules  — 编号规则配置
```

### 5.6 订单扩展（在现有 shipments 表上扩展）
```
shipments 新增字段:
  - order_no          — 系统订单编号
  - business_type     — 业务类型
  - cargo_type        — 货物类型
  - service_types     — 业务类型（订舱/拖车/报关...）
  - container_owner   — 箱类型 COC/SOC
  - voyage            — 航次
  - terminal          — 码头
  - si_cutoff         — 截单时间
  - cy_cutoff         — 截关时间
  - destination       — 目的港
  - shipper           — 发货人
  - consignee         — 收货人
  - notify_party      — 通知方
  - freight_terms     — 付款方式
  - transport_terms   — 运输条款
  - bl_type           — 提单形式
  - mbl_no            — 主提单号
  - atd               — 实际开船时间
```

---

## 6. Shared Data (Portal ↔ OPS)

Both systems read/write:
- shipments
- containers
- container_items
- customers
- suppliers
- ports
- user_profiles
- audit_logs

---

## 7. Permissions (OPS)

| Role | 录单 | 费用 | 账单 | 收付款 | 文档 | 设置 |
|------|------|------|------|--------|------|------|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| operator | ✓ | ✓ | ✓ view | ✗ | ✓ | ✗ |
| finance | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| sales | ✓ view | ✓ view | ✓ view | ✗ | ✓ view | ✗ |

---

## 8. Development Plan

### Phase 1: 基础框架 + 录单
1. 新建 Vercel 项目 ops.bansargroup.com
2. 复用 Supabase Auth + 现有表
3. 订单列表页 + 详情页（海运出口）
4. 订单编号自动生成
5. MBL/HBL 提单结构
6. 与 portal 数据打通

### Phase 2: 费用 + 账单
7. 费用类型管理
8. 费用模板
9. 费用录入（AR/AP）
10. 单票对账单
11. 月账单

### Phase 3: 收付款 + 文档
12. 收付款记录
13. 核销
14. 开票记录
15. PDF/Excel 文档生成

### Phase 4: 完善
16. Dashboard 统计
17. 其他业务类型接口
18. 模板自定义
