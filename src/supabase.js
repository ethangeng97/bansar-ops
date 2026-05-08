// Lightweight Supabase REST client. No external deps.
// Extends original with: session persistence, in/or/is/gte/lte filters, single-call upsert.
const SUPABASE_URL = "https://pewdvheoaqofmzwhwwvu.supabase.co";
const SUPABASE_KEY = "sb_publishable_czodJ94LFy5iRcK9gCb2SA_uZGkRdGp";
const STORAGE_KEY = "ff_session_v2";

function createClient() {
  let accessToken = null;
  let refreshToken = null;
  let currentUser = null;

  // Restore session
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      accessToken = s.access_token || null;
      refreshToken = s.refresh_token || null;
      currentUser = s.user || null;
    }
  } catch {}

  const persist = () => {
    try {
      if (accessToken) localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, user: currentUser }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const headers = (extra = {}) => ({
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
    ...extra,
  });

  // 通知 App 用户会话失效（401 重试失败 / refresh 失败）→ 弹 toast + 引导重登
  // 用 Custom Event 是为了让 supabase.js 不依赖 React，App.jsx 单点监听
  let signaledExpired = false;
  const signalSessionExpired = () => {
    if (signaledExpired) return;       // 一次会话只发一次，避免 toast 风暴
    if (typeof window === "undefined") return;
    signaledExpired = true;
    try { window.dispatchEvent(new CustomEvent("bansar:session-expired")); } catch { /* IE/无 CustomEvent 环境忽略 */ }
  };

  const refreshIfNeeded = async () => {
    if (!refreshToken) { signalSessionExpired(); return false; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) { signalSessionExpired(); return false; }
      const data = await res.json();
      accessToken = data.access_token; refreshToken = data.refresh_token; currentUser = data.user; persist();
      signaledExpired = false;          // 重新有效，清掉防抖
      return true;
    } catch { signalSessionExpired(); return false; }
  };

  const api = async (path, opts = {}) => {
    let res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers(), ...opts.headers } });
    if (res.status === 401 && refreshToken && await refreshIfNeeded()) {
      res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers(), ...opts.headers } });
    }
    // 登录请求本身的 401 是密码错，不算会话失效，由调用方处理
    if (res.status === 401 && !path.startsWith("/auth/v1/token")) signalSessionExpired();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.msg || err.error_description || res.statusText);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  const auth = {
    signIn: async (email, password) => {
      const data = await api("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
      accessToken = data.access_token; refreshToken = data.refresh_token; currentUser = data.user; persist();
      return data;
    },
    signOut: () => { accessToken = null; refreshToken = null; currentUser = null; persist(); },
    getUser: () => currentUser,
    getToken: () => accessToken,
    isAuthenticated: () => !!accessToken,
  };

  const from = (table) => {
    const params = [];
    const filters = [];
    let method = "GET";
    let body = null;
    let isSingle = false;
    let returnData = false;
    let prefer = null;

    const enc = (v) => encodeURIComponent(v);

    const builder = {
      select: (cols = "*") => { params.push(`select=${enc(cols)}`); return builder; },
      eq:  (c, v) => { filters.push(`${c}=eq.${enc(v)}`); return builder; },
      neq: (c, v) => { filters.push(`${c}=neq.${enc(v)}`); return builder; },
      gt:  (c, v) => { filters.push(`${c}=gt.${enc(v)}`); return builder; },
      gte: (c, v) => { filters.push(`${c}=gte.${enc(v)}`); return builder; },
      lt:  (c, v) => { filters.push(`${c}=lt.${enc(v)}`); return builder; },
      lte: (c, v) => { filters.push(`${c}=lte.${enc(v)}`); return builder; },
      like:  (c, v) => { filters.push(`${c}=like.${enc(v)}`); return builder; },
      ilike: (c, v) => { filters.push(`${c}=ilike.${enc(v)}`); return builder; },
      is:  (c, v) => { filters.push(`${c}=is.${v}`); return builder; },
      // .not(col, op, val) — PostgREST 反向操作，常用 .not("col", "is", null) 表示 IS NOT NULL
      not: (c, op, v) => { filters.push(`${c}=not.${op}.${v === null ? "null" : enc(v)}`); return builder; },
      in:  (c, vals) => { filters.push(`${c}=in.(${vals.map(enc).join(",")})`); return builder; },
      or:  (expr) => { filters.push(`or=(${expr})`); return builder; },
      order: (c, { ascending = true } = {}) => { params.push(`order=${c}.${ascending ? "asc" : "desc"}`); return builder; },
      limit: (n) => { params.push(`limit=${n}`); return builder; },
      single: () => { isSingle = true; params.push("limit=1"); return builder; },
      insert: (data) => { method = "POST"; body = JSON.stringify(data); returnData = true; return builder; },
      update: (data) => { method = "PATCH"; body = JSON.stringify(data); returnData = true; return builder; },
      upsert: (data, { onConflict } = {}) => { method = "POST"; body = JSON.stringify(data); returnData = true; prefer = "resolution=merge-duplicates"; if (onConflict) params.push(`on_conflict=${onConflict}`); return builder; },
      delete: () => { method = "DELETE"; return builder; },
      then: function (onFulfilled, onRejected) {
        // 把执行包装成真正的 Promise，让链式 .then(...).then(...) 正常工作
        const exec = async () => {
          try {
            const all = [...params, ...filters];
            const query = all.length ? `?${all.join("&")}` : "";
            const h = {};
            const preferParts = [];
            if (returnData) preferParts.push("return=representation");
            if (prefer) preferParts.push(prefer);
            if (preferParts.length) h["Prefer"] = preferParts.join(",");
            let res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { method, headers: { ...headers(), ...h }, body });
            if (res.status === 401 && refreshToken && await refreshIfNeeded()) {
              res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { method, headers: { ...headers(), ...h }, body });
            }
            if (res.status === 401) signalSessionExpired();   // 刷不动了
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || err.hint || res.statusText);
            }
            const text = await res.text();
            const result = text ? JSON.parse(text) : [];
            return { data: isSingle ? result[0] || null : result, error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        };
        return exec().then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const getSession = () => {
    if (accessToken && currentUser) return { access_token: accessToken, user: currentUser };
    return null;
  };

  // ── RPC: 调用 Supabase Postgres 函数 ──
  // 用法： const { data, error } = await supabase.rpc("settle_bill", { p_bill_id, p_amount, p_settled_at });
  // 与 from 链一致返回 {data, error}（不抛异常），方便 UI 统一错误处理。
  const rpc = async (fn, args = {}) => {
    try {
      const data = await api(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
        method: "POST",
        body: JSON.stringify(args || {}),
      });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  };

  return { auth, from, api, rpc, getSession };
}

export const supabase = createClient();
