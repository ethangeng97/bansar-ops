// ============================================================================
// ref-cache.js — 业务字典数据缓存
//
// 用途：避免详情页/弹窗每次打开都重新请求 suppliers/customers/staff/字典等数据
// 策略：单页生命周期内进程内缓存（页面刷新清空）
//        每个字典首次请求触发 fetch，后续直接返回 cache
//        如需强制刷新（比如新建客商后），调用 invalidate(key)
//
// 用法：
//   import { getCachedRef } from "../lib/ref-cache";
//   const customers = await getCachedRef("customers");
// ============================================================================

import { supabase } from "../supabase.js";

const cache = {};      // { [key]: data[] }
const inflight = {};   // { [key]: Promise }   // 防止并发重复请求

const fetchers = {
  suppliers: () =>
    supabase.from("suppliers").select("name").order("name")
      .then(({ data }) => (data || []).map(r => r.name)),

  customers: () =>
    supabase.from("customers").select("name").order("name")
      .then(({ data }) => (data || []).map(r => r.name)),

  // 含别名字段（name_short/name_en/code），用于订单列表搜索缩写匹配
  customers_full: () =>
    supabase.from("customers").select("name, name_short, name_en, code").order("name")
      .then(({ data }) => data || []),

  staff: () =>
    supabase.from("user_profiles_view")
      .select("id, email, role, full_name, display_name, active")
      .eq("active", true)
      .then(({ data }) => data || []),

  pkg_units: () =>
    supabase.from("pkg_units")
      .select("code, name_en, name_zh")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => data || []),

  cargo_types: () =>
    supabase.from("cargo_types")
      .select("code, name_en, name_zh")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => data || []),
};

/**
 * 取字典（命中缓存返回，没命中触发 fetch + 缓存）
 * @param {string} key - 'suppliers' | 'customers' | 'staff' | 'pkg_units' | 'cargo_types'
 * @returns {Promise<any[]>}
 */
export async function getCachedRef(key) {
  if (cache[key]) return cache[key];
  if (inflight[key]) return inflight[key];
  const fetcher = fetchers[key];
  if (!fetcher) throw new Error(`Unknown ref-cache key: ${key}`);
  inflight[key] = fetcher().then(data => {
    cache[key] = data;
    delete inflight[key];
    return data;
  }).catch(err => {
    delete inflight[key];
    throw err;
  });
  return inflight[key];
}

/**
 * 失效一个或多个 cache key（数据变更后调用）
 * 例如新建客商后：invalidate("customers");
 */
export function invalidate(...keys) {
  keys.forEach(k => { delete cache[k]; });
}

/**
 * 清空全部缓存
 */
export function invalidateAll() {
  Object.keys(cache).forEach(k => delete cache[k]);
}
