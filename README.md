# khalil-zero-cost-stack

A Claude Code / Agent Skill for building internal business apps on **$0/month hosting**: a React SPA, ONE serverless function, and a spreadsheet as the database.

Extracted from a production internal operations app — records, payments, expenses, roles, generated Word documents and public one-time client links — running on Netlify + Google Sheets.

## Install

Clone into your personal skills directory:

```bash
git clone https://github.com/elias-khalil-eng/khalil-zero-cost-stack.git ~/.claude/skills/khalil-zero-cost-stack
```

Windows (PowerShell):

```powershell
git clone https://github.com/elias-khalil-eng/khalil-zero-cost-stack.git "$env:USERPROFILE\.claude\skills\khalil-zero-cost-stack"
```

Claude picks it up on the next session. Invoke it with `/khalil-zero-cost-stack`, or let it trigger on its own when you start an app of this shape.

## What's inside

| Path | Contents |
|---|---|
| `SKILL.md` | The skill: stack table, repo skeleton, layer contracts, four invariants, build order, mistakes table |
| `references/playbook.md` | The full method — fit test, capacity model, nine data primitives, concurrency toolkit, auth hardening, security baseline, build sequence, exit ramp |
| `references/reference-implementation.md` | File-by-file map of the production app the patterns come from |
| `templates/sheets.ts` | Spreadsheet data layer: service-account RS256 JWT, token cache, schema bootstrap, header migration, row primitives. Edit only the `TABS` const |
| `templates/auth.ts` | bcrypt + JWT login, `authenticate`, `requireAdmin`, seeded first admin |
| `templates/errors.ts` | `HttpError` family → `{ status, detail }` responses |
| `templates/dates.ts` | Loose date and money parsing for spreadsheet cells |
| `templates/api-router.ts` | Backend skeleton: one function, one router, public routes before the bearer check |
| `templates/client-api.ts` | Frontend skeleton: the only module that calls `fetch`, plus the separate public-link client |
| `templates/netlify.toml`, `templates/env.example` | Build, function bundling, redirects, environment keys |

## The architecture in one line

React 19 + Vite SPA (no router, no state library) → one Netlify Function at `/api/*` with a hand-written router → domain/validation layer → spreadsheet accessed over REST with a hand-rolled service-account JWT. Bearer tokens with roles enforced server-side. Nightly backup into a second account.

## When NOT to use it

Public sign-up, regulated data, real concurrency, sub-100 ms responses, or more than a few dozen users. Run the fit test in `references/playbook.md` §3 first.

## License

MIT
