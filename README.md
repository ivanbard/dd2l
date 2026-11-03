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
If your school/educational faculty uses D2L Brightspace and is not available during setup, please open an issue in the GitHub repo with some details as to your 
provider's Brightspace link and faculty name. Feel free to also create a PR if you have added your own solution to your school not being listed.

## Run

Requires Windows, Node.js 24 or newer, and Google Chrome. From this directory:

```powershell
npm ci
npm run login
npm run audit -- --all
npm run ui
```

Open the local URL printed in the terminal. To keep collecting course data,
run `npm run sync -- --all` in a separate terminal. Leave it running; if your
school session expires, sign in again and restart sync.

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

`npm start -- logout` removes the saved school session and inventory. Disconnect
ChatGPT separately in Settings; clear the site's browser data to remove saved
widget preferences and shortcut titles.

More docs are in [`docs/`](docs/README.md), including commands, ChatGPT setup,
collection limits and cache behavior.

Run `npm test` for tests and `npm run ui:check` for browser checks.
Third-party attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
