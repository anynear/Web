# Release notes

One file per version: `release-notes/<X.Y.Z>.md`. The release workflow copies it into the GitHub release of the tag
`vX.Y.Z` and stops if it is missing; the website shows the same text. Builds between versions get no notes.

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
