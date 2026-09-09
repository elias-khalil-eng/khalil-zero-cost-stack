# Reference implementation map — `lamiss-online`

Live app the patterns come from. Paths are relative to the repo root.
Read a file here when the playbook section is not concrete enough.

## Backend

| File | Size | What to learn from it |
|---|---|---|
| `netlify/functions/api.ts` | ~520 lines | The whole router. CORS const, `apiPath()` prefix stripping, one `try` translating `HttpError` into `{status, detail}`, public routes placed BEFORE `authenticate(req)`, role deny-list, then one `if (path === ... && method === ...)` block per route. Ordering rule: `/reservations/archived` must precede `/reservations/:id`. |
| `lib/sheets.ts` | ~460 lines | Data layer. `TABS` schema const, service-account RS256 JWT built with `node:crypto` plus cached access token, `ensureSchema()` single-flight, `repairHeaders()` prefix-only migration, `readTable` / `readTableRow` / `appendRows` / `updateRow` / `updateCells` / `deleteRow` / `nextId`, `readImportSheet` for legacy sheets. |
| `lib/stores.ts` | ~900 lines | Domain layer per entity: `validateX()` collecting every error into one `ValidationError`, `xToDomain(row)` mapping, list / create / update / archive / restore. Derived data (`paidTotal`) computed on read, never stored. |
| `lib/auth.ts` | ~130 lines | bcrypt hashes in the `Users` tab, JWT sign and verify, `ensureAdminSeeded()` on first run, `requireAdmin`, role helpers. |
| `lib/errors.ts` | 25 lines | The whole error contract. |
| `lib/types.ts` | ~150 lines | Domain types, mirrored in `client/src/lib/types.ts`. `parseRole()` defaults an unknown role to the least privileged one. |
| `lib/client-drafts.ts` | ~1000 lines | Public capability links end to end: token hashing, expiry, status machine (draft, pending, submitted, approved, rejected, expired), version nonce, per-field editability, approval into a real reservation. |
| `lib/conflicts.ts` | ~160 lines | Pure function over the loaded list, no I/O. Domain rules live here, not in the router. |
| `lib/measurement-rules.ts` | ~160 lines | Field definitions plus `isSeamstressPath()`. The role deny-list lives beside that role's domain. |
| `lib/certificates.ts` | ~90 lines | docxtemplater plus pizzip, template read from `templates/`, shipped by `included_files`. |
| `lib/dates.ts` | ~120 lines | `parseDateLoose` (ISO, dd/MM/yyyy, Sheets serial numbers), `parseMoney`, `todayIso`. |

## Frontend

| File | What to learn from it |
|---|---|
| `client/src/main.tsx` | Root selection instead of a router: `/fill/:token` gives the public page, a known client host gives the public home, everything else gives `AuthProvider > ToastProvider > App`. |
| `client/src/lib/api.ts` | The only `fetch` in the app. `request()` attaches the bearer token and turns 401 into "clear token plus notify"; `publicRequest()` deliberately does neither. One `api` object of named methods. Dev-only `withMock()` swap at the bottom. |
| `client/src/auth/AuthContext.tsx` | Token validated once on load via `/auth/me`, `isAdmin` and `isSeamstress` derived from roles, `setUnauthorizedHandler` wiring the API client back into React state. |
| `client/src/layout/nav.ts` | `NAV` groups with `adminOnly`, `BOTTOM_TABS`, `PAGE_SUBTITLE`, `isAllowed()`. Sidebar, bottom bar and page header all read this one file. |
| `client/src/layout/AppShell.tsx` | Sidebar plus topbar plus bottom nav, with `filters` and `actions` slots each page fills. |
| `client/src/App.tsx` | Loads data once after login, `refresh()` re-fetches in place, season (`year`) scoping through `useMemo`, drawer state, save and archive handlers that call the API then `refresh()`. |
| `client/src/lib/hooks.ts` | `useIsMobile()` using the SAME media query string as `styles.css`, plus `useScrollLock` and `useEscape`. |
| `client/src/lib/mockApi.ts` | In-memory API for UI work with no backend. Overrides only the methods it needs, the rest fall through. |
| `client/src/lib/i18n.ts` | Scoped translation: one page only. `useDocumentDirection` flips `dir=rtl` on mount and restores it on unmount. |
| `client/src/styles.css` | Design tokens in `:root`, one compact breakpoint, `:focus-visible` rules, cards with `min-width:0` so tables scroll inside them instead of stretching the page. |

## Ops

| File | Purpose |
|---|---|
| `netlify.toml` | Builds both packages, `node_bundler = "esbuild"`, `included_files` for the docx template, `/api/*` fallback redirect, SPA redirect LAST. |
| `scripts/backup.gs` | Apps Script running in a SECOND Google account: nightly copy, ten kept. Non-negotiable. |
| `scripts/migrate-sqlite.mjs` | Idempotent one-time legacy import. |
| `docs/ARCHITECTURE.md` | 74 KB. Full spec of this app: every column, route, flow and threat. Write the equivalent for a new app. |
