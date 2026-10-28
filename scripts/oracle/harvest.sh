#!/usr/bin/env sh
# Samples real-world version strings from a distribution's own package index (for Maven, the
# maven-metadata.xml of the artifacts listed in scripts/oracle/maven-artifacts.txt; for Go, the module
# index; for RubyGems, the compact index; for Composer, the Packagist metadata of the most popular
# packages) into testdata/oracle/<eco>-index.txt. The repositories change daily, so the sample is
# committed and `run.sh` only reads committed inputs.
# Usage: scripts/oracle/harvest.sh deb|rpm|apk|maven|golang|gem|composer
# The single-quoted scripts here run inside the container, so they must not expand on the host.
# shellcheck disable=SC2016
set -eu

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/oracle/images.env
. scripts/oracle/images.env

eco="${1:?usage: harvest.sh deb|rpm|apk|maven|golang|gem|composer}"
case "$eco" in
  deb)
    image="$DEB_IMAGE"
    source='Debian stable main (apt-cache dumpavail)'
    cmd='apt-get update -qq >/dev/null && apt-cache dumpavail | sed -n "s/^Version: //p"'
    ;;
  rpm)
    image="$RPM_IMAGE"
    source='Fedora repositories (dnf repoquery)'
    cmd='dnf -q repoquery --available --qf "%{epoch}:%{version}-%{release}\n" 2>/dev/null'
    ;;
  apk)
    image="$APK_IMAGE"
    source='Alpine main and community (APKINDEX)'
    cmd='apk update -q >/dev/null 2>&1; for f in /var/cache/apk/APKINDEX.*.tar.gz; do tar -xzOf "$f" APKINDEX; done | sed -n "s/^V://p"'
    ;;
  maven)
    source='Maven Central (maven-metadata.xml of scripts/oracle/maven-artifacts.txt)'
    ;;
  golang)
    source='the Go module index (2,000 entries from each 1 April, 2019-2026)'
    ;;
  gem)
    source='the RubyGems compact index, without yanked versions or platform suffixes'
    ;;
  composer)
    source='the Packagist metadata (tags and branches) of the 200 most popular packages'
    ;;
  *)
    echo "unknown ecosystem: $eco" >&2
    exit 2
    ;;
esac

out="testdata/oracle/$eco-index.txt"
mkdir -p testdata/oracle
if [ "$eco" = maven ]; then
  origin='Repository: https://repo1.maven.org/maven2'
  metadata="$(mktemp)"
  trap 'rm -f "$metadata"' EXIT
  # Not a pipeline, so that `set -e` stops on a failed download instead of dropping the artifact.
  for coordinates in $(sed -n '/^[^#]/p' scripts/oracle/maven-artifacts.txt); do
    group_path="$(printf '%s' "${coordinates%%:*}" | tr . /)"
    curl -fsSL "https://repo1.maven.org/maven2/$group_path/${coordinates#*:}/maven-metadata.xml" \
      >>"$metadata"
  done
  all="$(sed -n 's|.*<version>\(.*\)</version>.*|\1|p' "$metadata" | LC_ALL=C sort -u)"
elif [ "$eco" = golang ]; then
  origin='Index: https://index.golang.org/index'
  index="$(mktemp)"
  trap 'rm -f "$index"' EXIT
  for year in 2019 2020 2021 2022 2023 2024 2025 2026; do
    curl -fsSL "https://index.golang.org/index?since=$year-04-01T00:00:00Z&limit=2000" >>"$index"
  done
  all="$(sed -n 's|.*"Version":"\([^"]*\)".*|\1|p' "$index" | LC_ALL=C sort -u)"
elif [ "$eco" = gem ]; then
  origin='Index: https://rubygems.org/versions'
  index="$(mktemp)"
  trap 'rm -f "$index"' EXIT
  curl -fsSL https://rubygems.org/versions -o "$index"
  # Lines are `name v1,v2,... md5` after a `---` header. The file is append-only: a yank appends
  # `name -v`, and the earlier line still lists `v`, so yanks are matched by gem name and version. A
  # `-` within a version starts its platform (`1.0.0-java`): Gem::Version reads `-` as `.pre.`, so a
  # published version never contains one.
  all="$(sed '1,/^---$/d' "$index" | awk '
    {
      n = split($2, v, ",")
      for (i = 1; i <= n; i++) {
        if (sub(/^-/, "", v[i])) yanked[$1 " " v[i]] = 1
        else listed[$1 " " v[i]] = 1
      }
    }
    END {
      for (k in listed) {
        if (k in yanked) continue
        sub(/^[^ ]* /, "", k)
        sub(/-.*/, "", k)
        print k
      }
    }' | LC_ALL=C sort -u)"
elif [ "$eco" = composer ]; then
  origin='Repository: https://repo.packagist.org/p2 (packages from https://packagist.org/explore/popular.json)'
  metadata="$(mktemp)"
  trap 'rm -f "$metadata"' EXIT
  names="$(for page in 1 2; do
    curl -fsSL "https://packagist.org/explore/popular.json?per_page=100&page=$page"
  done | grep -o '"name":"[^"]*"' | sed 's|^"name":"||; s|"$||; s|\\/|/|g')"
  # `<name>.json` lists tagged releases and `<name>~dev.json` branches (`dev-main`, `2.x-dev`). Not a
  # pipeline, so that `set -e` stops on a failed download instead of dropping the package.
  for name in $names; do
    curl -fsSL "https://repo.packagist.org/p2/$name.json" >>"$metadata"
    curl -fsSL "https://repo.packagist.org/p2/$name~dev.json" >>"$metadata"
  done
  # JSON escapes `/` as `\/`; other escapes do not occur in versions.
  all="$(grep -o '"version":"[^"]*"' "$metadata" | sed 's|^"version":"||; s|"$||; s|\\/|/|g' |
    LC_ALL=C sort -u)"
else
  origin="Image: $image"
  all="$(docker run --rm "$image" sh -c "$cmd" | LC_ALL=C sort -u)"
fi
total="$(printf '%s\n' "$all" | wc -l | tr -d ' ')"
# Keep about 1,000 versions, evenly spaced in sorted order.
step=$(((total + 999) / 1000))
{
  echo "# Version strings sampled from $source on $(date -u +%Y-%m-%d)."
  echo "# $origin. Every ${step}th of $total distinct versions, in C-locale sort order."
  printf '%s\n' "$all" | awk -v step="$step" 'NR % step == 1 || step == 1'
} >"$out"
echo "wrote $out"
