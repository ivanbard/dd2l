# Direct connector: live findings

Observed October 29, 2026, with the user's own Queen's onQ account. This report contains counts and capability observations, not course names, IDs, grades, documents or credentials. Counts can change as instructors update courses.

## Confirmed

- Direct browser sign-in succeeded through installed Edge; the connector verified the account via Brightspace's `users/whoami` endpoint.
- Session credentials were saved under the current Windows user's DPAPI protection. Separate subsequent commands reused that session successfully.
- A forced live API-token renewal succeeded without interactive login; identity was checked again after reloading the saved session.
- Version discovery returned LP `1.64` and LE `1.100`.
- The unfiltered enrolled-course-offering collection returned **45 enrollments**, with complete endpoint pagination coverage.

One selected coursework-heavy course returned:

| Resource | Observed result |
| --- | --- |
| Content | Full returned module/topic tree, including descriptions, availability, activity references and modification fields. |
| Assignment folders | 41, including instructions, dates, grade item references and embedded assessment/rubric fields where present. |
| Own grade values | 31, including points, weighted values, release/modified timestamps and comment fields where present. No authoritative course-total calculation was attempted. |
| Announcements | 9, with returned bodies and metadata. |
| Calendar | 36 returned events in the explicit audit window, via `calendar/events/myEvents/`; recurrence metadata is retained. |
| Discussion structure | 1 forum and 1 topic; the sampled topic's visible post list was empty. |
| Own groups | 1 membership entry. |
| Own sections | 2 entries. |
| Own submissions | 1 returned entity submission record for a representative assignment, including submitted-file metadata and a feedback field. A field's existence does not prove a released feedback value. |
| File bytes | One representative available content file was read and retained privately with its size, MIME type and SHA-256. This is separate from full document text extraction. |
| Quiz list | Successful empty response for this course. This does not establish that no quizzes are linked through content, gradebook or an external tool. |

## Measured gaps

- The selected course's overview endpoint returned 404. The syllabus may still be in content or an external tool; the audit does not infer that no syllabus exists.
- The separate user-feedback endpoint returned 403 for the sampled assignment. Own submissions were readable through their own route. Group feedback and other assignments require separate object-specific checks.
- A representative rubric lookup returned an empty list. Other assignment folders and embedded rubric data were not exhaustively inspected.
- The newer calendar-occurrences route returned 404 during initial probing; the documented current-user events route succeeded and is used by this implementation. Full recurrence expansion remains unverified.

No external LTI content, video transcripts, PDF/Office extraction, OCR, all-course content crawl, or bulk attachment download was attempted. The audit samples a discussion topic and representative files; it does not claim complete discussion/file extraction.

## Implementation checks

The focused automated suite covers authenticated request boundaries, pagination loops and interruptions, single-flight token renewal, Windows DPAPI protection/reload, failed-refresh data preservation, confirmed access invalidation, account isolation, credential redaction, the complete simulated audit, polling backoff and worker locking. See `npm test` for current results.

An authenticated Edge browser comparison also passed: the course page title matched the API course name, and 11 top-level module titles from the retrieved tree were visible across the page's frames. The first comparison looked only in the main frame and timed out; the content lives in an embedded frame. No connector access failure was implicated.

These checks establish the initial access path and a representative browser comparison. They do not establish long-term unattended reliability or access to every course/object.

The foreground polling worker also completed a live cycle using the pinned selected course, wrote its structural report and SQLite observations, and released its process lock after Ctrl+C. The worker was stopped after this check; no background polling process was left running. Multi-hour operation and repeated natural session expiry have not been tested.
