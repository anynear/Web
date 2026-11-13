# Contributing

Issues and pull requests are welcome, in English or German.

## Build and test

The web app needs the ANMP core, which is built from the repositories `anynear/ANMP` and `anynear/ANDP`. Check out all
three next to each other; you need Node.js 24 and JDK 21. Details are in [`README.md`](README.md).

```bash
npm run anmp   # build the ANMP core into vendor/anmp-core (scripts/anmp.mjs)
npm ci
npm run dev    # http://localhost:5173
npm test       # unit tests (Vitest)
npm run build  # type check and production build into dist/
```

## Pull requests

- `main` only changes through pull requests with green CI; nobody pushes to `main` directly. This repository is
  published from the project's working repository: an accepted pull request is applied there with you as co-author
  (`Co-authored-by`), arrives here with the next update of `main`, and is then closed with a link to that commit.
- Keep a pull request to one topic and say what it changes and how you tested it.
- Protocol, cryptography and relay access come from the ANMP core. If something is missing there, extend the core
  instead of rebuilding it in TypeScript.
- Every visible text goes into both `src/i18n/de.ts` and `src/i18n/en.ts`.
- Do not add third-party scripts, fonts or trackers, and do not loosen the Content-Security-Policy in `index.html`.
- No secrets (keys, tokens, passwords) and no personal data in code, tests or examples; use made-up values.

## Security problems

Please do not report vulnerabilities in issues or pull requests; follow [`SECURITY.md`](SECURITY.md).

## Licence and Contributor License Agreement

Contributions need your agreement to the Contributor License Agreement in [CLA.md](CLA.md): you keep the copyright and
give the project a licence that also allows it to license your contribution under other terms. A bot asks for your
agreement in your first pull request; you agree by commenting the sentence it shows. Accepted contributions stay
available under GPL-3.0-or-later, like the rest of the repository. Because of this agreement, the project can also offer the code
under a commercial licence ([COMMERCIAL.md](COMMERCIAL.md)). Names and logos are excluded (`TRADEMARKS.md`).
