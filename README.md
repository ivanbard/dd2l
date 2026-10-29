# dd2l

A direct, read-only Brightspace connector for a customizable, promptable student companion. The first target is one Queen's onQ account on Windows.

The connector signs in using your installed Google Chrome browser, reuses a protected school session, inventories course data, and can refresh one selected course every 15 minutes. It runs directly against Brightspace; no MCP server or model provider is involved.

## Run

Requires Windows, Node.js 24 or newer, and Google Chrome. From this directory:

```powershell
npm ci
npm run login
npm start -- courses
npm run audit
npm run status
```

Complete school sign-in and MFA in Chrome when requested. No school password is collected or saved. The default audit prefers the most recently accessed active, accessible course, falling back to another accessible enrollment if necessary. To select a particular course, use its ID from `courses`:

```powershell
npm run audit -- --course COURSE_ID --from 2026-09-01T00:00:00Z --to 2027-01-01T00:00:00Z
npm run sync -- --course COURSE_ID
```

Replace `COURSE_ID` with the numeric ID. `sync` keeps running in the terminal until Ctrl+C; shutdown waits for the current bounded audit to finish. Without `--course`, sync reuses the last selected course and pins that choice for subsequent polls. Keep the computer and terminal running. If the school session expires, the worker stops with `needs_login`; run `login`, then restart `sync`. Temporary failures back off, and server retry guidance is respected. Concurrent mutating commands are prevented by a process lock; `status` can inspect a running worker.

Run `npm start -- --help` for commands and `npm test` for the focused checks.

## What is collected

The audit enumerates all enrolled course offerings, then reads one course's content tree, assignment folders, quiz list, own grade values, announcements, discussion forums, own groups/sections, and calendar events. It attempts representative assignment detail, own submissions/feedback, rubric, discussion topic/posts, and file reads where matching objects exist. It does not infer that a quiz is absent from a successful empty quiz list; content and gradebook sources may expose additional quiz references.

Original permitted JSON fields are retained, with credential-bearing URL parameters redacted. File sampling is limited to one content file and one assignment attachment, each up to 2 MiB. Plain text/HTML is readable directly; PDF/Office byte access is recorded separately from text extraction. No assignments, grades, posts, quiz attempts, or completion states are written. Browser navigation may update normal school access timestamps.

## Local data and app integration

All runtime data lives outside this repository in `%LOCALAPPDATA%\dd2l`:

| File | Purpose |
| --- | --- |
| `session.dpapi` | Session cookies, XSRF material, API token and verified identity, encrypted with Windows DPAPI for the current Windows user. |
| `inventory.sqlite` | Private source payloads, representative file samples, per-resource coverage, successful retrieval times and current outcomes. This database contains personal coursework and grades and is **not encrypted**. |
| `summary.json` | Latest structural audit summary: counts, field names and coverage without course names, source IDs, grades or document bodies. Review before sharing. |
| `worker.lock` | Prevents competing login/audit/sync processes; a dead process's lock is recovered on the next run. |

`npm start -- logout` removes dd2l's saved session and local inventory. It does not sign out of other school applications. This is ordinary local deletion, not guaranteed forensic erasure or deletion of any copies you made.

The importable core is `BrightspaceClient` in `src/client.mjs`, `Session` in `src/session.mjs`, `Connector`/`sync` in `src/connector.mjs`, and `Store` in `src/store.mjs`. The CLI uses that same core. SQLite's `resources` table separates the latest observation from the last successful `data`, `last_success`, and `last_source`. Failed or partial reads preserve that data with its original source/window; a confirmed denial invalidates the affected cached resource. A complete enrollment read also invalidates cached courses no longer accessible. Data from different accounts cannot mix; run logout before switching accounts.

An audit can complete successfully as a command while reporting `complete: false`: resource-level denials, unavailable routes, or partial collections remain visible. A successful collection read establishes coverage of that endpoint, not of every activity the website or an external tool may contain.

See [verified live findings](docs/live-audit.md), [the capability map](docs/brightspace-discovery.md), and [the connector design](docs/direct-connector.md).

The interface, prompt retrieval, full document extraction, external LTI integrations, unattended Windows startup, and a full audit of every course are later milestones.

Do not commit credentials, session cookies, access tokens, downloaded coursework, grades, or classmates' personal information. Discovery evidence should contain access outcomes and field names rather than private payloads.
