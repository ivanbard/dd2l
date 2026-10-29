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
npm start -- syllabus
npm run status
```

Complete school sign-in and MFA in Chrome when requested. No school password is collected or saved. The default audit prefers the most recently accessed active, accessible course, falling back to another accessible enrollment if necessary. To select a particular course, use its ID from `courses`:

```powershell
npm run audit -- --course COURSE_ID --from 2026-09-01T00:00:00Z --to 2027-01-01T00:00:00Z
npm run sync -- --course COURSE_ID
npm start -- syllabus --course COURSE_ID
```

Replace `COURSE_ID` with the numeric ID. `sync` keeps running in the terminal until Ctrl+C; shutdown waits for the current bounded audit to finish. Without `--course`, sync reuses the last selected course and pins that choice for subsequent polls. Keep the computer and terminal running. If the school session expires, the worker stops with `needs_login`; run `login`, then restart `sync`. Temporary failures back off, and server retry guidance is respected. Concurrent mutating commands are prevented by a process lock; `status` can inspect a running worker.

Run `npm start -- --help` for commands and `npm test` for the focused checks.

## What is collected

The audit enumerates all enrolled course offerings, then reads one course's content tree, assignment folders, quiz list, own grade values, announcements, discussion forums, own groups/sections, and calendar events. It attempts representative assignment detail, own submissions/feedback, rubric, discussion topic/posts, and file reads where matching objects exist. It does not infer that a quiz is absent from a successful empty quiz list; content and gradebook sources may expose additional quiz references.

Syllabus retrieval is part of normal audit/sync and can also run alone with `syllabus`. It reads the optional overview and its attachment, relevant module/topic descriptions, and file/HTML topics under syllabus or course-information modules. It preserves each source's location, parent context, retrieval time and current access/text status. An overview-specific 404 means `not_configured`; unrelated 404s retain their original meaning. An empty overview is not counted as a readable syllabus. Different documents remain separate instead of being silently merged into one authoritative text.

Original permitted JSON fields are retained, with credential-bearing URL parameters redacted. Syllabus reads are bounded to 100 candidate sections and 20 documents per course, each up to 2 MiB; the ordinary audit also samples a content file and assignment attachment. PDFs, HTML and plain text support production text extraction. PDF parsing runs in an isolated worker with a 30-second deadline, 256 MiB JavaScript heap limit, a 250-page limit, and explicit truncation beyond one million text characters. Office files, scans without embedded text, and arbitrary linked targets remain explicit gaps. Linked-topic metadata is resolved, but school credentials are never sent to arbitrary links. No assignments, grades, posts, quiz attempts, or completion states are written. Browser navigation may update normal school access timestamps.

## Local data and app integration

All runtime data lives outside this repository in `%LOCALAPPDATA%\dd2l`:

| File | Purpose |
| --- | --- |
| `session.dpapi` | Session cookies, XSRF material, API token and verified identity, encrypted with Windows DPAPI for the current Windows user. |
| `inventory.sqlite` | Private source payloads, representative file samples, per-resource coverage, successful retrieval times and current outcomes. This database contains personal coursework and grades and is **not encrypted**. |
| `summary.json` | Latest structural audit summary: counts, field names and coverage without course names, source IDs, grades or document bodies. Review before sharing. |
| `syllabus-summary.json` | Latest syllabus-only command summary with readability, formats, coverage and unresolved counts. |
| `worker.lock` | Prevents competing login/audit/sync processes; a dead process's lock is recovered on the next run. |

`npm start -- logout` removes dd2l's saved session and local inventory. It does not sign out of other school applications. This is ordinary local deletion, not guaranteed forensic erasure or deletion of any copies you made.

The importable core is `BrightspaceClient` in `src/client.mjs`, `Session` in `src/session.mjs`, `Connector`/`sync` in `src/connector.mjs`, and `Store` in `src/store.mjs`. `Connector.syllabus({ course })` uses the same retrieval logic as `audit` without changing the selected sync course. The CLI uses that same core. SQLite's `resources` table separates the latest observation from the last successful `data`, `last_success`, and `last_source`. Failed or partial reads preserve that data with its original source/window; a confirmed denial invalidates the affected cached resource. A complete enrollment read also invalidates cached courses no longer accessible. Data from different accounts cannot mix; run logout before switching accounts.

Syllabus content lives in individual `syllabus_source` resource rows; the `syllabus` row is a catalog of source keys and current outcomes, not a duplicate of every document's text. A failed fetch or extraction retains the source's prior successful data as stale. Explicit access restrictions invalidate that source's cached data, and a documented missing overview clears the overview/attachment cache. Catalog readability means some source text was retrieved, while `textCoverageComplete` also accounts for unsupported formats, restrictions, read limits and unexpanded links. Neither field establishes that every possible syllabus location was discovered.

An audit can complete successfully as a command while reporting `complete: false`: resource-level denials, unavailable routes, or partial collections remain visible. A successful collection read establishes coverage of that endpoint, not of every activity the website or an external tool may contain.

The interface, prompt retrieval, Office extraction/OCR, external LTI integrations, unattended Windows startup, and a full audit of every course are later milestones.

Do not commit credentials, session cookies, access tokens, downloaded coursework, grades, or classmates' personal information. Discovery evidence should contain access outcomes and field names rather than private payloads.
