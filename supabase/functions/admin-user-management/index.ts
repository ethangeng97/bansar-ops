// Admin-only user management — Supabase Edge Function
// Actions:
//   create         { email, password, role, name?, customer_id?, overseas_agent_id? }
//   reset_password { user_id, new_password }
//   update_email   { user_id, email }
//   delete         { user_id }
//
// Caller must be authenticated AND have role='admin' in user_profiles.
// 使用 SERVICE_ROLE 执行所有 admin auth 操作；角色合法性校验 public.roles 表。

// deno-lint-ignore-file
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ROLES_REQUIRING_CUSTOMER = new Set(["customer", "supplier"]);
const ROLES_REQUIRING_OVERSEAS_AGENT = new Set(["overseas_agent"]);

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...cors, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });

  const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "missing auth token" }, { status: 401 });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "invalid token" }, { status: 401 });

  const callerId = userData.user.id;
  const { data: profile, error: profileErr } = await admin
    .from("user_profiles").select("role").eq("id", callerId).single();
  if (profileErr || profile?.role !== "admin") {
    return json({ error: "admin role required" }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "invalid json" }, { status: 400 }); }

  const action = body?.action;
  try {
    switch (action) {
      case "create":         return await handleCreate(admin, body);
      case "reset_password": return await handleResetPassword(admin, body);
      case "update_email":   return await handleUpdateEmail(admin, body);
      case "delete":         return await handleDelete(admin, body, callerId);
      default:               return json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[admin-user-management]", err);
    return json({ error: err?.message || String(err) }, { status: 500 });
  }
});

async function roleExists(admin: any, role: string): Promise<boolean> {
  const { data } = await admin.from("roles").select("key").eq("key", role).maybeSingle();
  return !!data;
}

// 把底层报错翻译成更可读的中文提示
function friendly(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (/duplicate|already been regist|already.*exist|already.*use|23505/.test(m)) {
    return "该邮箱已被其他账号占用，请换一个邮箱";
  }
  if (/invalid.*email|email.*invalid/.test(m)) return "邮箱格式不正确";
  if (/password/.test(m)) return "密码不符合要求（至少 6 位）";
  return msg || "操作失败";
}

async function handleCreate(admin: any, body: any) {
  const { email, password, role, name, customer_id, overseas_agent_id } = body;
  if (!email || !password || !role) return json({ error: "email, password, role are required" }, { status: 400 });
  if (!(await roleExists(admin, role))) return json({ error: `invalid role: ${role}` }, { status: 400 });
  if (ROLES_REQUIRING_CUSTOMER.has(role) && !customer_id) return json({ error: "customer_id is required for this role" }, { status: 400 });
  if (ROLES_REQUIRING_OVERSEAS_AGENT.has(role) && !overseas_agent_id) return json({ error: "overseas_agent_id is required for this role" }, { status: 400 });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) return json({ error: friendly(createErr.message) }, { status: 400 });

  const newId = created.user.id;
  const profileRow: any = { id: newId, role, name: name || null, display_name: name || null };
  if (ROLES_REQUIRING_CUSTOMER.has(role))       profileRow.customer_id       = customer_id;
  if (ROLES_REQUIRING_OVERSEAS_AGENT.has(role)) profileRow.overseas_agent_id = overseas_agent_id;

  const { error: pErr } = await admin.from("user_profiles").upsert(profileRow);
  if (pErr) { await admin.auth.admin.deleteUser(newId); return json({ error: "profile insert failed: " + pErr.message }, { status: 500 }); }
  return json({ ok: true, user_id: newId, email });
}

async function handleResetPassword(admin: any, body: any) {
  const { user_id, new_password } = body;
  if (!user_id || !new_password) return json({ error: "user_id and new_password are required" }, { status: 400 });
  if (new_password.length < 6) return json({ error: "password must be at least 6 chars" }, { status: 400 });
  const { error } = await admin.auth.admin.updateUserById(user_id, { password: new_password });
  if (error) return json({ error: error.message }, { status: 400 });
  return json({ ok: true });
}

async function handleUpdateEmail(admin: any, body: any) {
  const { user_id, email } = body;
  if (!user_id || !email) return json({ error: "user_id and email are required" }, { status: 400 });
  const { error } = await admin.auth.admin.updateUserById(user_id, { email, email_confirm: true });
  if (error) return json({ error: friendly(error.message) }, { status: 400 });
  return json({ ok: true });
}

async function handleDelete(admin: any, body: any, callerId: string) {
  const { user_id } = body;
  if (!user_id) return json({ error: "user_id is required" }, { status: 400 });
  if (user_id === callerId) return json({ error: "不能删除当前登录的自己" }, { status: 400 });
  // 先删 profile（避免外键/孤儿），再删 auth 用户
  await admin.from("user_profiles").delete().eq("id", user_id);
  const { error } = await admin.auth.admin.deleteUser(user_id);
  if (error) return json({ error: error.message }, { status: 400 });
  return json({ ok: true });
}
