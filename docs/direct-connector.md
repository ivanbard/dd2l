# Application-owned Brightspace connector

Status: design and source investigation; not implemented. This supersedes the earlier recommendation to depend on MCP for the live audit. The initial target remains one student's Queen's onQ account.

## Decision

Build a direct integration owned by dd2l. Use the existing Brightspace MCP server as a source of endpoint knowledge and observed edge cases. The app should call connector code directly and receive structured results. MCP tool registration, transport, conversation formatting and tool response limits do not belong in the application's data path.

Owning the connector lets us retrieve fields the tool outputs omit, traverse resources thoroughly, control freshness, retain source metadata, and expose capabilities and failures explicitly. It does not increase the student's permissions or make third-party LTI content accessible automatically.

## What source inspection established

Inspected the installed `brightspace-mcp-server` package, version `5.1.27`, whose package metadata identifies [Rohan Muppa's repository](https://github.com/RohanMuppa/brightspace-mcp-server). No saved credentials or browser session files were inspected.

| Source module in the installed build | Relevant behavior |
| --- | --- |
| `auth/browser-auth.js` | Uses Playwright for browser sign-in, observes bearer authentication, and saves browser state/session material. |
| `auth/token-mint.js` | Exchanges a valid Brightspace session cookie plus XSRF token at `/d2l/lp/auth/oauth2/token` for an API bearer token. This is the site's session-based mechanism, distinct from registering our own OAuth client. |
| `auth/xsrf-fetch.js` | Reads session-backed home-page HTML to obtain XSRF material. Some expired sessions return HTTP 200 with a login redirect stub. |
| `auth/token-manager.js` | Reuses session material for token renewal, coalesces concurrent renewals, and recognizes when interactive login is needed. |
| `api/client.js` | Makes HTTP requests directly with bearer or cookie authentication. Browser-page reads can require cookies even when API reads use bearer tokens. |
| `api/version-discovery.js` | Discovers tenant LP/LE versions from the public versions endpoint. |
| `api/paginate.js` | Handles bookmark and next-link pagination with loop/page limits. Our connector must also return a partial-coverage result when such limits interrupt a fetch. |
| `tools/get-my-courses.js` | Fetches enrollments, then maps selected fields into a tool response. A direct connector can retain the original permitted fields alongside an app-facing view. |

These are source findings, not proof of successful access at Queen's. Our previous automatic and interactive sign-in attempts remain unsuccessful; their root cause has not been established. Replacing MCP alone is not evidence that authentication will start working.

The reference package is MIT licensed. If we copy code or substantial portions, retain its copyright and permission notice with the copied code. This design document copies no implementation.

## First delivery model

Start with a local connector on the student's computer. Use interactive school sign-in and MFA, then reuse the resulting session for background API reads while valid. Keep school passwords out of the connector. A single local process owns authentication and sync; UI and prompt handlers eventually read the synchronized data.

Use Node.js for the first implementation: it is already available here, has native HTTP support, and aligns with the reference and browser automation ecosystem. A browser automation dependency is justified if needed for SSO; do not add an MCP SDK. Choose credential persistence using the operating system's protected storage before saving any session credentials. A browser profile or Playwright storage-state file contains credentials and must not be treated as an ordinary cache.

Registered OAuth remains the preferred path to evaluate for a school-approved hosted application. That requires a separate Queen's registration/approval investigation. Do not build both authentication paths now or assume a local browser session can be transferred into a reliable hosted service.

## Ownership within the application

These are responsibilities within one application, not separately deployed services:

1. **Session handling:** interactive login, protected session persistence, identity/tenant checks, token renewal, sign-out and explicit authentication state. Share one renewal operation across concurrent reads. Never forward credentials across hosts or log cookies, tokens or XSRF values.
2. **Brightspace reads:** validated same-tenant requests, route-compatible API versions, pagination, bounded requests, rate-limit handling and original response fields. Return access failures separately from valid empty results. Restrict discovery to read-only resources; acquiring authentication tokens is not a course-data mutation.
3. **Discovery and synchronization:** enumerate courses and resources, record capabilities, persist observations and progress, and resume after interruption. Fetch related object details only where IDs and permissions permit. Never expose a half-finished snapshot as complete.
4. **Local data:** retain source IDs, relationships, retrieval times, source links, content availability and coverage. A local SQLite database is sufficient once repeatable sync is proven. Raw source payloads can be retained privately when needed to investigate field coverage; they do not belong in Git. Normalized views serve the later interface and prompt retrieval.

The data path is `Brightspace -> direct connector -> local data -> interface / prompt retrieval`. Prompts should generally read synchronized data instead of triggering a full course crawl on every question. Explicit refresh can request a bounded update later.

## What continuous operation can mean

The connector can continue polling when the computer and worker are running and the school session remains usable. It can restart, resume work, refresh API tokens, retry temporary failures, and report freshness. It cannot promise unattended access forever: session revocation, sign-in frequency policies, MFA, sleep and network loss still apply.

The minimum state model is:

- `ready`: authenticated and able to make requests.
- `syncing`: a bounded update is in progress; overlapping syncs join or wait.
- `retry_wait`: a network, rate-limit or server failure interrupted work; preserve prior data and retry with backoff, respecting server retry guidance.
- `needs_login`: the session is confirmed expired or revoked; pause background authentication attempts and request interactive login.

An endpoint-specific 403 is a capability/access result, not automatically a reason to log out the whole account. A login HTML page or redirect must not be accepted as a successful JSON response. A token-renewal failure caused by the network must not be mistaken for proven session expiry.

Start with bounded polling; measure request cost and freshness needs before selecting a schedule. Use modified-since filters or conditional reads only on endpoints that support them. Periodically reconcile full collections to detect removals; timestamp filtering alone cannot establish deletions. A partial or failed run cannot delete previously collected data. Confirmed loss of access needs explicit cache invalidation, distinct from temporary failure.

Do not introduce a message broker, distributed workers, plugin system, multi-school abstraction, webhook infrastructure, or separate vector database for this milestone.

## First implementation milestone: direct access audit

Build a small runnable command and an importable connector core. The command exercises the same core the eventual app will use; it is not another protocol server. Its first end-to-end path is:

1. Open school sign-in, let the user complete MFA, and verify the authenticated identity and tenant.
2. Read supported versions and all pages of the account's course enrollments directly.
3. For one selected accessible course, read content structure, assignment folders, quiz metadata, own grades, announcements and discussion structure. Read the calendar over an explicit window. Inspect representative attachments, feedback, rubric details and external links as discovered.
4. Produce a private inventory containing original permitted field names, counts, availability, pagination/coverage, errors and source routes. Produce a separate shareable summary without credentials, personal payloads or course identifiers.
5. Restart the command and verify that protected session reuse works, or that it clearly reports the need to sign in. Do not add a scheduler until this behavior is proven.

Acceptance requires at least one successful direct authenticated inventory and a browser comparison for the same course. An authentication failure is a reported blocker, not a successful audit. File byte access and useful text extraction are separate checks. Missing optional resources remain untested until a representative course/object is found.

Focused automated checks should cover pagination continuation/loops, rejected cross-origin redirects/next links, successful-empty versus denied/failed results, login HTML masquerading as success, one renewal shared by concurrent requests, and preservation of prior data after an interrupted update. Credential persistence needs its own platform verification before use.

After this milestone, implement persistent synchronization, then text extraction/retrieval for the resources actually observed, then the customizable interface. The capability map remains the checklist for measured coverage; it is not a promise to support every platform feature before the first useful app.
