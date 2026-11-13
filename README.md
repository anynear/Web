# anynear in the browser

[anynear](https://anynear.app) is an app that connects a circle of people, for example a family, neighbours or a club:
messages, a shared storage for files and passwords, all end-to-end encrypted.

This repository contains the anynear web app (https://web.anynear.app): your circles and contacts on the computer.
The browser is paired with anynear on the phone by QR code and is then one more device of the same person.
There is no standalone anynear in the browser.

**Status: beta.** The software has not been independently reviewed (no external security audit). The procedures and
their known limits are described at https://anynear.app/en/technology/. Please report vulnerabilities as described in
[`SECURITY.md`](SECURITY.md). If you want to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md).

ADR numbers in comments and texts (e.g. “ADR 0059”) are internal decision numbers; the documents behind them are not
in this repository.

## What it can do

- Pairing: QR code `https://anynear.app/p#…`, the phone scans it under “More” → “My devices” → “Add a device”.
- Found circles, join by invitation link, invite (link and QR), view and remove members, leave; rename a circle,
  circle picture, invalidate old invitation links.
- Own contact link, add and remove a contact by link, direct messages.
- “People” as in the app: contacts and circles with a switch, “Share my contact” (QR code and link).
- Invitation links to circles, contacts and channels appear in the chat as a card with “Join”, “Add”, “Subscribe” or
  “Open” (`previewLink` of the core).
- Messages with states as in the app (Sending, Sent, Delivered, Read, “Read by 1 of 3”), reactions, clickable web
  addresses, search in the chat.
- Send attachments (up to 5, 10 MB each; photos reduced in size and without metadata) and view them.
- Alerts (ADR 0062): active alarms and warnings at the top, channels with their latest alert, history with state
  (active, all clear, expired), pictures and link; create a channel, subscribe by link (paste it or `/a#…` as a deep
  link), share, send an alert (without attachments), addresses for devices with examples, reset the link, leave.
  Official warnings only if `OFFICIAL_ALERTS_LINK` is set in `src/core/alerts.ts`, and only for your own district: when
  you switch them on, the browser asks for the approximate location, the district is determined in the browser and only
  the district is saved; without a district the web app neither shows nor announces any official warning. Every alert
  shows a notice (including info alerts and your own, once each), which can be switched off per channel; alarms stay on
  screen, but in the browser they do not become loud as they do in the app.
- Storage: My files and the storages of the circles, upload (also by dragging), open, save, delete.
- Passwords as in the app, unlocked with the computer's lock (passkey with PRF): view, copy, create, change and delete
  logins, one-time codes.
- “Set up a radio” (menu ⋮, also at `/radio` without pairing, ADR 0095): installs Meshtastic on a radio on the
  USB cable in Chrome or Edge on a computer (WebSerial); ESP32 through the ROM loader of the core, nRF52 as a file on
  the radio's drive (File System Access API, otherwise download). Pairing and settings afterwards are done by the app.
- Profile picture and name, browser notifications while the tab is open, installable as an app (PWA), German and
  English, “Delete anynear from this browser”.
- Notice “Please update anynear” with “Reload” as soon as the relays require a newer version (`updateNeeded` of the
  core, ADR 0061 decision 13).

## Structure

| Path | Content |
|---|---|
| `src/core/session.ts` | Session: ANMP core (`AnmpCoreWeb`), events, state as signals, actions |
| `src/core/messages.ts` | Message model as pure functions (states, confirmations, reactions, direct history from the phone) |
| `src/core/db.ts`, `storage.ts` | History, files you sent yourself and the encrypted files of the core (including alerts) in IndexedDB; keys and state of the core in `localStorage` (prefix `app:`); the IndexedDB is called `web` |
| `src/core/vault.ts`, `passwords.ts`, `lock.ts` | Password file in the format of the app, sync through the password space, lock by passkey with PRF |
| `src/core/alerts.ts`, `channels.ts` | Alerts and channels: rules as in the app (pure), state and actions from the core |
| `src/core/regions.ts`, `regions/` | District for the approximate location (nearest municipality centre point); table as CSV, copy from the app, loaded only when needed |
| `src/core/media.ts` | Reduce photos in size, file types, limits as in the app |
| `src/core/radioSetup.ts` | Radio setup over USB: serial line for the loader of the core, radios.json with fallback, writing to the drive |
| `src/ui/` | User interface (Preact): pairing, overview, conversation, details, settings, dialogs |
| `src/i18n/` | Texts in German and English, same keys (a test checks this) |
| `scripts/anmp.mjs` | builds the ANMP core as JS (ES modules) and puts it into `vendor/anmp-core` |
| `test/` | Unit tests (Vitest) |

The core (protocol, cryptography, access to the relays) comes from **ANMP** (Kotlin/JS). If the web app is missing
something, the facade `AnmpCoreWeb` is extended in ANMP, not rebuilt here.

## Build and test

This repository does not build on its own: the package `anmp-core` (`vendor/anmp-core`) is neither in the repo nor in
any package registry. It is built from the repository [`anynear/ANMP`](https://github.com/anynear/ANMP), which in turn
needs [`anynear/ANDP`](https://github.com/anynear/ANDP). Without these two repositories, neither `npm ci` nor the tests
nor the build work.

Requirements: Node.js 24, JDK 21 (for the Kotlin/JS build of the core) and the three repositories next to each other:

```
anynear/
  ANDP/
  ANMP/
  Web/     (this repository)
```

```bash
npm run anmp       # scripts/anmp.mjs: builds the ANMP core with Gradle and puts it into vendor/anmp-core
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type check and production build into dist/
```

`scripts/anmp.mjs` looks for ANMP under `../ANMP/kotlin` (from a Git worktree also under `../../ANMP/kotlin`); if it is
somewhere else, set `ANMP_DIR=<ANMP/kotlin>`. The Gradle build looks for ANDP next to ANMP, otherwise set
`ANDP_DIR=<ANDP/kotlin>`. After changes to the core, run `npm run anmp` again.

The browser must support Ed25519 and X25519 in WebCrypto (current Chrome, Edge, Firefox, Safari); otherwise the web app
shows “This browser is too old”.

## Security

The keys of the device are stored in `localStorage`. Therefore: a strict Content-Security-Policy in `index.html` (own
scripts only, connections only to `anynear.net` and `*.relay.anynear.net`), no third-party scripts or trackers, and a
notice during pairing that anynear should run here only on your own computer. The browser is removed on the phone under
“My devices”. Links for sharing are on `anynear.app`; the core also recognises them on `anynear.net`.

Passwords: in the browser, `pv` is stored only encrypted with a key from the PRF extension of a passkey of this site;
without Touch ID, Windows Hello or the computer's PIN it cannot be opened. Once unlocked, the logins exist only in the
memory of the page and never in IndexedDB or `localStorage`. Honest limit: the password space itself is encrypted with
the storage secret, which is kept in `localStorage`; anyone who gets code into this page permanently can reach it.

## Publishing

The web app runs at **https://web.anynear.app**. The workflow `.github/workflows/deploy.yml` builds and tests every
pull request and every merge to `main` (core, tests, production build), but publishes nothing in the process.
Publishing happens only by hand through “Run workflow”: with `main` as build `X.Y.Z-<hash>` (latest tag `vX.Y.Z` plus
commit) or with a tag `vX.Y.Z` on `main` as the new version `X.Y.Z`; the workflow aborts for tags outside `main`. The
finished `dist/` is uploaded. The secrets and variables needed for this are listed in the header of the workflow.

Changes to `main` are made only by pull request with green CI; nobody pushes to `main` directly.

## Licence

GPL-3.0-or-later (`LICENSE`, `NOTICE`); a commercial licence is available (`COMMERCIAL.md`). Names and logos are
excluded (`TRADEMARKS.md`).

For official warnings, the web app determines the district from the approximate location in the browser, using a table
of municipality centre points under `src/core/regions/` (unchanged copy from the app, generated there with
`scripts/regions.py`). Source: Gemeindeverzeichnis-Informationssystem GV-ISys (municipality directory), “Alle politisch
selbständigen Gemeinden mit ausgewählten Merkmalen am 31.12.2025 (4. Quartal)” (file `AuszugGV4QAktuell.xlsx`,
published January 2026, downloaded on 4 November 2026 from
[destatis.de](https://www.destatis.de/DE/Themen/Laender-Regionen/Regionales/Gemeindeverzeichnis/Administrativ/Archiv/GVAuszugQ/AuszugGV4QAktuell.html)).
© Statistisches Bundesamt (Destatis), 2026, on behalf of the Herausgebergemeinschaft Statistische Ämter des Bundes und
der Länder; geographic centre point coordinates: Bundesamt für Kartographie und Geodäsie (BKG). Reproduction and
distribution, also in part, are permitted provided the source is cited. The source is also cited in the web app under
“Official warnings” → “More about this”.

## Open

Notifications without an open tab (Web Push through the relays), recording voice messages, keys as non-exportable
WebCrypto keys.
