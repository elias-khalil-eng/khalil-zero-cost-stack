---
name: khalil-zero-cost-stack
description: "Use when building or extending an internal business/operations app — bookings, clients, stock, jobs, invoices, appointments — that must run on free hosting with no database and no monthly bill, or when porting the React SPA + single serverless function + spreadsheet-as-database architecture to a new project. Also use when adding roles, public one-time client links, document generation, or a spreadsheet schema change to such an app."
---

# Khalil Zero-Cost Stack

## Overview

One architecture: **React SPA + ONE serverless function + a spreadsheet as the database**, all on one origin, on a free host. Proven in production: records, payments, expenses, generated documents, role separation and public one-time client links.

**Core principle:** the spreadsheet is a real database with real rules. Break the four invariants below and it corrupts quietly.

## When to Use

- Internal tool, a handful of named users, a few thousand records/year.
- Owner wants to open the data in a tool they already know.
- $0/month hosting is a requirement.

**Do NOT use for:** public sign-up, regulated data (health, cards), real concurrency, sub-100ms responses, tens of users. Run the fit test in `references/playbook.md` §3 before agreeing.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + TS strict, oxlint, plain CSS with design tokens |
| Routing | None. `main.tsx` picks a root from `window.location.pathname` |
| State | Context for auth + toast; `useState`/`useMemo` in `App.tsx`. No state library |
| Backend | ONE function, `export const config = { path: '/api/*' }`, hand-written regex router |
| Data | Google Sheets REST + hand-rolled RS256 service-account JWT (no SDK) |
| Auth | bcryptjs hashes in a `Users` tab, `jsonwebtoken` bearer tokens, 8h expiry |
| Host | Netlify — static `client/dist` + function on one origin, SPA fallback redirect last |

## Repository Skeleton

```
client/              React SPA (own package.json, vite, tsconfig)
netlify/functions/   api.ts — the whole backend, one file
lib/                 sheets.ts | stores.ts | auth.ts | errors.ts | types.ts | dates.ts + domain modules
templates/           document templates shipped via netlify.toml included_files
scripts/             migration + backup scripts
docs/                ARCHITECTURE.md (this app) + playbook (the method)
```

## Layer Contracts

| Layer | Owns | Never |
|---|---|---|
| `netlify/functions/api.ts` | HTTP: path match, method, status, role gate | Business rules, sheet reads |
| `lib/stores.ts` + domain modules | Validation, domain shapes, row↔domain mapping | HTTP objects, raw fetch |
| `lib/sheets.ts` | Rows, schema bootstrap, tokens | Domain meaning |
| `client/src/lib/api.ts` | The ONLY place that calls `fetch` | Business rules |
| views/components | Rendering + local UI state | Direct `fetch` |

## The Four Invariants

1. **Columns are read by position — append only.** Never insert or reorder a column in `TABS`. `repairHeaders` extends an exact prefix and refuses anything else.
2. **Every cell is read as text** (`cellText`), parsed at the domain layer. Write `valueInputOption=RAW` so ISO dates stay strings.
3. **Soft delete** (`DeletedAtUtc`), never `deleteRow`, for anything another row references. Archive + restore, not delete.
4. **The server enforces roles.** Hiding a tab in the client is never what keeps data private — a role check runs before routing and `requireAdmin` runs per route.

## Port These Directly

`templates/` holds working code to copy almost unchanged:

| File | What it gives you |
|---|---|
| `sheets.ts` | Service-account JWT, token cache, `ensureSchema` single-flight, `repairHeaders`, `readTable`, `appendRow(s)`, `updateRow`, `updateCells`, `deleteRow`, `nextId` — edit only the `TABS` const |
| `errors.ts` | `HttpError`/`ValidationError`/`NotFoundError`/`ConfigurationError` → `{ status, detail }` |
| `auth.ts` | bcrypt + JWT login, `authenticate`, `requireAdmin`, seeded first admin |
| `dates.ts` | Loose date/money parsing for spreadsheet cells |
| `netlify.toml`, `env.example` | Build, function bundling, redirects, env keys |

## Build Order

1. Fit test (`references/playbook.md` §3) → stop here if amber/red.
2. Foundation: repo skeleton, `TABS`, port `sheets.ts` + `errors.ts`, one read route end to end.
3. Auth: port `auth.ts`, `Users` tab, seeded admin, login page + `AuthContext`.
4. Core domain: one entity — validate → store → route → view — then repeat.
5. Deploy to Netlify with env vars; verify one origin serves app + API.
6. Import legacy data (idempotent script).
7. **Backup to a second Google account before launch** — version history dies with the file.
8. Everything else.

Details per phase: `references/playbook.md` §23. File-by-file map of the reference app: `references/reference-implementation.md`.

## Common Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Insert a column mid-`TABS` | Every existing row's data shifts | Append at the end, always |
| Skip `ensureSchema` single-flight | Google forks duplicate `<tab>_conflict<id>` sheets | Share one bootstrap promise |
| `updateRow` for a partial edit | Overwrites a concurrent edit's untouched cells | `updateCells` for selective writes |
| Public link goes through the authed `request()` | An expired client token logs the staff user out | Separate `publicRequest()`, no 401 handler |
| Role check only in the client nav | Any token reads everything | Deny-list path check + `requireAdmin` in the router |
| Money/dates trusted from JSON | Silent coercion | Strings in transit, parse + validate in `stores.ts` |
| Defer backups | One deleted file = total loss | Phase 6, before launch |

## Extras Worth Copying

- **Public capability links:** token hashed at rest, expiry, per-IP rate limit, `no-store` headers, routes placed *before* the bearer check, version nonce on submit. `references/playbook.md` §15.
- **Dev mock API:** `import.meta.env.DEV && ?mock=1` wraps the real API with in-memory data — UI work without the function or the sheet.
- **One compact breakpoint** shared by `styles.css` and `useIsMobile()`; below it: bottom nav, card lists instead of tables, bottom-sheet drawers.
- **Per-page nav metadata** (`nav.ts`: groups, `adminOnly`, hints, subtitles) so sidebar, bottom bar and page header stay in sync.
- **Document generation:** docxtemplater + pizzip in the function, template shipped via `included_files`. §17.
