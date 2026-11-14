# Release notes

One file per version: `release-notes/<X.Y.Z>.md`. The file also decides which version comes next: the highest
`X.Y.Z.md` without a tag `vX.Y.Z` is the open version, and every publication from `main` is a pre-release of it,
`X.Y.Z-pre.<build>` (Semantic Versioning, `scripts/version.sh`, same rules as in the app). To aim for another
version, rename the file. A pre-release gets no GitHub release; the tag `vX.Y.Z` copies the file into the GitHub
release of the version, and the website shows the same text. Both stop if the file is missing or incomplete. After a
version, start the file of the next one.

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
