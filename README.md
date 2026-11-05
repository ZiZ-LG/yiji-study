# Yiji Study

> Version **0.2.0** adds custom question banks, source-reviewed imports, and spaced review. See the [release notes](./docs/releases/0.2.0.md).

[Simplified Chinese documentation](./README.zh-CN.md)

## English

Yiji Study is an offline-first quiz plugin for Obsidian. It
lets you create your own question banks, import exam papers, review AI-assisted
extraction, assemble practice papers, and revisit questions after a time interval.
It supports single-choice, multiple-choice, and true-or-false questions. The
interface and the optional bundled electricity-trader content are in Chinese.

Question content and study records are stored in your vault. Manual authoring,
standard-format import, practice, grading, and review scheduling work locally.
Optional AI requests send the selected material to your configured service;
Codex file tasks provide a separate export-and-import workflow.

## Installation of the public stable release

Open **Settings > Community plugins > Browse**, search for **Yiji Study**, and
select **Install**. Existing users can check for updates in Community plugins.

Yiji Study can also be installed with BRAT:

1. Enable community plugins in Obsidian, then install and enable
   [BRAT](https://obsidian.md/plugins?id=obsidian42-brat).
2. Open the [Yiji Study installation page](https://ziz-lg.github.io/yiji-study/)
   and use the install button.
3. Enable **Yiji Study** from **Settings > Community plugins**.

If the deep link does not open Obsidian, use **Add a beta plugin** in BRAT and
enter `ZiZ-LG/yiji-study`.

Before upgrading, retain a vault backup. Manual updates replace the plugin files;
keep your existing data.json and question-bank folder.

## From your files to practice

1. Open Yiji from the ribbon's book icon, then open its question-bank manager.
   The command palette also provides the management command
   `yiji-study:manage-question-banks`. A new installation starts with an empty
   personal bank; the electricity-trader bank can be added explicitly.
2. Create or select a bank. Add a question manually, paste structured content, or
   select local files. Give a question paper and its separate answer file the
   same paper title and choose their respective roles.
3. Inspect the local extraction. For AI assistance, explicitly select pages or
   source units and confirm the processing scope. Only this selected material
   is included in the request or exported task.
4. Review the drafts against the source. Ordinary drafts can be accepted in a
   batch after checking them. Missing answers, conflicting answers, missing
   images, unsupported types, and other flagged items require individual review.
   Acceptance records your chosen answer; it does not certify an official answer.
5. Return to the question bank and practice by topic or type, or use mistakes,
   bookmarks, and unanswered questions. Choices, submitted results, and study
   progress are saved locally.
6. Assemble a paper or enable consolidation review when you want to revisit
   previously studied questions. You can leave and resume practice later.

### Sources and AI processing

| Input | Preview behavior |
| --- | --- |
| Text PDF | Local text extraction and page preview; select up to 50 pages per batch. Import later ranges from the same file to accumulate the remaining pages. |
| DOCX | Local reading of text, common tables, and supported inline images; check formatting and image warnings. |
| Scanned PDF, PNG, JPEG | Source previews are retained. Recognition requires a compatible image-capable service or a Codex task that includes the selected images. |
| TXT, Markdown, CSV, question JSON | Local parsing for supported structures, with optional AI assistance for irregular text. |

The current file-size limit is 50 MB per file. An AI batch is limited to 50 pages
or source units. Legacy `.doc`, `.xlsx`, archives, and unsupported question types
are not automatically converted into usable questions. Complex formulas,
multi-column layouts, page-spanning questions, and missing diagrams need review.
A received file or a successful text extraction does not establish a complete
paper. Full-page previews may contain answers and are not automatically used as
question illustrations.

In the manager's settings, choose one of these routes:

- **Your own AI service (BYOK):** configure a compatible chat-completions endpoint,
  model, and key. Declare image support when required. The provider bills your
  account. Review the selected scope before starting; an uncertain remote result
  is not automatically sent again. Compatibility with every provider or model
  has not been established.
- **Codex file task:** select the material and export the task. Give Codex the
  exported task file and its accompanying assets, then import the returned JSON
  into the same bank. Keep the task identifier unchanged. Results still enter
  the review queue; changed source files require a new task rather than reuse of
  an outdated result. The plugin does not create a Codex chat or call an AI service
  during file export/import; your own Codex access and terms apply.

Natural-language composition follows the selected route too. In Codex mode,
export the composition task, paste its returned conditions JSON into the same
input, and inspect the filled form before previewing the paper.

### Editing, papers, and consolidation

The manager supports bank renaming, question editing and disabling, source and
revision inspection, and bulk topic renaming. Generated question notes can also
be edited in Obsidian: retain their identity block and use the external-note
check to review changes before adoption. New practice uses the accepted revision;
existing paper and attempt snapshots retain their recorded versions.

An original paper can be frozen only after its whole imported batch is accepted
and you confirm the source's completeness and question count. Preserve original
order and available item scores. If timing or scores are absent, label your
settings as practice rules. A printed total that differs from the item sum is
shown separately without silent rescaling.

Custom composition uses the current bank's usable questions and visible filters
for topic, type, source, mistakes, unanswered questions, or bookmarks. Shortages
are reported instead of silently relaxing conditions or inventing questions.
Preview first, then save a frozen paper. Multiple-choice scoring supports:

- Full credit only when the selected set is exactly correct.
- Proportional credit for correctly selected options when no wrong option is
  selected; a wrong selection or no answer earns zero.

A partially correct multiple-choice answer still enters the mistake notebook.
Exams update study statistics on submission; unanswered questions score zero and
are listed separately. Submitted attempts can be reviewed independently.

Consolidation is optional per bank. It uses intervals of 1, 3, 7, 14, and 30 days;
an early correct repeat does not advance the schedule. Mistakes or a guessed
answer return to a short interval. Existing history is enrolled only when you
select it. Choose the number of due questions for each session, pause the
feature, or explicitly reset selected studied questions to 24 hours later.
Resetting a schedule does not create an answer event. There are no streaks,
mandatory daily tasks, or claims of a guaranteed exam result.

## Existing electricity-trader content and migration

The compatibility bank retains 1,433 questions: 704 single-choice, 351
multiple-choice, and 378 true-or-false questions, organized into 22 knowledge
domains plus an unclassified group. Practice, immediate feedback, mistakes,
bookmarks, saved position, statistics, and the three primary sections
(Question bank, Mock exams, Statistics) remain available.

The four original papers from June 26 A/B, June 30, and July 18, 2026 each retain
170 positions. The July paper has 100 single-choice, 20 multiple-choice, and 50
true-or-false questions; its item scores sum to 95 despite a 100-point header.
The inherited 120-minute limit is a practice setting, not an inferred official
limit. The older two sample papers and five mock entries remain unavailable
pending mapping.

When version 1 study data is found, the plugin backs it up before migration and
retains the available question identities, progress, mistakes, bookmarks,
activity totals, and saved exam snapshots. Older data contains at most 500
activity entries and the last retained attempt per paper; overwritten history
cannot be recovered. Invalid or conflicting data needs review rather than being
replaced with an empty bank. This code path is not a claim that every existing
user vault or device has passed migration acceptance.

## Data, backup, and synchronization

The default library folder is at the vault root and has a Chinese name; exact
paths are listed in the [Chinese data-location guide](./README.zh-CN.md#data-locations).
It holds question notes, selected source files, review drafts, AI task files,
per-device study records, and backups. Plugin preferences remain in Obsidian's
plugin data. The plugin does not operate an account system, cloud database, or
telemetry service.

Complete backups include learning history, revisions, paper snapshots, required
images, source files, and unfinished import/task state. Content export can omit
learning history. Both archive types use the restore entry, not raw question-JSON
import. Restore first checks the archive and displays its scope, then
merges it with current data; conflicting files or records are not silently
replaced. Workspace archives require the same library root. Keys are omitted
from exports and backups. On a compatible Obsidian host the key uses secret
storage; otherwise it is held for the current session only.

Deleting a bank requires its exact name and a scope confirmation. The plugin
first saves and reads back a complete backup, then records a deletion marker to
remove the bank from active use. Source originals, retained data, backups, and
copies already present on other devices are not automatically erased. Restoring
a deleted bank creates a new bank copy.

Your vault's synchronization service may transfer these files. On November 5,
2026, the release owner reported successful manual iOS and iCloud acceptance.
Android core workflows were tested in an Android 16 emulator with Obsidian 1.15.0.
These results do not establish compatibility with every device or sync service.
Keep source files and required attachments available before working on another
device.

The public repository includes plugin code and the structured content approved
for publication. Original `Study_Vault` material, reference exam PDFs, local
`.obsidian` settings, internal product documents, and users' imported banks or
AI task files are outside that publication scope.

## Development

Node.js 20.19 or later is required.

```bash
npm install
npm run verify
npm run install:local
```

The local installer copies the build into this repository's `.obsidian/plugins`
folder; it does not enable the plugin or constitute a public release. Some
browser checks launch installed Chrome with isolated test fixtures and temporary
profiles. Device and real synchronization acceptance remain separate.

Legacy content generation can parse the local `Study_Vault` sources and merge
bundled additions. `npm run content:generate` also requires the recent Markdown
sources, four original PDFs, and Poppler's `pdftotext`. Ordinary builds and tests
use the generated package. Runtime custom imports use the plugin's import path,
not this legacy content-generation command.

```bash
npm run dev
npm test
npm run check
npm run lint:obsidian
npm run build
npm run check:ui
npm run check:mobile-layout
npm run check:exam-ui
npm run verify
npm run verify:release -- 0.2.0
```

The release-check example matches the 0.2.0 metadata.
Pushing a Git tag that exactly matches `manifest.json` triggers the release
workflow and publishes `main.js`, `manifest.json`, `styles.css`, and
`SHA256SUMS.txt`. Passing a local check does not publish a release.

## Licensing

Yiji Study uses two licenses with separate scopes. See
[LICENSES.md](./LICENSES.md):

- Plugin source code: [MIT License](./LICENSE).
- Bundled electricity-trader structured content:
  [CC BY-NC-ND 4.0](./LICENSE-CONTENT.md).
- User-imported materials are not automatically relicensed under either license.
  Third-party sources retain their applicable rights and terms. Import, AI
  processing, and export do not grant permission to redistribute those materials.
