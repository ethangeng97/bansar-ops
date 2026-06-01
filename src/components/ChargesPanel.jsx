// ============================================================================
// ChargesPanel.jsx  —  费用面板 v3
// 变更（v2 → v3）：
//   1. "客户/供应商" 列头统一改为 "结算单位"
//   2. 结算单位下拉换 PartnerCombo（输入+下拉合一，无候选可+新增）
//   3. 新增"账单号"列（备注左侧）
//   4. 顶部"创建账单"按钮：勾选 N 行 → 校验同方向/同结算单位/同币种 → RPC 创建
//   5. 已绑定账单的行只读（金额/币种/结算单位/数量/单价/税率/汇率灰显）
//   6. 账单号点击通过 onOpenBill(bill) 回调跳转（父组件控制路由）
// 依赖：
//   - supabase 客户端（src/supabase.js）
//   - charge_items / exchange_rates / customers 表已有数据
//   - 011_bills_system.sql 已执行（bills 表 + 4 个 RPC + bill_id 列）
// 用法：
//   <ChargesPanel
//      shipment={shipment}
//      currentUser={user}
//      canEdit={true}
//      onOpenBill={(bill) => location.hash = `#/bills/${bill.id}`}
//   />
// ============================================================================

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from '../supabase'

// ----------------------------------------------------------------------------
// PartnerCombo: 输入+下拉，输入新名字时给"+ 新增"选项
// ----------------------------------------------------------------------------
function PartnerCombo({ value, onChange, partnerType, partners, onCreateNew, disabled }) {
  // value: partner.id (uuid) 或 null
  // partners: [{id, name, partner_type, code}]
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const wrapRef = useRef(null)

  // 同步外部 value → 显示名
  useEffect(() => {
    if (!value) { setText(''); return }
    const p = partners.find(x => x.id === value)
    setText(p ? p.name : '')
  }, [value, partners])

  // 点外部关闭
  useEffect(() => {
    const fn = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // 候选过滤
  const matched = useMemo(() => {
    const q = text.trim().toLowerCase()
    const pool = partners.filter(p =>
      partnerType === 'customer'
        ? ['customer','agent'].includes(p.partner_type)   // 应收：客户 + 海外代理
        : ['supplier','vessel','agent','trucker','broker','warehouse'].includes(p.partner_type)  // 应付：供应商类
    )
    if (!q) return pool.slice(0, 50)
    return pool.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.code?.toLowerCase().includes(q) ||
      p.name_en?.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [text, partners, partnerType])

  // 是否能新增（输入有内容 && 没有完全同名匹配）
  const canCreate = useMemo(() => {
    const q = text.trim()
    if (!q) return false
    return !partners.some(p =>
      p.name?.toLowerCase() === q.toLowerCase() &&
      (partnerType === 'customer'
        ? ['customer','agent'].includes(p.partner_type)
        : ['supplier','vessel','agent','trucker','broker','warehouse'].includes(p.partner_type))
    )
  }, [text, partners, partnerType])

  return (
    <div ref={wrapRef} style={{ position:'relative', minWidth: 140 }}>
      <input
        type="text"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
        placeholder="—"
        style={{
          width: '100%', padding: '4px 6px', fontSize: 12,
          border: '1px solid #d9d9d9', borderRadius: 3,
          background: disabled ? '#f5f5f5' : '#fff'
        }}
      />
      {open && !disabled && (
        <div style={{
          position:'absolute', top:'100%', left:0, right:0, zIndex: 50,
          background:'#fff', border:'1px solid #d9d9d9', borderRadius:3,
          maxHeight: 240, overflowY:'auto', boxShadow:'0 2px 8px rgba(0,0,0,.12)'
        }}>
          {matched.map(p => (
            <div key={p.id}
              onClick={() => { onChange(p.id); setText(p.name); setOpen(false) }}
              style={{ padding:'4px 8px', cursor:'pointer', fontSize:12,
                       background: value === p.id ? '#e6f7ff' : '#fff' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
              onMouseLeave={(e) => e.currentTarget.style.background = value === p.id ? '#e6f7ff' : '#fff'}
            >
              <span style={{ color:'#999', marginRight:6 }}>{p.code}</span>
              {p.name}
            </div>
          ))}
          {canCreate && (
            <div
              onClick={async () => {
                const newName = text.trim()
                const id = await onCreateNew(newName, partnerType)
                if (id) { onChange(id); setText(newName); setOpen(false) }
              }}
              style={{ padding:'6px 8px', cursor:'pointer', fontSize:12,
                       background:'#fff7e6', borderTop:'1px solid #f0f0f0',
                       color:'#fa8c16', fontWeight: 500 }}
            >
              + 新增「{text.trim()}」为{partnerType === 'customer' ? '客户' : '供应商'}
            </div>
          )}
          {matched.length === 0 && !canCreate && (
            <div style={{ padding:'8px', fontSize:12, color:'#999', textAlign:'center' }}>无匹配</div>
          )}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// 主组件
// ----------------------------------------------------------------------------
export default function ChargesPanel({ shipment, currentUser, canEdit = true, onOpenBill }) {
  const [chargeItems, setChargeItems] = useState([])     // 32 个预设
  const [partners, setPartners]       = useState([])     // 客户+供应商+代理...
  const [rates, setRates]             = useState([])     // 汇率
  const [bills, setBills]             = useState([])     // 本票账单（用于显示账单号）
  const [rows, setRows]               = useState([])     // charges 行（含 draft）
  const [selected, setSelected]       = useState(new Set())  // 勾选的行 id（已保存才有 id）
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [dirty, setDirty]             = useState(false)

  // 加载初始数据
  const reload = useCallback(async () => {
    setLoading(true)
    const [{ data: items }, { data: pts }, { data: rs }, { data: bs }, { data: chs }] = await Promise.all([
      supabase.from('charge_items').select('*').order('sort'),
      supabase.from('customers').select('id,code,name,name_en,partner_type,active').eq('active', true).order('name'),
      supabase.from('exchange_rates').select('*').order('currency'),
      supabase.from('bills').select('*').eq('shipment_id', shipment.id).order('bill_no', { ascending: false }),
      supabase.from('charges').select('*').eq('shipment_id', shipment.id).order('sort_order')
    ])
    setChargeItems(items || [])
    setPartners(pts || [])
    setRates(rs || [])
    setBills(bs || [])
    setRows((chs || []).map(c => ({ ...c, _draft: false })))
    setSelected(new Set())
    setDirty(false)
    setLoading(false)
  }, [shipment.id])

  useEffect(() => { reload() }, [reload])

  // 汇率字典
  const rateMap = useMemo(() => {
    const m = {}
    rates.forEach(r => { m[r.currency] = Number(r.rate || 1) })
    m['CNY'] = 1
    return m
  }, [rates])

  // 账单字典
  const billMap = useMemo(() => {
    const m = {}
    bills.forEach(b => { m[b.id] = b })
    return m
  }, [bills])

  // 行操作
  const updateRow = (idx, patch) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
    setDirty(true)
  }

  const addRow = (direction) => {
    setRows(prev => [...prev, {
      _tmpId: `tmp_${Date.now()}_${Math.random()}`,
      _draft: true,
      shipment_id: shipment.id,
      direction,
      charge_item_id: null,
      partner_id: null,
      unit: '票',
      quantity: 1,
      currency: 'CNY',
      exchange_rate: 1,
      unit_price: 0,
      tax_rate: 0,
      sort_order: prev.length,
      remark: '',
      status: 'draft',
      bill_id: null,
    }])
    setDirty(true)
  }

  const deleteSelected = async () => {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 条费用？`)) return
    const ids = [...selected].filter(id => !String(id).startsWith('tmp_'))
    if (ids.length > 0) {
      const { error } = await supabase.from('charges').delete().in('id', ids)
      if (error) { alert('删除失败：' + error.message); return }
    }
    setRows(prev => prev.filter(r => !selected.has(r.id || r._tmpId)))
    setSelected(new Set())
  }

  const toggleSel = (id) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const toggleSelAll = (direction) => {
    const ids = rows.filter(r => r.direction === direction).map(r => r.id || r._tmpId)
    setSelected(prev => {
      const n = new Set(prev)
      const allSelected = ids.every(i => n.has(i))
      if (allSelected) ids.forEach(i => n.delete(i))
      else ids.forEach(i => n.add(i))
      return n
    })
  }

  // 保存所有
  const saveAll = async () => {
    // —— 保存前校验：缺必填项（费用名称/结算单位/单价）时弹窗拦截 ——
    //    不清空 rows、不 reload，已填内容原样保留，避免点保存后数据丢失
    const labelOf = (r) => {
      const ci = chargeItems.find(i => i.id === r.charge_item_id)
      return ci ? (ci.name_zh || ci.name_en || ci.code) : '未选费用名称'
    }
    const isBlankDraft = (r) => r._draft && !r.charge_item_id && !r.partner_id && !Number(r.unit_price)
    const dirZh = (r) => (r.direction === 'AR' || r.direction === '应收') ? '应收' : '应付'
    const problems = []
    rows.forEach(r => {
      if (isBlankDraft(r)) return        // 完全空白的新行：忽略，不当作要保存的数据
      const miss = []
      if (!r.charge_item_id) miss.push('费用名称')
      if (!r.partner_id) miss.push('结算单位')
      if (!Number(r.unit_price)) miss.push('单价')
      if (miss.length) problems.push(`· ${dirZh(r)}「${labelOf(r)}」缺：${miss.join('、')}`)
    })
    if (problems.length) {
      alert('以下费用未填写完整，暂时无法保存（已填内容已保留，请补齐后再点保存）：\n\n' + problems.join('\n'))
      return
    }

    setSaving(true)
    try {
      const drafts = rows.filter(r => r._draft).map(r => {
        const { _draft, _tmpId, id, amount_total, amount_cny, ...rest } = r
        return rest
      })
      const updates = rows.filter(r => !r._draft && r.id).map(r => {
        const { _draft, amount_total, amount_cny, bill_id, ...rest } = r
        return rest
      })

      if (drafts.length > 0) {
        const { error } = await supabase.from('charges').insert(drafts)
        if (error) throw error
      }
      for (const u of updates) {
        const { id, ...patch } = u
        const { error } = await supabase.from('charges').update(patch).eq('id', id)
        if (error) throw error
      }
      await reload()
    } catch (e) {
      alert('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // 新建结算单位（ComboBox 触发）
  const handleCreatePartner = async (name, partnerType) => {
    const { data, error } = await supabase.rpc('ensure_partner_quick_create', {
      p_name: name,
      p_partner_type: partnerType,
    })
    if (error) { alert('新建结算单位失败：' + error.message); return null }
    // 刷新 partners
    const { data: pts } = await supabase.from('customers')
      .select('id,code,name,name_en,partner_type,active').eq('active', true).order('name')
    setPartners(pts || [])
    return data
  }

  // 创建账单
  const createBill = async () => {
    const ids = [...selected].filter(id => !String(id).startsWith('tmp_'))
    if (ids.length === 0) { alert('请先保存草稿后再勾选创建账单'); return }

    // 前端预校验，给更友好的错误
    const sel = rows.filter(r => ids.includes(r.id))
    const dirs = new Set(sel.map(r => r.direction))
    const pids = new Set(sel.map(r => r.partner_id))
    const ccys = new Set(sel.map(r => r.currency))
    const bound = sel.filter(r => r.bill_id)

    if (bound.length > 0) { alert(`有 ${bound.length} 条已绑定账单，请先解绑`); return }
    if (sel.some(r => !r.partner_id)) { alert('存在未填结算单位的费用'); return }
    if (dirs.size > 1) { alert('应收和应付不能合并到同一张账单'); return }
    if (pids.size > 1) { alert('所选费用必须属于同一结算单位'); return }
    if (ccys.size > 1) { alert('所选费用币种不一致，请分别开账单'); return }

    if (!confirm(`确认创建账单？包含 ${sel.length} 条费用，币种 ${[...ccys][0]}`)) return

    const { data, error } = await supabase.rpc('create_bill_from_charges', {
      p_charge_ids: ids,
    })
    if (error) { alert('创建账单失败：' + error.message); return }
    const result = data?.[0]
    if (result) alert(`账单创建成功：${result.bill_no}`)
    await reload()
  }

  // 解绑账单
  const unbindBill = async () => {
    const ids = [...selected].filter(id => !String(id).startsWith('tmp_'))
    if (ids.length === 0) return
    const sel = rows.filter(r => ids.includes(r.id) && r.bill_id)
    if (sel.length === 0) { alert('所选费用没有绑定账单'); return }
    if (!confirm(`确认解绑 ${sel.length} 条费用与账单的关系？`)) return
    const { error } = await supabase.rpc('unbind_charges_from_bill', { p_charge_ids: ids })
    if (error) { alert('解绑失败：' + error.message); return }
    await reload()
  }

  if (loading) return <div style={{ padding: 20 }}>加载中...</div>

  const arRows = rows.filter(r => r.direction === 'AR')
  const apRows = rows.filter(r => r.direction === 'AP')

  // 计算每行金额（前端预览）
  const calcAmount = (r) => {
    const total = Number(r.quantity || 0) * Number(r.unit_price || 0) * (1 + Number(r.tax_rate || 0) / 100)
    const cny = total * Number(r.exchange_rate || 1)
    return { total, cny }
  }

  // 合计
  const sumCny = (arr) => arr.reduce((s, r) => s + calcAmount(r).cny, 0)
  const arTotal = sumCny(arRows)
  const apTotal = sumCny(apRows)

  return (
    <div style={{ padding: 12 }}>
      {/* 顶部操作栏 */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom: 12 }}>
        {dirty && (
          <span style={{ color:'#fa8c16', fontSize: 13 }}>⚠ 有未保存的费用，请点击保存</span>
        )}
        <div style={{ flex: 1 }} />
        {selected.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: '#666' }}>已选 {selected.size} 条</span>
            <button onClick={createBill} className="tms-btn">创建账单</button>
            <button onClick={unbindBill} className="tms-btn">解绑账单</button>
            <button onClick={deleteSelected} className="tms-btn tms-btn-danger">删除</button>
          </>
        )}
        <button onClick={saveAll} disabled={!dirty || saving}
          className="tms-btn tms-btn-primary">{saving ? '保存中...' : '保存所有费用'}</button>
      </div>

      {/* 应收 */}
      <ChargeSection
        title="应收（来自客户）"
        direction="AR"
        rows={arRows}
        partnerLabel="结算单位"
        partnerType="customer"
        partners={partners}
        chargeItems={chargeItems}
        rateMap={rateMap}
        billMap={billMap}
        selected={selected}
        canEdit={canEdit}
        onToggleSel={toggleSel}
        onToggleAll={() => toggleSelAll('AR')}
        onUpdate={(idx, patch) => updateRow(rows.indexOf(arRows[idx]), patch)}
        onAdd={() => addRow('AR')}
        onCreatePartner={handleCreatePartner}
        onOpenBill={onOpenBill}
        sumCny={arTotal}
        themeColor="#1890ff"
      />

      <div style={{ height: 16 }} />

      {/* 应付 */}
      <ChargeSection
        title="应付（给供应商）"
        direction="AP"
        rows={apRows}
        partnerLabel="结算单位"
        partnerType="supplier"
        partners={partners}
        chargeItems={chargeItems}
        rateMap={rateMap}
        billMap={billMap}
        selected={selected}
        canEdit={canEdit}
        onToggleSel={toggleSel}
        onToggleAll={() => toggleSelAll('AP')}
        onUpdate={(idx, patch) => updateRow(rows.indexOf(apRows[idx]), patch)}
        onAdd={() => addRow('AP')}
        onCreatePartner={handleCreatePartner}
        onOpenBill={onOpenBill}
        sumCny={apTotal}
        themeColor="#fa8c16"
      />

      {/* 利润分析（admin/finance/sales 可见） */}
      {['admin','finance','sales'].includes(currentUser?.role) && (
        <div style={{ marginTop: 16, padding: 12, background:'#f6ffed', border:'1px solid #b7eb8f', borderRadius: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📊 内部利润分析</div>
          <div style={{ display:'flex', gap: 24, fontSize: 12 }}>
            <div>应收合计：<b>¥ {arTotal.toFixed(2)}</b></div>
            <div>应付合计：<b>¥ {apTotal.toFixed(2)}</b></div>
            <div>毛利：<b style={{ color: arTotal-apTotal >= 0 ? '#389e0d' : '#cf1322' }}>
              ¥ {(arTotal-apTotal).toFixed(2)}
            </b></div>
            <div>毛利率：<b>{arTotal > 0 ? ((arTotal-apTotal)/arTotal*100).toFixed(2) : '0.00'}%</b></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// 单个分组（应收 or 应付）
// ----------------------------------------------------------------------------
function ChargeSection({
  title, direction, rows, partnerLabel, partnerType, partners, chargeItems,
  rateMap, billMap, selected, canEdit,
  onToggleSel, onToggleAll, onUpdate, onAdd, onCreatePartner, onOpenBill,
  sumCny, themeColor
}) {
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id || r._tmpId))

  const calcAmount = (r) => {
    const total = Number(r.quantity || 0) * Number(r.unit_price || 0) * (1 + Number(r.tax_rate || 0) / 100)
    const cny = total * Number(r.exchange_rate || 1)
    return { total, cny }
  }

  const isLocked = (r) => {
    const b = r.bill_id ? billMap[r.bill_id] : null
    return b && ['issued','paid'].includes(b.status)
  }

  return (
    <div style={{ border: `1px solid ${themeColor}33`, borderRadius: 4 }}>
      <div style={{
        padding: '8px 12px', background: `${themeColor}11`, borderBottom: `1px solid ${themeColor}33`,
        display:'flex', alignItems:'center', gap: 12
      }}>
        <span style={{ fontWeight: 600, color: themeColor }}>{title}</span>
        <span style={{ fontSize: 12, color: '#666' }}>
          ({rows.length} 项 / 合计 {sumCny.toFixed(2)} CNY)
        </span>
        {canEdit && (
          <>
            <div style={{ flex: 1 }} />
            <button onClick={onAdd} className="tms-btn tms-btn-sm">+ 费用名称</button>
          </>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tms-table" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ width: 30, padding: 6 }}>
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
              </th>
              <th style={{ width: 36, padding: 6 }}>#</th>
              <th style={{ minWidth: 140, padding: 6 }}>费用名称</th>
              <th style={{ minWidth: 140, padding: 6 }}>{partnerLabel}</th>
              <th style={{ width: 80, padding: 6 }}>计费单位</th>
              <th style={{ width: 60, padding: 6 }}>数量</th>
              <th style={{ width: 70, padding: 6 }}>币种</th>
              <th style={{ width: 70, padding: 6 }}>汇率</th>
              <th style={{ width: 90, padding: 6 }}>单价</th>
              <th style={{ width: 90, padding: 6 }}>总价</th>
              <th style={{ width: 60, padding: 6 }}>税率%</th>
              <th style={{ width: 100, padding: 6 }}>折 CNY</th>
              <th style={{ width: 70, padding: 6 }}>状态</th>
              <th style={{ width: 110, padding: 6 }}>账单号</th>
              <th style={{ minWidth: 120, padding: 6 }}>备注</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const id = r.id || r._tmpId
              const locked = isLocked(r)
              const draft = r._draft
              const amt = calcAmount(r)
              const bill = r.bill_id ? billMap[r.bill_id] : null

              return (
                <tr key={id}
                  style={{
                    background: draft ? '#fffbe6' : (locked ? '#f5f5f5' : '#fff'),
                    borderTop: '1px solid #f0f0f0'
                  }}>
                  <td style={{ padding: 4, textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => onToggleSel(id)} />
                  </td>
                  <td style={{ padding: 4, textAlign: 'center', color: '#999' }}>{idx + 1}</td>

                  {/* 费用名称 */}
                  <td style={{ padding: 4 }}>
                    <select
                      value={r.charge_item_id || ''}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { charge_item_id: e.target.value || null })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }}
                    >
                      <option value="">— 选择 —</option>
                      {chargeItems.map(it => (
                        <option key={it.id} value={it.id}>{it.code} {it.name_zh}</option>
                      ))}
                    </select>
                  </td>

                  {/* 结算单位（PartnerCombo） */}
                  <td style={{ padding: 4 }}>
                    <PartnerCombo
                      value={r.partner_id}
                      partnerType={partnerType}
                      partners={partners}
                      disabled={!canEdit || locked}
                      onChange={(pid) => onUpdate(idx, { partner_id: pid })}
                      onCreateNew={onCreatePartner}
                    />
                  </td>

                  {/* 计费单位 */}
                  <td style={{ padding: 4 }}>
                    <input list="unit-options" value={r.unit || ''}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { unit: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }} />
                  </td>

                  {/* 数量 */}
                  <td style={{ padding: 4 }}>
                    <input type="number" step="0.01" value={r.quantity || 0}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { quantity: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }} />
                  </td>

                  {/* 币种 */}
                  <td style={{ padding: 4 }}>
                    <select value={r.currency} disabled={!canEdit || locked}
                      onChange={e => {
                        const c = e.target.value
                        onUpdate(idx, { currency: c, exchange_rate: rateMap[c] || 1 })
                      }}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }}>
                      <option value="CNY">CNY</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="HKD">HKD</option>
                      <option value="JPY">JPY</option>
                    </select>
                  </td>

                  {/* 汇率 */}
                  <td style={{ padding: 4 }}>
                    <input type="number" step="0.0001" value={r.exchange_rate || 1}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { exchange_rate: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }} />
                  </td>

                  {/* 单价 */}
                  <td style={{ padding: 4 }}>
                    <input type="number" step="0.01" value={r.unit_price || 0}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { unit_price: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }} />
                  </td>

                  {/* 总价（只读） */}
                  <td style={{ padding: 4, textAlign:'right', fontFamily:'monospace' }}>
                    {amt.total.toFixed(2)}
                  </td>

                  {/* 税率 */}
                  <td style={{ padding: 4 }}>
                    <input type="number" step="0.1" value={r.tax_rate || 0}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { tax_rate: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }} />
                  </td>

                  {/* 折 CNY */}
                  <td style={{ padding: 4, textAlign:'right', fontFamily:'monospace', color: themeColor, fontWeight: 600 }}>
                    {amt.cny.toFixed(2)}
                  </td>

                  {/* 状态 */}
                  <td style={{ padding: 4 }}>
                    <select value={r.status || 'draft'} disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { status: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }}>
                      <option value="draft">草稿</option>
                      <option value="confirmed">已确认</option>
                      <option value="settled">已结算</option>
                    </select>
                  </td>

                  {/* 账单号 */}
                  <td style={{ padding: 4 }}>
                    {bill ? (
                      <a onClick={() => onOpenBill?.(bill)}
                        style={{ color: '#1890ff', cursor: 'pointer', textDecoration: 'underline',
                                 fontFamily: 'monospace', fontSize: 11 }}>
                        {bill.bill_no}
                      </a>
                    ) : (
                      <span style={{ color: '#ccc' }}>—</span>
                    )}
                  </td>

                  {/* 备注 */}
                  <td style={{ padding: 4 }}>
                    <input type="text" value={r.remark || ''}
                      disabled={!canEdit || locked}
                      onChange={e => onUpdate(idx, { remark: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '3px 4px',
                               background: locked ? '#f5f5f5' : '#fff' }} />
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={15} style={{ padding: 20, textAlign:'center', color:'#999', fontSize: 12 }}>
                  暂无{direction === 'AR' ? '应收' : '应付'}，点上方「+ 费用名称」添加
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: '#fafafa', fontWeight: 600 }}>
              <td colSpan={11} style={{ padding: 6, textAlign:'right' }}>合计 (CNY)：</td>
              <td style={{ padding: 6, textAlign:'right', fontFamily:'monospace', color: themeColor }}>
                {sumCny.toFixed(2)}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 计费单位 datalist */}
      <datalist id="unit-options">
        <option value="票" />
        <option value="40HQ" />
        <option value="40GP" />
        <option value="20GP" />
        <option value="CBM" />
        <option value="KGS" />
        <option value="day" />
        <option value="次" />
      </datalist>
    </div>
  )
}
