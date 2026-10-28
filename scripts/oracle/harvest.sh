#!/usr/bin/env sh
# Samples real-world version strings from a distribution's own package index (for Maven, the
# maven-metadata.xml of the artifacts listed in scripts/oracle/maven-artifacts.txt) into
# testdata/oracle/<eco>-index.txt. The repositories change daily, so the sample is committed and
# `run.sh` only reads committed inputs. Usage: scripts/oracle/harvest.sh deb|rpm|apk|maven
# The single-quoted scripts here run inside the container, so they must not expand on the host.
# shellcheck disable=SC2016
set -eu

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/oracle/images.env
. scripts/oracle/images.env

eco="${1:?usage: harvest.sh deb|rpm|apk|maven}"
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
  *)
    echo "unknown ecosystem: $eco" >&2
    exit 2
    ;;
esac

out="testdata/oracle/$eco-index.txt"
mkdir -p testdata/oracle
if [ "$eco" = maven ]; then
  origin='Repository: https://repo1.maven.org/maven2'
  all="$(sed -n '/^[^#]/p' scripts/oracle/maven-artifacts.txt | while IFS=: read -r group artifact; do
    group_path="$(printf '%s' "$group" | tr . /)"
    curl -fsSL "https://repo1.maven.org/maven2/$group_path/$artifact/maven-metadata.xml" |
      sed -n 's|.*<version>\(.*\)</version>.*|\1|p'
  done | LC_ALL=C sort -u)"
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
