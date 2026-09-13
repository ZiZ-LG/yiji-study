# Yiji Study

[Simplified Chinese documentation](./README.zh-CN.md)

## English

Yiji Study is an offline-first, mobile-friendly quiz plugin for Obsidian. It
currently bundles 1,433 questions for the Level 4 electricity trader exam and
supports focused practice, instant grading, mistake review, bookmarks, saved
progress, and learning statistics.

The plugin interface and bundled questions are in Chinese. Questions and study
records stay in the user's local Obsidian vault, and the plugin does not make
network requests.

## Installation

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

## Current features

- 1,433 bundled questions: 704 single-choice, 351 multiple-choice, and 378
  true-or-false questions.
- Practice by 22 knowledge domains plus an unclassified group, or by question type.
- Instant grading with the original answer and source reference.
- Automatic progress bookmarks that restore the previous position.
- Automatic mistake notebook: a question is added after a wrong answer and
  removed after a later fully correct answer.
- Statistics for answered questions, total attempts, accuracy, bookmarks, and
  recent activity.
- Three primary sections: Question bank, Mock exams, and Statistics. The
  mistake notebook is available under Statistics.

Four recent original papers (June 26 A/B, June 30, July 18, 2026) are playable,
with all 170 original question positions per paper, saved answers, answer sheets,
submission, scores and review. Only submitted answers update mistake statistics.
The July paper contains 100 single-choice, 20 multiple-choice and 50 true-or-false
questions. Its printed item scores sum to 95 despite a 100-point header; scores
use the item-level values without rescaling. The fixed 120-minute practice limit
is inherited from Yiji, not inferred from candidates' elapsed exam times.
The older two sample papers and five mock entries remain disabled pending mapping.

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
parse them from `Study_Vault` and merge the bundled additions. Other vaults use
the full bundled question pack.
After source changes, run `npm run content:generate` to validate and regenerate
the package. Regeneration also requires the local recent Markdown sources, the
four original PDFs and Poppler's `pdftotext`; builds and tests use generated data.

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
npm run check:exam-ui
npm run verify:release -- 0.1.7
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
