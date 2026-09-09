# Reference module map

The production app these patterns come from is laid out exactly like the
skeleton in `SKILL.md`. This file says what belongs in each module, and how
big each one realistically gets, so a new build lands the responsibilities in
the right place from day one.

## Backend

| Module | Size | What belongs in it |
|---|---|---|
| `netlify/functions/api.ts` | ~500 lines | The whole router. CORS const, `apiPath()` prefix stripping, one `try` translating `HttpError` into `{status, detail}`, public routes placed BEFORE `authenticate(req)`, the role deny-list, then one `if (path === ... && method === ...)` block per route. Ordering rule: a literal like `/things/archived` must precede the `/things/:id` match. |
| `lib/sheets.ts` | ~460 lines | Data layer. The `TABS` schema const, service-account RS256 JWT built with `node:crypto` plus a cached access token, `ensureSchema()` single-flight, `repairHeaders()` prefix-only migration, `readTable` / `readTableRow` / `appendRows` / `updateRow` / `updateCells` / `deleteRow` / `nextId`, and a read-only reader for a legacy import sheet. |
| `lib/stores.ts` | ~900 lines | Domain layer, one section per entity: `validateX()` collecting every error into one `ValidationError`, `xToDomain(row)` mapping, list / create / update / archive / restore. Derived totals are computed on read, never stored. |
| `lib/auth.ts` | ~130 lines | bcrypt hashes in the `Users` tab, JWT sign and verify, first-run admin seeding, `requireAdmin`, role helpers. |
| `lib/errors.ts` | 25 lines | The whole error contract — four classes, nothing else. |
| `lib/types.ts` | ~150 lines | Domain types, mirrored on the client. `parseRole()` defaults an unknown role to the least privileged one. |
| `lib/client-drafts.ts` | ~1000 lines | Public capability links end to end: token hashing, expiry, the status machine (draft, pending, submitted, approved, rejected, expired), a version nonce, per-field editability, and approval into a real record. The single biggest module — budget for it. |
| `lib/<rules>.ts` | ~160 lines | Pure functions over already-loaded data (conflict detection, scheduling checks). No I/O, so they are trivially testable. Domain rules live here, not in the router. |
| `lib/<role>-rules.ts` | ~160 lines | Field definitions for a restricted role plus the `isRolePath()` predicate. The deny-list lives beside that role's domain, not buried in the router. |
| `lib/documents.ts` | ~90 lines | docxtemplater plus pizzip, template read from `templates/`, shipped by `included_files`. |
| `lib/dates.ts` | ~120 lines | `parseDateLoose` (ISO, dd/MM/yyyy, spreadsheet serial numbers), `parseMoney`, `todayIso`. |

## Frontend

| Module | What belongs in it |
|---|---|
| `client/src/main.tsx` | Root selection instead of a router: a `/fill/:token` path gives the public page, a known public host gives the public home, everything else gives `AuthProvider > ToastProvider > App`. |
| `client/src/lib/api.ts` | The only `fetch` in the app. `request()` attaches the bearer token and turns 401 into "clear token plus notify"; `publicRequest()` deliberately does neither. One `api` object of named methods. Dev-only mock swap at the bottom. |
| `client/src/auth/AuthContext.tsx` | Token validated once on load via `/auth/me`, role booleans derived from `roles`, `setUnauthorizedHandler` wiring the API client back into React state. |
| `client/src/layout/nav.ts` | Nav groups with `adminOnly`, the phone bottom-bar list, page subtitles, and `isAllowed()`. Sidebar, bottom bar and page header all read this one file. |
| `client/src/layout/AppShell.tsx` | Sidebar plus topbar plus bottom nav, with `filters` and `actions` slots each page fills. |
| `client/src/App.tsx` | Loads data once after login, `refresh()` re-fetches in place, period scoping through `useMemo`, drawer state, and save/archive handlers that call the API then `refresh()`. |
| `client/src/lib/hooks.ts` | `useIsMobile()` using the SAME media query string as `styles.css`, plus `useScrollLock` and `useEscape`. |
| `client/src/lib/mockApi.ts` | In-memory API for UI work with no backend. Overrides only the methods it needs; the rest fall through to the real client. |
| `client/src/lib/i18n.ts` | Scoped translation — one page, not the whole app. `useDocumentDirection` flips `dir=rtl` on mount and restores it on unmount. |
| `client/src/styles.css` | Design tokens in `:root`, one compact breakpoint, `:focus-visible` rules, and cards with `min-width:0` so tables scroll inside them instead of stretching the page. |

## Ops

| File | Purpose |
|---|---|
| `netlify.toml` | Builds both packages, `node_bundler = "esbuild"`, `included_files` for document templates, the `/api/*` fallback redirect, and the SPA redirect LAST. |
| `scripts/backup.gs` | Apps Script running in a SECOND account: nightly copy of the spreadsheet, ten kept. Non-negotiable. |
| `scripts/migrate-*.mjs` | Idempotent one-time legacy import, safe to re-run. |
| `docs/ARCHITECTURE.md` | Written after the build: every column, route, flow and threat of that specific app. Expect ~70 KB, and keep it current — it is what makes the app handover-able. |
