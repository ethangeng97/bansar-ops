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

  const refreshIfNeeded = async () => {
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      accessToken = data.access_token; refreshToken = data.refresh_token; currentUser = data.user; persist();
      return true;
    } catch { return false; }
  };

  const api = async (path, opts = {}) => {
    let res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers(), ...opts.headers } });
    if (res.status === 401 && refreshToken && await refreshIfNeeded()) {
      res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers(), ...opts.headers } });
    }
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
      in:  (c, vals) => { filters.push(`${c}=in.(${vals.map(enc).join(",")})`); return builder; },
      or:  (expr) => { filters.push(`or=(${expr})`); return builder; },
      order: (c, { ascending = true } = {}) => { params.push(`order=${c}.${ascending ? "asc" : "desc"}`); return builder; },
      limit: (n) => { params.push(`limit=${n}`); return builder; },
      single: () => { isSingle = true; params.push("limit=1"); return builder; },
      insert: (data) => { method = "POST"; body = JSON.stringify(data); returnData = true; return builder; },
      update: (data) => { method = "PATCH"; body = JSON.stringify(data); returnData = true; return builder; },
      upsert: (data, { onConflict } = {}) => { method = "POST"; body = JSON.stringify(data); returnData = true; prefer = "resolution=merge-duplicates"; if (onConflict) params.push(`on_conflict=${onConflict}`); return builder; },
      delete: () => { method = "DELETE"; return builder; },
      then: async (resolve, reject) => {
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
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || err.hint || res.statusText);
          }
          const text = await res.text();
          const result = text ? JSON.parse(text) : [];
          resolve({ data: isSingle ? result[0] || null : result, error: null });
        } catch (err) {
          resolve({ data: null, error: err });
        }
      },
    };
    return builder;
  };

  return { auth, from, api };
}

export const supabase = createClient();
