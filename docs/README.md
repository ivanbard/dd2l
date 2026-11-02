# dd2l guide

A direct, read-only Brightspace connector for a customizable, promptable student companion. The first target is one Queen's onQ account on Windows.

The connector signs in using your installed Google Chrome browser, reuses a protected school session, inventories course data, and can refresh a selected course or rotate through all accessible courses. It runs directly against Brightspace; no MCP server or model provider is involved.

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
npm run audit -- --all
npm run sync -- --all
```

Replace `COURSE_ID` with the numeric ID. `sync` keeps running in the terminal until Ctrl+C; shutdown waits for the current bounded audit to finish. Without `--course`, sync reuses the last selected course and pins that choice for subsequent polls. Keep the computer and terminal running. If the school session expires, the worker stops with `needs_login`; run `login`, then restart `sync`. Temporary failures back off, and server retry guidance is respected. Concurrent mutating commands are prevented by a process lock; `status` can inspect a running worker.

`--all` rotates through up to five accessible course offerings per pass, including historical courses still accessible to this account. It preserves the pinned single-course selection. Each course's assignment, document and discussion cursors are saved after its audit commits; another pass resumes the remaining objects. Sync waits 15 minutes between passes, so a full sweep can take multiple polling intervals. A rate-limit response stops further reads in that pass and honors the server's retry delay.

For a sustained foreground check, run `npm run soak -- --minutes 180`. This uses the real sync cadence, writes structural results to the ignored `.dd2l/soak-summary.json`, and stops after the observation window and any in-progress audit finish. It does not force session expiry or bypass MFA. A one-minute smoke run has passed; a multi-hour run remains to be performed.

Run `npm start -- --help` for commands and `npm test` for the focused checks.

## UI prototype

```powershell
npm run ui
```

Open the printed [local URL](http://127.0.0.1:4173). The home screen implements the [Figma Home design](https://www.figma.com/design/ASr0dnwupPLbXmeT1AiPGg/dd2l?node-id=1-3): prompt, course selector, sidebar and profile. Search finds keyword matches in cached course materials and displays source excerpts with retrieval dates and stale-cache labels. Courses opens a material browser; Settings and Profile show connection status and refresh instructions. The source link opens the course in onQ using your normal browser sign-in.

Local search reads the existing inventory without changing it or loading school credentials. Run `npm run audit -- --all` or keep `npm run sync -- --all` running separately to collect data. Each search reads the current cache. Only courses confirmed accessible in cached enrollments are shown; unavailable material stays unavailable, and coverage is limited to what the connector has collected. The mode dropdown beside the course selector defaults to **Local search**, which matches keywords; choosing a connected ChatGPT model generates grounded answers when you submit.

The homescreen includes upcoming deadlines, recent class announcements, and shortcuts to classes or cached materials. **Customize** enables a four-column, eight-row grid: drag a widget to move it live, or drag any edge or corner to resize it. A cell preview marks the proposed placement; overlapping or out-of-bounds drops return to the original position. Escape cancels the gesture. Focus a widget and use arrow keys to move or Shift + arrows to resize without a pointer. Remove widgets or add them back with **Add widget**. Narrow screens stack widgets normally and show a horizontally scrollable grid while customizing. **Pin shortcut** opens a searchable class/material picker; selecting a shortcut browses its cached sources. New search returns to the homescreen.

Waiting states use the Dot Matrix Square 12 / Origin Wave indicator: search and AI requests, course/model loading, widget refreshes, panels and account actions. Its 5×5 ripple is adapted to plain JavaScript/CSS, bundled locally and static when reduced motion is preferred. Loading states clear after success, failure or cancellation; concurrent loads share an indicator until all finish. Attribution and the upstream usage license are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Layouts and up to 20 shortcut references save in browser local storage, separately for each school account and demo mode. They do not sync across browsers or ports. Shortcut references include course-material titles and remain after CLI logout; clear this site's browser data to remove saved preferences. Inaccessible material is not rendered even if its reference remains pinned. **Refresh cache view** rereads the local inventory, without running a school sync. Deadlines require explicit due dates, announcements use publication dates when available, and stale cache entries remain labeled; an empty widget does not establish that onQ has no updates.

### Use your ChatGPT plan

In the live UI, open Settings or Profile and choose **Continue with ChatGPT**. Complete registration and plan-use consent on OpenAI's website, then return to dd2l. No API key is needed. The small mode dropdown below the prompt starts on **Local search**, even with a connected account. Choose a model to see the coursework-sharing notice, then press Enter or the send button to ask it. Changing the selection never submits a prompt. Select **Local search** to return to local retrieval; reloading or starting a new search also restores that default. Plan and usage information stays in Settings.

Each AI request sends the question and up to eight matching excerpts (at most 700 characters each), including titles, course names, retrieval dates and stale-cache labels, to OpenAI. The answer displays those sources with numbered references. The model is instructed to use only this evidence and report gaps; verify generated claims against the excerpts. Keyword retrieval can miss relevant material. No tool execution, Brightspace credentials, complete inventory upload, or persistent conversation history is provided. Each submission with an AI model selected grants permission for that answer; local mode never sends the question to an AI provider. Editing the question or changing modes or courses cancels an in-flight answer.

AI answers can compose interactive checklists, comparison tables, and grouped source cards in the same matte printed style as the homescreen widgets. The selected model chooses useful sections or plain text for a simple question. The Responses request uses [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) with a bounded JSON schema; the app validates the result and citation numbers before rendering trusted components. No model-generated HTML, scripts, URLs or styling execute. Invalid layouts fall back to a bounded text summary and the available sources, with a notice; incomplete streams still fail rather than appearing successful. Provider refusals display as text. A model must support the structured-output format; errors do not trigger another model or a second billed request.

Checklist checks and progress belong to the current answer and reset on a new question. They do not update Brightspace or save to your homescreen. Every generated item or comparison row links to supplied source excerpts; stale cache labels remain visible. Valid structure and citations do not prove factual correctness or complete course coverage. Source retrieval still uses the existing keyword search and its limits.

This uses OpenAI's documented [local-app Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source), with PKCE, state/nonce and signed identity validation. A stable host ID and separate account registrations are saved under `%LOCALAPPDATA%\dd2l\llm\accounts.dpapi`, encrypted with Windows DPAPI. Refreshes are serialized across processes using a separate lock; the school sync can run alongside AI. Tokens stay on the server and never enter browser storage. `jose` handles JWT signature and claim verification. Remote Responses requests set `store: false` and `stream: true`; partial/failed streams do not become successful answers.

Settings lists saved account/workspace registrations and supports switching, reauthorization and sign-out of the active account. Sign-out revokes its renewable session when possible and removes its local tokens; a failed remote revocation is reported. The non-secret registration and host ID remain for later sign-in. School CLI logout affects only school data; disconnect ChatGPT separately in the UI. Manage plan/app limits in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). Usage shares the account's plan limits and may use credits according to settings you authorize there; dd2l never falls back to API-key billing. Eligibility, available models and limits are controlled by OpenAI.

ChatGPT is the first supported subscription provider. There is no universal subscription login: other providers need separately verified authentication and plan-use support. Demo mode disables provider sign-in and AI requests and never loads AI credentials. Commercial or remotely hosted deployments need a separate access review against [OpenAI's integration requirements](https://developers.openai.com/siwc/request-client-id).

For an isolated walkthrough with fictional data and no school login:

```powershell
npm run ui -- --demo
```

Demo mode is visibly labeled and never reads the real inventory. Try `recursion`, `memory`, or `syllabus`, filter by course, or browse Courses. Use `--port 4174` to run another instance. The server binds only to `127.0.0.1`, rejects foreign browser origins, and serves private responses without caching. Stop it with Ctrl+C when finished.

`npm test` covers retrieval, cache access, widget layout validation, deadline/announcement projection and HTTP boundaries. `npm run ui:check` uses installed Chrome headlessly to check assets, core interactions, widget drag/move/resize/pin/removal and persistence, mobile overflow and error recovery; screenshots go in ignored `.dd2l/ui-*.png`. SF Pro uses the system font when available, with Segoe UI as the Windows fallback.

## What is collected

The audit enumerates course offerings, then reads the chosen course's content tree, assignment folders, quiz list, own grade values, announcements, discussion forums, own groups/sections, and calendar events. It traverses assignments and accessible content files in resumable batches, including own submissions, released feedback, rubric tables and attachments. Discussion forum/topic/post reads and file attachments have independent parent-specific cursors. `traversal` reports the batch limits; an unfinished batch is not reported as complete.

Assignment traversal prioritizes graded and rubric-bearing folders, then continues through the others, up to 25 per pass. Feedback targets your verified user identity or your own resolved group; an unresolved group remains unknown. Full embedded rubric tables are retained, with a dedicated association lookup used when needed. Feedback denials are not interpreted as ungraded or unsubmitted work.

Quiz discovery combines list entries, explicit content references, gradebook candidates and permitted grade/tool associations. A grade item named “Quiz” is only a candidate until a real quiz identifier/association is verified. Quiz metadata and attempts are read separately; attempts are explicitly filtered to the verified current user. Denied or unread attempts remain unknown. For events marked recurring, the connector requests the server's occurrence list rather than guessing dates or timezone rules; this route still needs a real accessible recurring-event example on onQ.

Syllabus retrieval is part of normal audit/sync and can also run alone with `syllabus`. It reads the optional overview and its attachment, relevant module/topic descriptions, and file/HTML topics under syllabus or course-information modules. It preserves each source's location, parent context, retrieval time and current access/text status. An overview-specific 404 means `not_configured`; unrelated 404s retain their original meaning. An empty overview is not counted as a readable syllabus. Different documents remain separate instead of being silently merged into one authoritative text.

Original permitted JSON fields are retained, with authentication/password fields and credential-bearing URL parameters redacted. Modern DOCX/PPTX/XLSX, PDF, HTML and plain text support local extraction; Office macros and formulas are not executed. Images and scanned PDF pages can use Windows OCR with an installed user-profile OCR language. OCR text is marked for review. Legacy binary Office files, arbitrary archives and encrypted documents are not supported by these readers.

Documents have a 20 MiB read limit; raw bytes are retained only up to 2 MiB, while larger successfully parsed documents retain text and metadata. PDF workers have a 30-second deadline, 256 MiB JavaScript heap limit and 250-page limit. At most ten empty-text PDF pages per document are rendered for OCR, with a 16-million-pixel image limit. Text is capped at one million characters. Office expansion, HTML complexity and document/link counts are bounded; limits stay explicit as partial coverage. Syllabus retrieval processes up to 100 candidate sections and 20 document attempts per course. Ordinary traversal handles 20 content files per pass, five forums, five topics per selected forum, and two attachments per selected assignment/topic. API collections follow pagination with existing loop/page limits.

Linked school documents use same-school session cookies only on approved content paths, or use their verified API topic IDs. Public reference documents are read only from explicitly supported hosts without school credentials. Source links are deduplicated; referenced websites are not recursively crawled through their citations/navigation. Surveys, self-enrollment and other activity actions are never activated by the document reader. Public YouTube caption retrieval preserves timestamps when the provider returns a caption track; sign-in/bot checks or absent captions remain unavailable. Private SharePoint, Teams, publisher/LTI content and other providers need separate readers/authorization. No assignments, grades, posts, quiz attempts, or completion states are written. Browser navigation may update normal school access timestamps.

## Local data and app integration

All runtime data lives outside this repository in `%LOCALAPPDATA%\dd2l`:

| File | Purpose |
| --- | --- |
| `session.dpapi` | Session cookies, XSRF material, API token and verified identity, encrypted with Windows DPAPI for the current Windows user. |
| `inventory.sqlite` | Private source payloads, extracted text/small files, traversal cursors, per-resource coverage, successful retrieval times and current outcomes. This database contains personal coursework and grades and is **not encrypted**. |
| `summary.json` | Latest structural audit summary: counts, field names and coverage without course names, source IDs, grades or document bodies. Review before sharing. |
| `syllabus-summary.json` | Latest syllabus-only command summary with readability, formats, coverage and unresolved counts. |
| `worker.lock` | Prevents competing login/audit/sync processes; a dead process's lock is recovered on the next run. |

`npm start -- logout` removes dd2l's saved session and local inventory. It does not sign out of other school applications. This is ordinary local deletion, not guaranteed forensic erasure or deletion of any copies you made.

The importable core is `BrightspaceClient` in `src/client.mjs`, `Session` in `src/session.mjs`, `Connector`/`sync` in `src/connector.mjs`, and `Store` in `src/store.mjs`. `Connector.syllabus({ course })` uses the same retrieval logic as `audit` without changing the selected sync course. The CLI uses that same core. SQLite's `resources` table separates the latest observation from the last successful `data`, `last_success`, and `last_source`. Failed or partial reads preserve that data with its original source/window; a confirmed denial invalidates the affected cached resource. A complete enrollment read also invalidates cached courses no longer accessible. Data from different accounts cannot mix; run logout before switching accounts.

Syllabus content lives in individual `syllabus_source` resource rows; the `syllabus` row is a catalog of source keys and current outcomes, not a duplicate of every document's text. A failed fetch or extraction retains the source's prior successful data as stale. Explicit access restrictions invalidate that source's cached data, and a documented missing overview clears the overview/attachment cache. Catalog readability means some source text was retrieved, while `textCoverageComplete` also accounts for unsupported formats, restrictions, read limits and unexpanded links. Neither field establishes that every possible syllabus location was discovered.

An audit can complete successfully as a command while reporting `complete: false`: resource-level denials, unavailable routes, or partial collections remain visible. A successful collection read establishes coverage of that endpoint, not of every activity the website or an external tool may contain.

Improved semantic retrieval, additional model providers, private course-content provider integrations and unattended Windows startup remain later milestones.

Do not commit credentials, session cookies, access tokens, downloaded coursework, grades, or classmates' personal information. Discovery evidence should contain access outcomes and field names rather than private payloads.
