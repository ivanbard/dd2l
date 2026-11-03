# dd2l

i am not the biggest fan of D2L Brightspace, and sometimes wish i could get what im looking for without digging through 14 menus that differ from course to course. to solve that i made dd2l, a dynamic companion app to D2L Brightspace that does what you need, and adapts to your needs with time.

dd2l is a local student companion for Queen's onQ. Sync your courses, search
your materials, and ask questions with sources.

## How it works

- sign in to onQ through Chrome, including your school's MFA
- collect course materials, assignments, grades, announcements and syllabus text
- search the local cache, browse sources, and customize your home screen widgets
- optionally connect ChatGPT for answers grounded in matching course excerpts

The connector is read-only. It does not submit work or change grades, posts,
quiz attempts or completion states. Coverage depends on what onQ makes accessible.

## School not listed?
Choose **My school isn't listed** during setup and paste your school's
Brightspace address; `https://` is added if omitted. dd2l uses that site for sign-in, syncing, and source links, and
remembers it for later launches. Other schools have not been verified; their
authentication or API access may differ. You can also [report a missing school](https://github.com/ivanbard/dd2l/issues/new?template=missing-url.yml)
using the guided issue form. Include your school's name and Brightspace URL if
known to help add official support.
Stop dd2l and run `dd2l logout` before switching schools; this deletes its saved
school session and coursework cache.

## Run

Requires Windows, Node.js 24 or newer, and Google Chrome. This repository includes
an npm CLI; the commands below work once the package is published to npm:

```powershell
npx @ivanbard/dd2l setup
```

Setup explains local storage, asks before connecting onQ, opens Chrome for school
sign-in and MFA, then opens the app and starts collecting coursework. Keep that
one terminal open; Ctrl+C stops both the app and sync. The initial view may be
empty while collection runs. Collection advances through up to five courses per
pass every 15 minutes, so the first pass is not a complete download.

Next time, run `npx @ivanbard/dd2l start`. If the school session expires, stop the app and
run `npx @ivanbard/dd2l setup` again. Optional ChatGPT sign-in is in Settings.

Alternatively, install globally with `npm install -g @ivanbard/dd2l`, then use `dd2l setup`
and `dd2l start`. Installation itself does not open browsers or connect accounts;
setup runs explicitly in an interactive terminal.

To run the current source checkout before publication:

```powershell
npm ci
npm run setup
```

On later launches use `npm start -- start`. The individual `login`, `audit`,
`sync`, and `npm run ui` commands remain available for manual operation.

Or try fictional data without a school login:

```powershell
npm run ui -- --demo
```

## Your data

School sessions stay on your computer, encrypted with Windows DPAPI. The course
cache lives in `%LOCALAPPDATA%\dd2l` and is **not encrypted**. Local search does
not send your question to an AI provider.

For AI answers, connect ChatGPT in Settings and choose a model below the prompt.
Submitting sends your question and matching course excerpts to OpenAI and uses
your plan's limits. Check generated answers against the supplied sources.

Stop the app, then run `dd2l logout` (or `npm start -- logout` from source) to
remove the saved school session and inventory. Disconnect
ChatGPT separately in Settings; clear the site's browser data to remove saved
widget preferences and shortcut titles.

More docs are in [`docs/`](docs/README.md), including commands, ChatGPT setup,
collection limits and cache behavior.

Run `npm test` for tests and `npm run ui:check` for browser checks.
Third-party attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Original dd2l code is [MIT licensed](LICENSE); third-party assets retain their
own licenses. Maintainers: see [PUBLISHING.md](https://github.com/ivanbard/dd2l/blob/main/PUBLISHING.md)
for release setup.
