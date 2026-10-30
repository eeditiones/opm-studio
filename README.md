# OPM Studio

Transform XML with the Open Processing Model, entirely in the browser. Runs the `opm` wheel under Pyodide (CPython in WebAssembly); there is no server-side code. Live at https://studio.e-editiones.org/.

    uv build --wheel ../tei-publisher-py -o dist     # the opm wheel the page installs
    npm install
    npm run dev       # bundles src/ into dist/app.js on every change and serves http://localhost:8000
    npm run build     # minified bundle for deployment
    npm run check     # type check (TypeScript, no output)
    npm test          # unit tests, then every output mode headless under Pyodide in Node

The tests read ODDs and examples from the opm checkout at `../tei-publisher-py`; set `OPM_DIR` to use another path.

The page works on projects laid out like `opm init` creates them (`opm.toml`, `odd/`, `data/`, `templates/`). They live in the browser (IndexedDB), are saved as you type, and export as a `.zip` the `opm` CLI can run.

In Chrome, Edge and other Chromium browsers a project can also be kept in sync with a folder on disk: "Open folder…" on the start page turns a folder into a project, and "Sync with folder…" in the project menu links an open one. Changes flow both ways while the page is open; a file changed on both sides since the last sync is shown so you can pick a version. After a reload the browser may ask for access to the folder again. Firefox and Safari can't write to folders, so there the feature is hidden.

Every push to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). The workflow builds the opm wheel from `eeditiones/open-processing-model` (`main` by default; run it by hand to pick another ref) and fails if the wheel's name differs from `WHEEL` in `src/config.ts`.

The documentation site in `docs/` is built with VitePress and deployed with the app under `/docs/`. Pages are Markdown; the landing page is `docs/index.md`, the sidebar is set in `docs/.vitepress/config.mts`.

    cd docs && npm install
    npm run dev       # serves the docs with live reload

## Code layout

    src/main.ts           boot: wire the panes, load Python and opm, reopen the last project
    src/state.ts          the shared state and a small event bus
    src/actions.ts        changes to state that several panes care about (open a file, a project, …)
    src/config.ts         output modes, CDN URLs, the wheel name
    src/runtime/          Pyodide loading; glue.py and its typed wrappers in opm.ts
    src/project/          project files in Pyodide's file system, opm.toml, zip, IndexedDB, autosave, folder sync
    src/odd/              ODD parsing and in-place text edits behind the visual ODD editor (from ODDity)
    src/ui/               one module per pane or widget: editor, explorer, output, start, switcher, …
    src/ui/odd/           the visual ODD editor: Lit components ported from ODDity
    tests/unit/           node:test tests for the pure modules
    tests/node/           headless Pyodide runs of the wheel

The `chunk` output mode runs `opm chunk` and writes the pages to `/tmp/opm-chunks/` in Pyodide, outside the project. `src/ui/previews/site.ts` copies them into Cache Storage under `preview/<run>/`, and `sw.js` serves that path to the preview frame as a static server would. The rendered web and print previews take the same route when their template links assets (`[transform.web] assets`): the page and its `assets/` folder are published together, as `opm transform -o` writes them.

The source editor validates XML documents and offers completions based on a RELAX NG schema. `src/ui/xmlSchema.ts` picks the schema for each document:

1. the `.rng` file named by the document's `<?xml-model?>` instruction, if it exists in the project;
2. otherwise the schema set in `opm.toml` with `[editor] schema = "path/to/schema.rng"`;
3. otherwise, for TEI, DocBook and JATS documents, the complete schema of that format from `schema/<name>/`, and for ODDs `schema/odd/teipublisher_odds.rng`: TEI with TEI Publisher's `pb:` extensions. `npm run schemas` downloads the first three and compiles the ODD schema from jinks' `teipublisher_odds.odd` with `opm odd compile --format rng` (from checkouts of jinks and opm beside this one if there are any); `scripts/schemas.py` lists the versions, and `src/ui/xmlSchema.ts` lists the main file of each.

ODDs skip step 2: `[editor] schema` is meant for the project's documents.

Validation and completion run in a Web Worker (`src/runtime/validator.ts`, bundled as `dist/validator.js`) using [salve-annos](https://www.npmjs.com/package/salve-annos). The worker converts each schema into a grammar the first time it is needed and keeps it for the rest of the session. A project schema is sent to the worker together with all other `.rng` files in the project, so that its `include` and `externalRef` links resolve; a default schema is fetched from the site together with the files it includes.

- `src/runtime/validate.ts` parses the document with saxes, passes it to the grammar, and returns each error with its position, which the editor underlines using `@codemirror/lint`.
- `src/runtime/complete.ts` passes the text before the cursor to the grammar and returns the elements, attributes or values allowed at that point, together with the descriptions from the schema's documentation. `src/ui/xmlCompletion.ts` shows them as completions.

The ODD editor's Document button runs `opm odd document` on the open ODD. Because a TEI customization takes close to a minute, it runs in a Web Worker with its own Pyodide (`src/runtime/docworker.ts`, bundled as `dist/docworker.js`), and the site is shown through the same `preview/` route. opm merges TEI customizations onto `p5all.xml.gz`, which it would download from a GitHub release. The browser cannot fetch that cross-origin, so the Pages build puts it in `dist/` beside the wheel. For local development, download it once:

    curl -sSfL -o dist/p5all.xml.gz https://github.com/eeditiones/open-processing-model/releases/download/tei-data/p5all.xml.gz

Panes never call each other. An action changes `state` and emits what changed (`project`, `files`, `config`, `edit`, `file`, `source`, `sync`, `docs`); each pane subscribes to the events that affect it in its `init…()` function.

## License

Copyright (C) 2026 e-editiones

OPM Studio is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

The default schemas in `schema/` are the TEI, DocBook and JATS schemas and stay under their terms; see [schema/README.md](schema/README.md).

The opm logo is a trademark of its owners and is not covered by this licence.
