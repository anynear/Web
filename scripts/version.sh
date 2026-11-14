#!/usr/bin/env bash
# Version of a release run (Semantic Versioning 2.0.0), printed as key=value lines for $GITHUB_OUTPUT:
#
#   Tag vX.Y.Z      version X.Y.Z
#   main            pre-release X.Y.Z-pre.<build>; X.Y.Z is the open version: the highest release-notes/X.Y.Z.md that has no
#                   tag vX.Y.Z yet
#
# Build number = number of commits up to HEAD (ADR 0096 §8, as __APP_BUILD__ in vite.config.ts). A pre-release sorts
# before its version (0.9.0-pre.1200 < 0.9.0-pre.1203 < 0.9.0). Same rules as in the app (repo App, scripts/version.sh).
#
#   GITHUB_REF=refs/heads/main scripts/version.sh
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
ref="${GITHUB_REF:?GITHUB_REF is not set}"
die() { echo "::error::$*" >&2; exit 1; }

cd "$here"
git merge-base --is-ancestor HEAD origin/main || die "$ref is not on main."
count=$(git rev-list --count HEAD)
commit=$(git rev-parse --short=7 HEAD)

if [[ "$ref" == refs/tags/* ]]; then
  tag="${ref#refs/tags/}"
  [[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || die "Releases only from main or a tag vX.Y.Z without a suffix, not from $tag."
  marketing="${BASH_REMATCH[1]}"
  name="$marketing"
  code=$count
  pre=false
elif [ "$ref" = refs/heads/main ]; then
  marketing=$(find release-notes -maxdepth 1 -name '*.md' -exec basename {} .md \; | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
  [ -n "$marketing" ] || die "There is no release-notes/X.Y.Z.md for the next version."
  [ -z "$(git tag --list "v$marketing")" ] || die "v$marketing is already released. Add release-notes/<next version>.md first."
  code=$count
  name="$marketing-pre.$code"
  pre=true
else
  die "Releases only from main or a tag vX.Y.Z, not from $ref."
fi

echo "name=$name"
echo "tag=v$name"
echo "marketing=$marketing"
echo "code=$code"
echo "pre=$pre"
echo "commit=$commit"
echo "date=$(git log -1 --format=%cI)"
