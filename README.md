# Yiji Study

[Simplified Chinese documentation](./README.zh-CN.md)

## English

Yiji Study is an offline-first, mobile-friendly quiz plugin for Obsidian. It
currently bundles 1,085 questions for the Level 4 electricity trader exam and
supports focused practice, instant grading, mistake review, bookmarks, saved
progress, and learning statistics.

The plugin interface and bundled questions are in Chinese. Questions and study
records stay in the user's local Obsidian vault, and the plugin does not make
network requests.

## Installation

After the community-directory review is approved, open **Settings > Community
plugins > Browse**, search for **Yiji Study**, and select **Install**.

During review, Yiji Study can be installed with BRAT:

1. Enable community plugins in Obsidian, then install and enable
   [BRAT](https://obsidian.md/plugins?id=obsidian42-brat).
2. Open the [Yiji Study installation page](https://ziz-lg.github.io/yiji-study/)
   and use the install button.
3. Enable **Yiji Study** from **Settings > Community plugins**.

If the deep link does not open Obsidian, use **Add a beta plugin** in BRAT and
enter `ZiZ-LG/yiji-study`.

## Current features

- 1,085 bundled questions: 503 single-choice, 277 multiple-choice, and 305
  true-or-false questions.
- Practice by 22 knowledge domains or by question type.
- Instant grading with the original answer and source reference.
- Automatic progress bookmarks that restore the previous position.
- Automatic mistake notebook: a question is added after a wrong answer and
  removed after a later fully correct answer.
- Statistics for answered questions, total attempts, accuracy, bookmarks, and
  recent activity.
- Three primary sections: Question bank, Mock exams, and Statistics. The
  mistake notebook is available under Statistics.

The mock-exam page currently presents two reference papers and five fixed mock
paper entries, but starting an exam is not enabled yet. The reference papers
still need question-by-question mapping, and the mock papers still need final
duplicate, answer-integrity, and composition checks. The plugin does not use a
temporary random paper as a substitute.

## Usage

Open Yiji Study from the book icon in the Obsidian ribbon or run **Open quiz
trainer** from the command palette.

## Development

Node.js 20.19 or later is required.

```bash
npm install
npm run verify
npm run install:local
```

When the local Markdown question sources are available, development builds can
parse them from `Study_Vault`. Published builds use the bundled question pack.
After source changes, run `npm run content:generate` to validate and regenerate
the package.

Useful commands:

```bash
npm run dev
npm test
npm run check
npm run lint:obsidian
npm run build
npm run check:ui
npm run check:mobile-layout
npm run verify
npm run verify:release -- 0.1.6
```

Pushing a Git tag that exactly matches `manifest.json` triggers the release
workflow and publishes `main.js`, `manifest.json`, `styles.css`, and
`SHA256SUMS.txt`.

## Data and repository boundaries

- The plugin has no account system, cloud database, telemetry, or runtime
  network requests.
- Study progress is saved through Obsidian's plugin data API in the user's own
  vault.
- The public repository includes the plugin source and the structured question
  package approved for publication.
- Original `Study_Vault` files, reference exam PDFs, local `.obsidian`
  configuration, and internal product documents are not published.

## Licensing

Yiji Study uses two licenses with separate scopes. See
[LICENSES.md](./LICENSES.md) for the complete boundary:

- Plugin source code: [MIT License](./LICENSE).
- Bundled structured question-bank content:
  [CC BY-NC-ND 4.0](./LICENSE-CONTENT.md).
- Third-party source materials remain the property of their respective
  rightsholders.
