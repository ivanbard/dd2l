# Brightspace data discovery

Research started October 28, 2026; updated October 29, 2026, America/New_York. Initial scope: the user's own student account at Queen's onQ, `https://onq.queensu.ca`.

## What we know so far

Brightspace has documented interfaces for most of the information needed for a useful student companion. The installed Brightspace MCP connector offers a substantial reference implementation. Following the user's direction, the application will own a direct connector rather than depend on MCP tool calls. See [the direct connector design](direct-connector.md).

**The direct connector now has verified authenticated access.** It retrieved 45 enrollments and representative course data, reused a protected session, and renewed its API token. See [live findings and remaining gaps](live-audit.md). The earlier MCP-based course-list attempts failed during sign-in; those failures did not establish an account permission limit.

The useful ceiling is the intersection of what the platform exposes, what the school enables, what this account may access, what instructors release, and what our chosen integration actually supports. A connector's missing feature is not proof that Brightspace lacks an API. A documented endpoint is not proof a student can call it.

## Capability map

This map records the initial research and advertised MCP capabilities; it is broader than the implemented direct audit. “Connector” in this table refers to the reference MCP tools. The separate [live findings](live-audit.md) record measured direct access. Availability and field coverage must still be measured per course.

| Area | Information worth collecting | Existing connector path | Important limits / next check |
| --- | --- | --- | --- |
| Enrollments | Course IDs, names, codes, access dates, active and historical courses | `get_my_courses(activeOnly: false)` | Inspect which metadata fields are actually returned; enrollment does not guarantee continued course access. |
| Course structure | Modules, nested topics, descriptions, links, ordering, availability, modification dates | `get_course_content` | Enumerate the full tree, then compare to onQ; locked or hidden material may have metadata only or may be omitted. |
| Course files | Lecture slides, readings, HTML pages, PDFs, Word/Excel/PowerPoint files, linked course files | `download_file` | Metadata, downloadable bytes, and useful extracted text are separate capabilities. Scans may need OCR; external links need separate access. Inline connector reads have size/text limits. |
| Syllabus | Overview text, attached syllabus, syllabus links | `get_syllabus` | A syllabus may instead be a content file or live in an external service. The connector can identify some external syllabus links without reading their contents. |
| Assignments | Instructions, dates, attachments, submission type/status, own submitted files | `get_assignments`, `get_assignment_files`, `download_file` | Due date differs from start/end date. Missing submission data must remain unknown, never interpreted as not submitted. Check group, text, file, and offline work separately when present. |
| Assignment feedback | Released score, feedback text, graded state, rubric assessment | `get_dropbox_feedback` without another user's identity | Test a released graded assignment. Feedback attachments/links have documented API routes but are not established as a separate download path by this connector. |
| Rubrics | Criteria, achievement levels, points, released criterion outcomes | `get_assignment_rubric` | Instructor visibility and release settings matter. Rubric document attachments and structured rubric data are different sources. |
| Quizzes | Discovered quizzes, dates, availability, attempts/status where allowed | `get_assignments` | Connector combines quiz list, content, and gradebook evidence. Some quiz IDs/details can be unavailable. Do not assume access to question banks, answer keys, or full attempts. |
| Grades | Own released grade items, points, percentages, comments | `get_my_grades` | Test weights/categories, exemptions, final grades and grading scheme separately. Do not calculate an authoritative course total from incomplete items or assume an unreleased grade is zero. |
| Announcements | Full bodies, links, timestamps, attachments | `get_announcements`, `get_announcement_files` | Follow every page. Check coverage metadata; failed courses and filtered pages are not empty courses. |
| Calendar | Instructor-created events, recurring occurrences, generated deadlines | `get_calendar_events(includeGenerated: true)` | Query an explicit term window. Compare actual occurrences and deduplicate generated events against their source activities. |
| Due dates | Assignment, quiz, discussion deadlines and calendar events | `get_upcoming_due_dates` | Derived view, not an independent source. Deadlines mentioned only in prose/PDFs need extraction and human verification. |
| Discussions | Forums, topics, visible posts | `get_discussions` | Traverse forum/topic IDs to fetch posts. Group restrictions, moderation and “post before viewing” rules can limit visibility. Attachment retrieval needs a separate check. |
| People | Instructor/TA names and contact details; visible classlist | `get_roster` | Start with default staff-only results. Classmate emails are not necessary for this product's first discovery pass. |
| Own groups | Group memberships and members | `get_my_groups` | Test a course that uses groups. Section metadata has additional documented APIs; connector coverage may differ. |
| Video | Linked video metadata and available captions/transcripts | `get_video_transcript` | Connector advertises Kaltura and YouTube support; external authentication and caption availability vary. Page until transcript truncation is false. Reading is not evidence of watching. |
| Search | Content metadata/descriptions, announcements, discussion forum/topic text | `search_course` | Connector search does not establish a full index of document contents, transcripts, or all discussion posts. Those need explicit reads before prompt answers can cite them. |
| Personal learning state | Bookmarks, recent content, completion/progress | No dedicated installed connector tool | Official content API documents these routes. Test read-only APIs later if these features matter; don't mark items complete or change progress during discovery. |
| Other optional resources | Checklists, surveys, awards, outcomes/competencies, lockers, ePortfolio, notification settings | No dedicated installed connector tools | Documented resource families, not guaranteed student-readable features. Inspect actual course usage before extending integration. |
| Institution-wide datasets | Data Hub / bulk export / administrative records | Not a student discovery path | Separate permissions and provisioning. Do not rely on institution-wide datasets for a personal student app. |
| External learning tools | Publisher homework, external syllabus tools, simulations, video hosts | Often only launch links or partial metadata | A Brightspace LTI link is not authorization or an API for the remote content. Use supported provider integrations or user-supplied exports where allowed. |

## Integration choices

1. **Build a direct connector for the access audit and eventual application.** Use the installed server's authentication and endpoint handling as references. Return structured data, source metadata, and explicit coverage directly to the application. MCP is not a runtime dependency. The MCP calls in the capability map and original test procedure identify reference behavior; run their equivalent direct requests as our connector becomes available.
2. **Evaluate registered OAuth for a durable app.** D2L documents registration through the Manage Extensibility admin tool, registered scopes, and an authorization grant for end-user applications. Student credentials alone do not establish permission to register a client. Confirm the Queen's registration/approval path before committing to this delivery model. User permissions still apply after OAuth authorization; verify required scopes route by route. Never embed a client secret in browser code.
3. **Use explicit fallbacks for measured gaps.** A user-provided PDF/export can fill a syllabus or reading gap; an external provider's supported integration can fill a publisher/video gap. An authenticated browser-based integration may be worth evaluating if OAuth is unavailable, but its session, deployment, policy and maintenance constraints need investigation. Do not copy stored school passwords into this repository or bypass release conditions.

The first implementation should prove direct authentication, session reuse and a read-only inventory. Defer the UI, model integration, hosted deployment and full background synchronization until that path works. The more detailed sequencing and acceptance conditions are in the direct connector design.

## Read-only test procedure

1. Finish signing in using the existing connector. Call `get_my_courses(activeOnly: false)`. Record course count, returned field names, and errors; separate current, historical and inaccessible courses.
2. Start with one course containing representative material. Read its full content tree, assignments/quizzes, grades, announcements (all pages), calendar (explicit term window), syllabus, discussion structure, staff roster, and own groups. Preserve unavailable/unknown states and source links. Do not bulk download a semester of private data.
3. Follow discovered IDs to inspect one representative file, instructor attachment, graded assignment feedback, rubric, visible discussion thread, and captioned video where present. Use inline file reads during this audit. Inspect a released quiz's metadata/status without starting an attempt. If a resource is absent, choose another course before concluding the capability cannot be tested.
4. Compare against onQ in the browser for the same account and time: count visible items, inspect dates, confirm a known submission/grade, verify attachment text, and check whether external-tool material is only a link. Note access windows and any observation that might mark content read/viewed.
5. Expand the basic inventory across all accessible courses to expose instructor-specific differences. Record a capability per course and per tested object; one successful course cannot prove account-wide completeness.
6. For a needed feature unsupported by the connector, test the official GET route using a legitimately provisioned integration. A 401 suggests authentication trouble; a 403 indicates a denied request whose cause needs investigation; a 404 may mean a missing/hidden resource, incorrect route or version. A 429 is a retry/rate-limit condition. None of these should be silently converted into an empty collection.
7. Stop discovery when core data categories have evidence, coverage checks, representative object reads, and an explicit workaround or accepted limitation for each gap. Only then choose the first UI and prompt workflows.

Use these outcomes in an access ledger: `available`, `partial`, `denied`, `not_present`, `unsupported_by_connector`, `failed`, `untested`. Record `not_present` only when a successful, adequately covered lookup supports it. Track a request failure separately from the resource's capabilities.

For each observation, record: timestamp, school, account role (no credentials), connector version or API route/version, local course alias, resource category/object alias, outcome, returned field names, count, pagination/coverage/truncation, availability restrictions, whether bytes/text were read, comparison with onQ, and next action. Keep identifiers and private payloads out of committed evidence. Use stable source IDs privately when later implementing synchronization.

## Official GET route starting points

These route templates were checked against D2L's current reference, not exercised as authenticated requests. Substitute a version supported by both the tenant and that specific route; the newest advertised version is not automatically the best version for every endpoint. Additional scopes, parameters and pagination requirements are in each route's documentation.

| Resource | Route template |
| --- | --- |
| Public version discovery | `/d2l/api/versions/` |
| Own enrollments | `/d2l/api/lp/{version}/enrollments/myenrollments/` |
| Content tree | `/d2l/api/le/{version}/{orgUnitId}/content/toc` |
| Topic file | `/d2l/api/le/{version}/{orgUnitId}/content/topics/{topicId}/file` |
| Overview | `/d2l/api/le/{version}/{orgUnitId}/overview` |
| Assignment folders | `/d2l/api/le/{version}/{orgUnitId}/dropbox/folders/` |
| Own submissions | `/d2l/api/le/{version}/{orgUnitId}/dropbox/folders/{folderId}/submissions/mysubmissions/` |
| Feedback | `/d2l/api/le/{version}/{orgUnitId}/dropbox/folders/{folderId}/feedback/{entityType}/{entityId}` |
| Own grades | `/d2l/api/le/{version}/{orgUnitId}/grades/values/myGradeValues/` |
| Quizzes | `/d2l/api/le/{version}/{orgUnitId}/quizzes/` |
| Announcements | `/d2l/api/le/{version}/{orgUnitId}/news/` |
| Discussion forums | `/d2l/api/le/{version}/{orgUnitId}/discussions/forums/` |
| Calendar occurrences | `/d2l/api/le/{version}/{orgUnitId}/calendar/events/occurrences/` |
| Groups | `/d2l/api/lp/{version}/{orgUnitId}/groups/` |
| Own sections | `/d2l/api/lp/{version}/{orgUnitId}/sections/mysections/` |
| Bookmarks | `/d2l/api/le/{version}/{orgUnitId}/content/bookmarks` |

## Initial research evidence (October 28)

| Check | Result | Meaning |
| --- | --- | --- |
| Repository inspection | Empty Git repository | No existing application, callers, fixtures, exports or tests to preserve. |
| Connector metadata | Brightspace MCP `5.1.27`, configured for Queen's onQ | A reusable discovery integration is installed. No credentials or session files were read. |
| `get_my_courses(activeOnly: false)`, two attempts | Connector reports automatic sign-in could not reach Brightspace; saved session retained | Authenticated enrollment access is unverified; no course-level tests could run. |
| Direct HTTPS `GET https://onq.queensu.ca/d2l/api/versions/` | HTTP 200; advertised `le` latest `1.100`, `lp` latest `1.64` | Shell can reach the public API. This says nothing about student permissions or OAuth registration. |
| D2L documentation | Reference, OAuth, core calls, content, enrollment, assignment, grade, quiz, discussion, news, calendar, group and export pages retrieved | Capability research is based on current official documentation. |

Interactive MCP sign-in subsequently failed to complete. The server recommended `npx -y brightspace-mcp-server@latest auth` from the home directory. That diagnostic launched version `5.1.27` and announced browser-based authentication, but produced no further result while observed; it was cancelled. Do not infer a bad password or a permission denial from that startup failure. On October 29, the application-owned connector successfully established its own session and ran the direct audit described in the live findings.

Validation: all 15 authenticated GET route templates in this report were compared programmatically with the current official route signatures and matched. The README's local report target exists. This validates the research artifact, not account access.

## Requirements this discovery imposes on the later app

- Every answer needs a source link and retrieval time; extracted/inferred deadlines must be distinguishable from structured dates.
- Unknown, unavailable, stale, partial and verified-empty are different states. A partial sync cannot erase previously retrieved items or turn an unknown submission into missing work.
- Use source IDs for identity; deduplicate deadlines by linked activity IDs where available. Preserve timezone offsets and distinguish due, start and end dates.
- Grade calculations must respect released data, categories/weights, exemptions, and missing grades. Expose uncertainty when the grading rules are incomplete.
- Store only the personal material needed for the chosen features. Recheck access on sync; purge cached content if access is confirmed revoked or the user requests deletion. Keep credential handling outside the model and source control.
- Treat course text and documents as untrusted source material for prompts. They cannot authorize account actions or override the user's instructions. Sending course data to a model provider is a separate product decision before implementation.

## Sources

Official D2L documentation, retrieved October 28, 2026:

- [API reference and complete resource catalog](https://docs.valence.desire2learn.com/reference.html)
- [OAuth 2, registration and grant types](https://docs.valence.desire2learn.com/basic/oauth2.html)
- [Core API calls](https://docs.valence.desire2learn.com/basic/apicall.html)
- [Enrollments and classlists](https://docs.valence.desire2learn.com/res/enroll.html)
- [Content, files, completion, bookmarks and captions](https://docs.valence.desire2learn.com/res/content.html)
- [Assignments, submissions and feedback](https://docs.valence.desire2learn.com/res/dropbox.html)
- [Grades](https://docs.valence.desire2learn.com/res/grade.html)
- [Quizzes](https://docs.valence.desire2learn.com/res/quiz.html)
- [Discussions](https://docs.valence.desire2learn.com/res/discuss.html)
- [Announcements](https://docs.valence.desire2learn.com/res/news.html)
- [Calendar](https://docs.valence.desire2learn.com/res/calendar.html)
- [Groups and sections](https://docs.valence.desire2learn.com/res/groups.html)
- [Data Hub and exports](https://docs.valence.desire2learn.com/res/dataExport.html)

Connector capabilities were read from the installed tools' descriptions. These do not independently prove the implementation or live account coverage.
