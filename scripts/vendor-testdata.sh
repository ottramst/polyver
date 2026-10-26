#!/usr/bin/env sh
# Fetches vendored test data at pinned commits. Rerun after bumping a pin, then update
# testdata/README.md. Never add GPL-derived files here; see the "Excluded" section of that README.
set -eu

cd "$(dirname "$0")/.."

VERS_SPEC=7d0cc1914aa921ade2a68ed83640fbc3f9701e40
OSV_SCALIBR=1ca96d6fb34c58289978fbf732cac83281b962c4

fetch() { # <repo> <commit> <path> <dest>
  mkdir -p "$(dirname "$4")"
  curl -fsSL "https://raw.githubusercontent.com/$1/$2/$3" -o "$4"
}

for f in \
  LICENSE \
  tests/vers_canonical_parse_test.json \
  tests/npm_range_containment_test.json \
  tests/npm_range_from_native_test.json \
  tests/pypi_range_containment_test.json \
  tests/pypi_range_from_native_test.json \
  tests/pypi_range_validate_test.json \
  tests/intdot_version_cmp_test.json \
  tests/datetime_version_cmp_test.json \
  tests/lexicographic-test.json \
  types/npm-definition.json \
  types/pypi-definition.json; do
  fetch package-url/vers-spec "$VERS_SPEC" "$f" "testdata/vers-spec/$f"
done

fetch google/osv-scalibr "$OSV_SCALIBR" LICENSE testdata/osv-scalibr/LICENSE
for f in semver-versions.txt; do
  fetch google/osv-scalibr "$OSV_SCALIBR" "semantic/testdata/$f" "testdata/osv-scalibr/$f"
done
