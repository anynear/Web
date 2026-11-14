# Release notes

One file per version: `release-notes/<X.Y.Z>.md`. The file also decides which version comes next: the highest
`X.Y.Z.md` without a tag `vX.Y.Z` is the open version, and every publication from `main` is a pre-release of it,
`X.Y.Z-pre.<build>` (Semantic Versioning, `scripts/version.sh`, same rules as in the app). To aim for another
version, rename the file.

- **Pre-release** (publication from `main`): a GitHub pre-release `vX.Y.Z-pre.<build>` with a line on top and the
  current state of the file, as in the app.
- **Version** (publication from the tag `vX.Y.Z`): the GitHub release carries the file as it is; the website shows the
  same text. After it, start the file of the next version.

Both stop if the file is missing or incomplete.

Write for the people who use anynear: what is new, what got better, what was fixed. Short sentences, no internal
numbers, no names of people, nothing about the size or the operation of the network.

## Format

```
## English

One or two sentences about the version (optional).

### New
- One entry per line, starting with "- ".

### Improved
- …

### Fixed
- …

### Good to know
- …

## Deutsch

(the same in German: ### Neu, ### Verbessert, ### Behoben, ### Gut zu wissen)
```

Both languages are required, each with at least one entry. Leave out headings that have no entry. Only these elements
are understood by the website: `## English` / `## Deutsch`, `###` headings, entries starting with `- `, and plain
paragraphs. Links are written as plain addresses.

Check a file with `scripts/release-notes.sh <X.Y.Z>`. Add to the file of the next version in the same pull request as
the change it describes.
