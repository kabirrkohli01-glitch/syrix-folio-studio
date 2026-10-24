# SYRIX Folio

A desktop writing studio for Windows: a rich-text editor with version history, a revision pipeline that rewrites in the writer's own voice while checking that the meaning survives, writing-style profiles, an AI writing assistant, and a research lab that measures how AI-text detectors actually behave.

![The editor](docs/editor.jpg)

## What it does

- **Editor.** Rich text with headings, lists, tables and links, find and replace, undo history, autosave and version snapshots. Imports DOCX, PDF, HTML, Markdown, text and images (with OCR); exports DOCX, PDF, Markdown and text.
- **Revision pipeline.** Rewrites a passage section by section to a writing profile, then checks every rewrite deterministically against the original — numbers, names, dates and quotations are protected details that may not be lost, altered or invented — before a separate model audits the meaning. Feedback such as "more concise" becomes a numeric target that is measured on the result, and a round that misses its target is retried with the measured figures.
- **Writing profiles.** A measured feature vector of the writer's style, built from their own samples, so "how close is this to my voice" is a measurement rather than a model's opinion.
- **Assistant.** SYRIX answers questions about the open document and helps plan and improve it (Ctrl+J).
- **Detector lab.** Summarises published research on AI-text detection — including its documented bias against non-native English writers — and runs a reproducible evaluation on this machine with open detectors (perplexity, GLTR-style rank and Binoculars-style cross-perplexity on GPT-2), reporting AUROC and false-positive rates.

![The detector lab](docs/lab.jpg)

## How it is built

| | |
|---|---|
| Shell | Electron |
| Interface | React with a TipTap editor |
| Models | Free tiers only: Groq, OpenRouter `:free` models, or a local Ollama server. A local-only privacy mode restricts every task to Ollama, so no text leaves the machine |
| Storage | One JSON file per document, written atomically (temporary file then rename) with a backup kept and restored automatically if the main file is unreadable |

```
src/main/       Electron main process: AI providers, revision pipeline, detector lab, storage, import/export
src/renderer/   React interface: editor, library, revision views, profiles, lab, settings
src/shared/     Code used by both sides: diffing, meaning validation, prompt construction, text analysis
tests/e2e/      Playwright tests that drive the real application
scripts/        Build and benchmark scripts
```

## Running it

```
npm install
npm start
```

Keys are read from the environment or from `.env` in the app's data folder; see `.env.example`. Every provider is optional — with none configured, a local Ollama server is used.

```
npm run test:e2e                    # end-to-end tests against the built app
set FOLIO_E2E_OFFLINE=1 && npm run test:e2e   # skip tests that call a model
```

---

© 2026 Kabirr Kohli. All rights reserved. Published for viewing; no licence is granted to copy, modify or redistribute.
