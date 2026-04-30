export function canAccessPage(role, page) {
  switch (page) {
    case "dashboard": return true;
    case "orders":    return true;
    case "charges":   return role !== "sales";
    case "billing":   return role === "admin" || role === "finance";
    case "payments":  return role === "admin" || role === "finance";
    case "documents": return true;
    case "settings":  return role === "admin";
    case "manage":    return role === "admin";
    default: return false;
  }
}

export function isAdmin(user) {
  return user?.profile?.role === "admin";
}
