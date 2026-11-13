#!/usr/bin/env bash
# Release notes of a version: checks release-notes/<X.Y.Z>.md and prints it. The release workflow puts the text into
# the GitHub release, and stops when the file is missing or incomplete. Format: release-notes/README.md.
#
#   scripts/release-notes.sh 0.9.0        # or v0.9.0
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
languages=(English Deutsch)
version="${1:?usage: scripts/release-notes.sh <X.Y.Z>}"
version="${version#v}"
die() { echo "release notes: $*" >&2; exit 1; }

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z, got $version"
file="$here/release-notes/$version.md"
[ -s "$file" ] || die "release-notes/$version.md is missing. Write it before tagging v$version."
for language in "${languages[@]}"; do
  grep -qx "## $language" "$file" || die "release-notes/$version.md has no section '## $language'"
  awk -v want="## $language" '$0 == want { on = 1; next } /^## / { on = 0 } on && /^- / { n++ } END { exit n ? 0 : 1 }' "$file" \
    || die "section '## $language' of release-notes/$version.md has no entry (a line starting with '- ')"
done
if grep -nE 'TODO|TBD|XXX' "$file" >&2; then die "release-notes/$version.md still has placeholders"; fi
cat "$file"
