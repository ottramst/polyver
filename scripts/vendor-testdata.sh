#!/usr/bin/env sh
# Fetches vendored test data at pinned commits. Rerun after bumping a pin, then update
# testdata/README.md. Never add GPL-derived files here; see the "Excluded" section of that README.
set -eu

cd "$(dirname "$0")/.."

VERS_SPEC=7d0cc1914aa921ade2a68ed83640fbc3f9701e40
OSV_SCALIBR=1ca96d6fb34c58289978fbf732cac83281b962c4
NODE_SEMVER=6e05b7637396ac66522cff8731f07cfe0ef49a29 # v7.8.5
PACKAGING=929fd4b1410ac7ef61ef3f45b2f5d7e87711a9b5 # 26.3
XMOD=b5136e5ba156da612a1efc6e49b55988a134a5e0 # v0.42.0

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
  tests/maven_version_cmp_test.json \
  types/npm-definition.json \
  types/pypi-definition.json; do
  fetch package-url/vers-spec "$VERS_SPEC" "$f" "testdata/vers-spec/$f"
done

fetch google/osv-scalibr "$OSV_SCALIBR" LICENSE testdata/osv-scalibr/LICENSE
for f in semver-versions.txt pypi-versions.txt pypi-versions-generated.txt debian-versions.txt \
  debian-versions-generated.txt alpine-versions-generated.txt maven-versions.txt \
  maven-versions-generated.txt; do
  fetch google/osv-scalibr "$OSV_SCALIBR" "semantic/testdata/$f" "testdata/osv-scalibr/$f"
done

# node-semver fixtures are CommonJS modules; store them as JSON.
fetch npm/node-semver "$NODE_SEMVER" LICENSE testdata/node-semver/LICENSE
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for f in comparisons equality range-include range-exclude range-parse; do
  fetch npm/node-semver "$NODE_SEMVER" "test/fixtures/$f.js" "$tmp/$f.js"
  node scripts/js-fixture-to-json.ts "$tmp/$f.js" "testdata/node-semver/$f.json"
done

# pypa/packaging's version tests are Python; extract the vectors without running them.
fetch pypa/packaging "$PACKAGING" LICENSE.BSD testdata/packaging/LICENSE.BSD
fetch pypa/packaging "$PACKAGING" tests/test_version.py "$tmp/test_version.py"
python3 -I scripts/extract-packaging-vectors.py "$tmp/test_version.py" testdata/packaging/versions.json

# golang.org/x/mod's version tables are Go struct literals; extract them without running the tests.
fetch golang/mod "$XMOD" LICENSE testdata/x-mod/LICENSE
fetch golang/mod "$XMOD" semver/semver_test.go "$tmp/semver_test.go"
fetch golang/mod "$XMOD" module/pseudo_test.go "$tmp/pseudo_test.go"
node scripts/go-fixture-to-json.ts "$tmp/semver_test.go" "$tmp/pseudo_test.go" testdata/x-mod
