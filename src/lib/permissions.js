// 角色权限（数据驱动）。
// 角色定义存数据库 roles 表：data_scope(财务方向范围) + page_access(可访问页面 key)。
// 登录时 App.jsx 把该角色定义挂到 user.profile.roleDef。
// 这里的判断优先读 roleDef.page_access；roleDef 缺失(加载失败/老会话)时回退到下面的
// 内置默认表，避免把人锁在门外（fail-open：页面级放行，数据层仍由 RLS 保护）。

const ALL_PAGES = [
  "dashboard", "orders", "charges", "billing", "payments",
  "invoices", "invoice_requests", "documents", "settings", "manage", "user_admin",
];

// 系统角色的默认 page_access（与 migration 028 种子保持一致；仅作回退用）
const FALLBACK_PAGES = {
  admin:          ALL_PAGES,
  operator:       ["dashboard", "orders", "charges", "documents"],
  sales:          ["dashboard", "orders", "documents"],
  finance_ar:     ["dashboard", "orders", "charges", "billing", "payments", "invoices", "invoice_requests", "documents"],
  finance_ap:     ["dashboard", "orders", "charges", "billing", "payments", "invoices", "documents"],
  finance:        ["dashboard", "orders", "charges", "billing", "payments", "invoices", "invoice_requests", "documents"],
  customer:       ["dashboard", "orders", "documents"],
  supplier:       ["dashboard", "orders", "documents"],
  overseas_agent: ["dashboard", "orders", "documents"],
};

function roleOf(userOrRole) {
  return typeof userOrRole === "string" ? userOrRole : userOrRole?.profile?.role;
}

// 返回该用户/角色可访问的页面 key 列表（roleDef 优先，否则回退；未知返回 null=放行）
export function pageAccessOf(userOrRole) {
  if (typeof userOrRole !== "string") {
    const pa = userOrRole?.profile?.roleDef?.page_access;
    if (Array.isArray(pa) && pa.length) return pa;
  }
  const role = roleOf(userOrRole);
  return FALLBACK_PAGES[role] || null;
}

// 当前用户财务数据范围：all / ar / ap / none（默认 all，不误限）
export function dataScopeOf(userOrRole) {
  if (typeof userOrRole !== "string") {
    const ds = userOrRole?.profile?.roleDef?.data_scope;
    if (ds) return ds;
  }
  return "all";
}

// 接受 role 字符串(旧调用)或 user 对象(新调用)
export function canAccessPage(userOrRole, page) {
  if (roleOf(userOrRole) === "admin") return true;
  const pages = pageAccessOf(userOrRole);
  if (!pages) return true; // 未知角色 → fail-open（数据仍受 RLS 保护）
  return pages.includes(page);
}

export function isAdmin(user) {
  return roleOf(user) === "admin";
}
