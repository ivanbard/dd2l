# daisyUI / Mantine workspace comparison

A local experiment on `feat/design-system-comparison`. It compares actual daisyUI
and Mantine renderers of the same assignment planner and study session. Dependencies
and build output for this lab stay outside dd2l's published package. The main app
now adopts Mantine with a shared component contract, autosaved drafts and a separate
production renderer. This lab retains both alternatives for comparison.

With the repository dependencies installed (`npm ci`), run from the repository root:

```powershell
npm run compare:install
npm run compare
```

Open **http://127.0.0.1:4174**. Stop with Ctrl+C. To use another port:

```powershell
npm --prefix experiments/design-systems run build
node experiments/design-systems/server.mjs --port 4175
```

## What to compare

Both renderers use the same source records from `demoInventory()` and
`taskCatalogue()`. They share a validated JSON plan and host-owned state. An action
in either pane updates both, so differences in content or progress do not influence
the comparison. Data is fictional; no school inventory, credentials, or model
service is accessed. Progress is memory-only and clears on reload.

1. In **Assignment planner**, check requirements in both panes. Inspect a source,
   edit draft notes, select a work date and inspect the rubric.
2. Use **Move notes first**. Notes, dates, completed requirements and the active
   section should survive. Moving sections is a deterministic example adaptation.
3. In **Study session**, answer a practice question and check the explanation.
   Changing the answer hides its old feedback. Reset progress and try again.
4. Compare keyboard tab navigation and the date controls. Use the 390px and 280px
   canvas widths, then each renderer's single-pane view. On small screens the two
   panes stack; a deliberately wider canvas scrolls within its pane.
5. Expand **Record the comparison**, write observations, then export JSON. The
   export includes the plan, sources, progress, exact library versions, bundle
   measurements and observed first paint times.

## Compare generated compositions

Expand **Try a generated or adapted plan**. Edit the workspace goal, then copy the
generation prompt into the model being evaluated. Paste its JSON response into the
plan editor and apply it to both renderers. The prompt contains the fictional
evidence, current plan, supported section types and full JSON schema. It makes no
model call automatically and requires no additional account connection.

Use the **same model, goal and evidence** for repeatable trials. Record the model
name, prompt, raw response, latency, token usage if available, and any corrections
in the observations. Invalid plans leave the previous workspace and progress intact.
Unchanged controls preserve values by ID; changed checklist items and questions
reset their own progress. Removed controls are discarded. Task selection resets
progress; a plan edit does not.

This measures composition through one common contract. It does **not** measure
which library produces better model-written HTML/JSX. The initial contract includes
checklists, schedules, rubrics, notes, practice and source-backed explanations. New component types need both
renderers, validation and behavioral checks before entering this comparison.

## Implementation tradeoffs

| Area | daisyUI | Mantine |
| --- | --- | --- |
| Rendering | Native DOM and component CSS; no React | React and actual Mantine components |
| Tabs | Explicit ARIA roles and arrow/Home/End behavior implemented here | Mantine Tabs supplies keyboard behavior |
| Work date | Browser-native date input | Mantine DatePickerInput with a calendar popover |
| Practice | Native radio groups and custom feedback rendering | Radio.Group, Button and Alert components |
| State and source validation | Shared host reducer and plan schema | Same host reducer and plan schema |
| Production adoption | Supply library CSS and compatible markup examples to the existing HTML canvas | Add a trusted React renderer and an explicit plan/action bridge; generated JS must stay in the existing worker |

The host is plain JavaScript. `daisy.mjs` uses no React; `mantine.jsx` bundles its
own React runtime. Each runs in an opaque-origin `sandbox="allow-scripts"` iframe.
Only bundled trusted code executes. Imported plans are data rendered as text;
they cannot provide HTML, scripts, styles or URLs. Frame CSP blocks networking,
and MessageChannels carry supported actions to the validating host reducer.

## Measurements and checks

```powershell
npm run compare:check
npm run package:check
```

`compare:check` runs contract/state/server tests, builds minified production assets,
then uses the repository's Playwright/installed Google Chrome to exercise both
renderers. It covers shared progress in both directions, notes, keyboard tabs,
date changes, source inspection, adaptation, rejected plans, practice feedback,
reset, mobile overflow, opaque frames, blocked network capabilities and export.
Screenshots go to `.dd2l/compare-desktop.png`, `.dd2l/compare-mobile-daisy.png`
and `.dd2l/compare-mobile-mantine.png`.

Build measurements are written to `dist/manifest.json` and displayed per pane.
They include all bundled JS and the **complete library CSS** for each renderer.
Each frame has its own runtime; there is no CDN, runtime Tailwind compiler, shared
cache or CSS purging. The host is excluded from each renderer's size because it is
the same for both. First paint includes document loading and initial rendering in
this local session, and is acknowledged after two animation frames. It is not a
controlled performance benchmark. The server sends uncompressed HTML; gzip sizes
are calculated transfer-size estimates, not actual local transfer sizes.

On the initial production build, daisyUI is approximately **102 KiB gzip / 1,121
KiB raw** and Mantine **189 KiB gzip / 764 KiB raw**. This compares these task
renderers and complete stylesheets, not every possible component or an optimized
production integration. Check the current manifest after changes.

Manual screen-reader review and repeated live-model trials are still required
before a wider release. A passing shared-plan test proves renderer behavior,
not model quality or factual correctness.

## Dependencies and notices

The separate package lock pins the experiment. `npm run compare:install` uses
`npm ci`; normal dd2l installation does not install these dependencies. No Pro
components or paid templates are used. The build retains bundled dependency
licenses in `dist/THIRD_PARTY_NOTICES.txt`, available from the local server.

`react-remove-scroll-bar@2.3.8` omits its license file from its npm package.
`licenses/react-remove-scroll-bar.txt` preserves its upstream MIT notice from
https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE.
