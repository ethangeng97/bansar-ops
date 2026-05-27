# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project context

Bansar OPS — internal operations system for a Chinese freight forwarder (班萨/Bansar). Vite + React 19 SPA, deployed to `ops.bansargroup.com`. Shares a Supabase backend (Postgres + Auth + RLS) with the customer-facing `portal.bansargroup.com`; both apps read/write the same tables (`shipments`, `containers`, `customers`, `suppliers`, `ports`, `user_profiles`, etc.). UI text is primarily Chinese.

See `docs/OPS_ARCHITECTURE.md` for the full module/feature spec (录单, 费用, 账单, 收付款, 文档).

## Commands

```
npm run dev      # Vite dev server
npm run build    # Production build (chunked per-page, see vite.config.js)
npm run preview  # Preview production build
npm run lint     # ESLint (flat config in eslint.config.js)
```

No test runner is configured. There is no TypeScript — pure `.js`/`.jsx`.

## Architecture

### Routing — hash-based, no router library
`src/App.jsx` is the entire routing table. It parses `window.location.hash` and renders one of: the login screen (no session), `<Portal>` (no hash), or a specific page component (hash matched). To add a new page: add a branch in `App.jsx`, navigate via `window.location.hash = "#/your-route"`, and back-nav uses `window.history.back()` or `window.location.hash = ""`.

### Supabase client — hand-rolled, not `@supabase/supabase-js`
`src/supabase.js` is a ~165-line custom REST client around PostgREST. It exposes a chainable builder (`supabase.from("table").select().eq().order().limit()`) plus `auth`, `rpc`, and `getSession`. URL and publishable key are **hardcoded** in this file (publishable key, RLS-protected — all real auth lives in DB-layer RLS + `user_profiles.role`).

Session persists to `localStorage` under `ff_session_v2`; 401s auto-retry once after a refresh-token call.

#### Gotchas — read before touching anything that calls supabase

1. **`.from(...)` chains return `{data, error}`, never throw.** Forgetting to destructure causes silent failures:
   ```js
   // ❌ rows is {data, error}, not an array
   const rows = await supabase.from("shipments").select("*");
   rows.map(r => r.id);  // TypeError

   // ❌ schema error swallowed, UI shows "saved"
   await supabase.from("shipments").update({ ghost_field: 1 }).eq("id", x);
   ```
   This is exactly why `filterShipmentPayload` exists — historically the client also swallowed errors entirely; that's fixed, but unchecked `error` is still a footgun.

2. **`auth.signIn` *does* throw.** Inconsistent with `.from(...)`. `signIn` calls the inner `api()` helper, which throws on non-2xx. `App.jsx:76` currently writes `const { error } = await supabase.auth.signIn(...)` — that destructure can't catch the real error; works today only because the surrounding flow happens to handle it. Use try/catch for `auth.signIn`, `auth` calls in general, and `supabase.api(...)` direct calls.

3. **`.single()` returns `{data: null, error: null}` when no row matches.** Different from the official SDK (which returns `PGRST116`). You must null-check `data`; don't rely on `error`.
   ```js
   const { data, error } = await supabase.from("x").select("*").eq("id", missing).single();
   // data === null, error === null
   ```

4. **`insert` / `update` / `upsert` always send `Prefer: return=representation`.** Hardcoded — no opt-out. Bulk-inserting 1000 rows ships 1000 rows back over the wire. For bulk imports, drop down to `supabase.api(path, ...)` or extend the client.

5. **`.not(col, op, val)` for IS NOT NULL must use `"is"`, not `"eq"`.** PostgREST quirk surfaced through this wrapper:
   ```js
   .not("hbl_no", "eq", null)  // ❌ no-op
   .not("hbl_no", "is", null)  // ✅ IS NOT NULL
   ```

6. **`getSession()` doesn't validate token expiry.** It only checks that `accessToken` and `user` exist in memory. `App.jsx:54` uses it for the "logged in?" check, so an expired-token user sees the authed UI flicker before the first request hits 401 and triggers refresh. If `refresh_token` is *also* expired, you get a "looks logged in, every request 401s" zombie state.

7. **The builder is single-use; filters accumulate on the same closure.** Don't share a partial builder across awaits — each `.eq(...)` pushes onto the same array:
   ```js
   // ❌ second await sees status=open AND status=closed
   const base = supabase.from("shipments").select("*").eq("business_type", "sea_export");
   const a = await base.eq("status", "open");
   const b = await base.eq("status", "closed");

   // ✅ rebuild from scratch each time
   const make = () => supabase.from("shipments").select("*").eq("business_type", "sea_export");
   ```
   Related: the builder is a thenable. Logging it inside an `async` context can trigger the fetch.

8. **Useful built-ins:** `.upsert(data, { onConflict: "col" })` for merge-duplicates, `.or("col1.eq.x,col2.eq.y")` takes a raw PostgREST expression string, `.in("col", [a,b,c])` for IN. No `.range()` / no count headers — paginate manually with `.limit()` + offset filters or extend the client.

### Shipments table — whitelist payload filter
`src/lib/shipment-fields.js` exports `SHIPMENT_DB_COLUMNS` and `filterShipmentPayload(payload)`. **Always run shipment writes through this filter.** History: the UI accumulated "ghost fields" set via `ch()` that didn't exist in the DB; the old supabase wrapper silently swallowed errors; after fixing that, unfiltered writes now throw schema-cache errors. When you add a column via a migration, add it to this Set.

### SOP workflow — single source of truth
`src/lib/constants.js` defines `SOP_NODES` (验货 / 订舱 / HBL / MBL / 费用) — each entry pairs a status field on `shipments` with its option list and which values count as "done". Used by:
- `Portal.jsx` 待办 tab (counts not-done shipments per node)
- Order detail SOP progress tab
- List page filters

`applicableNodesFor(shipment)` filters out HBL when `has_hbl=false`. Use `nodeStatusOf(shipment, node)` and `isNodeDone(node, value)` rather than reading raw status fields.

### Reference data cache
`src/lib/ref-cache.js` — in-process cache for dropdown lookups (`suppliers`, `customers`, `staff`, `pkg_units`, `cargo_types`). Use `getCachedRef(key)` instead of querying directly. After mutating a dictionary, call `invalidate(key)`. Cache lives until page reload.

### Permissions
`src/lib/permissions.js` — `canAccessPage(role, page)` for the 4 roles (`admin`, `operator`, `finance`, `sales`). Role lives at `user.profile.role`, loaded from the `user_profiles_view` view in `App.jsx` after login.

### UI layers — two coexisting styles
1. **TMS style** (newer, preferred): `src/styles/tms.css` (loaded by `App.jsx`) + `src/components/tms.jsx` (`TmsTitle`, `Tbl`, `TmsTabs`, `TmsInfoBar`, `TmsPagination`, `MiDropdown`, `Df`, etc.). Uses `className`. New screens should follow this.
2. **Legacy inline-styled** (`src/components/ui.jsx` — `Modal`, `Button`, `Input`, `Select`, `Badge`, `Field`, `ComboBox`, `Spinner`). Still in use inside `OrderDetail` / `NewOrderModal` in `Orders.jsx`.

### Portal flow graph
`src/pages/Portal.jsx` — module-switcher home page. The flow chart for each module (海运出口, 财务管理) is data-driven via `FLOW_BY_MODULE = { module_key: { stages, nodes } }`. To add a stage card or sub-menu, edit those structures rather than the JSX.

### Build chunking
`vite.config.js` manually splits `vendor-react`, `vendor-supabase`, `vendor`, and per-page chunks (`page-orders`, `page-partners`, `page-portal`). When adding a large page, consider adding a chunk rule.

## Database migrations

`migrations/*.sql` are PostgreSQL DDL applied **manually** to the Supabase project — there's no migration runner. Use `IF NOT EXISTS` so re-runs are safe. After adding a column you must also:
1. Add it to `SHIPMENT_DB_COLUMNS` in `src/lib/shipment-fields.js` (for `shipments` table).
2. If it's a status field driving SOP, add a node to `SOP_NODES` in `src/lib/constants.js`.

## i18n

`src/lib/i18n.js` — `t(key)` returns Chinese for keys in the `ZH` map, English (the key itself) otherwise. Default language is `zh`; `setLang("zh")` is called for `operator`/`sales` roles. Most UI strings are written directly in Chinese, not translated through `t()`.
