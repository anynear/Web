#!/usr/bin/env bash
# Release notes of a version: checks release-notes/<X.Y.Z>.md and prints it. The release workflow puts the text into
# the GitHub release, and stops when the file is missing or incomplete. Format: release-notes/README.md.
#
#   scripts/release-notes.sh 0.9.0                    # or v0.9.0: the file as it is (release of the version)
#   scripts/release-notes.sh --pre 10030 0.9.0        # release of the pre-release 0.9.0-pre.10030: a line on top, then the file
#   scripts/release-notes.sh --plain Deutsch 0.9.0    # one language as plain text (TestFlight “What to Test”)
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
languages=(English Deutsch)
die() { echo "release notes: $*" >&2; exit 1; }

mode=file build="" plain=""
case "${1:-}" in
  --pre) mode=pre build="${2:?usage: scripts/release-notes.sh --pre <build> <X.Y.Z>}"; shift 2 ;;
  --plain) mode=plain plain="${2:?usage: scripts/release-notes.sh --plain <language> <X.Y.Z>}"; shift 2 ;;
esac
version="${1:?usage: scripts/release-notes.sh [--pre <build> | --plain <language>] <X.Y.Z>}"
version="${version#v}"

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z, got $version"
[[ -z "$build" || "$build" =~ ^[1-9][0-9]*$ ]] || die "build must be a number, got $build"
file="$here/release-notes/$version.md"
[ -s "$file" ] || die "release-notes/$version.md is missing. Write it before tagging v$version."
for language in "${languages[@]}"; do
  grep -qx "## $language" "$file" || die "release-notes/$version.md has no section '## $language'"
  awk -v want="## $language" '$0 == want { on = 1; next } /^## / { on = 0 } on && /^- / { n++ } END { exit n ? 0 : 1 }' "$file" \
    || die "section '## $language' of release-notes/$version.md has no entry (a line starting with '- ')"
done
# Only notes of versions before the first public release carry a date line; a version that is released must not.
if grep -qE '^Date:' "$file"; then die "release-notes/$version.md has a Date line; that is only for versions without a GitHub release"; fi
if grep -nE 'TODO|TBD|XXX' "$file" >&2; then die "release-notes/$version.md still has placeholders"; fi

case "$mode" in
  file) cat "$file" ;;
  pre)
    printf 'Pre-release of anynear %s (build %s). What %s brings so far:\n\n' "$version" "$build" "$version"
    printf 'Vorabversion von anynear %s (Build %s). Was %s bisher bringt:\n\n' "$version" "$build" "$version"
    cat "$file" ;;
  plain)
    [[ " ${languages[*]} " == *" $plain "* ]] || die "language must be one of ${languages[*]}, got $plain"
    # Headings become lines of their own after an empty line, entries get a bullet; TestFlight shows no Markdown.
    awk -v want="## $plain" '
      $0 == want { on = 1; next } /^## / { on = 0 } !on { next }
      /^[[:space:]]*$/ { gap = 1; next }
      /^### / { gap = 1 }
      { if (gap && out) print ""; gap = 0; out = 1 }
      /^### / { print substr($0, 5); next }
      /^- / { print "• " substr($0, 3); next }
      { print }
    ' "$file" ;;
esac
