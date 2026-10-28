#!/usr/bin/env sh
# Runs the real version-comparison tool for one ecosystem in a digest-pinned container over the
# inputs from generate.ts, and writes:
# - testdata/oracle/<eco>.txt: `a <op> b` for every pair whose versions are both valid,
# - testdata/oracle/<eco>-validity.txt: `valid <v>` or `invalid <v>` for every input version,
# - for gem, testdata/oracle/gem-requirements.txt: `<v> satisfies|fails <requirement>`,
# - for nuget, testdata/oracle/nuget-ranges.txt: `valid-range|invalid-range <range>`, then
#   `<v> satisfies|fails <range>`.
# The output depends only on committed files and the pinned image, so a rerun is byte-identical.
# Usage: scripts/oracle/run.sh deb|rpm|apk|maven|golang|gem|nuget
# The single-quoted scripts here run inside the container, so they must not expand on the host.
# shellcheck disable=SC2016
set -eu

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/oracle/images.env
. scripts/oracle/images.env

eco="${1:?usage: run.sh deb|rpm|apk|maven|golang|gem|nuget}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
node scripts/oracle/generate.ts "$eco" "$tmp" >&2

fetch_jar() { # <version> <sha256> <name>: maven-artifact from Maven Central, checksum verified
  jar="$tmp/maven-artifact-$3.jar"
  curl -fsSL "https://repo1.maven.org/maven2/org/apache/maven/maven-artifact/$1/maven-artifact-$1.jar" -o "$jar"
  sum="$( (sha256sum "$jar" 2>/dev/null || shasum -a 256 "$jar") | cut -d ' ' -f 1)"
  if [ "$sum" != "$2" ]; then
    echo "maven-artifact $1: SHA-256 $sum, expected $2" >&2
    exit 1
  fi
}

case "$eco" in
  deb)
    image="$DEB_IMAGE"
    tool='dpkg --version | head -n 1'
    # dpkg only warns about some invalid versions when comparing, so validate first.
    script='
      while IFS= read -r v; do
        if dpkg --validate-version -- "$v" 2>/dev/null; then echo "valid $v"; else echo "invalid $v"; fi
      done </in/versions.txt >/out/validity.txt
      sed -n "s/^valid //p" /out/validity.txt >/tmp/valid
      awk "NR == FNR { ok[\$0] = 1; next } (\$1 in ok) && (\$2 in ok)" /tmp/valid /in/pairs.txt |
        while IFS=" " read -r a b; do
          if dpkg --compare-versions -- "$a" lt "$b"; then op="<"
          elif dpkg --compare-versions -- "$a" eq "$b"; then op="="
          else op=">"; fi
          echo "$a $op $b"
        done >/out/pairs.txt'
    ;;
  rpm)
    image="$RPM_IMAGE"
    tool='rpm --version'
    # rpm.ver() parses an [epoch:]version[-release] string; a parse error marks it invalid.
    script='rpm --eval "%{lua:
      local valid = {}
      local out = io.open(\"/out/validity.txt\", \"w\")
      for v in io.lines(\"/in/versions.txt\") do
        valid[v] = pcall(rpm.ver, v)
        out:write((valid[v] and \"valid \" or \"invalid \") .. v .. \"\\n\")
      end
      out:close()
      out = io.open(\"/out/pairs.txt\", \"w\")
      for line in io.lines(\"/in/pairs.txt\") do
        local a, b = line:match(\"^(%S+) (%S+)$\")
        if valid[a] and valid[b] then
          local x, y = rpm.ver(a), rpm.ver(b)
          local op = x < y and \"<\" or (x == y and \"=\" or \">\")
          out:write(a .. \" \" .. op .. \" \" .. b .. \"\\n\")
        end
      end
      out:close()
    }" >/dev/null'
    ;;
  apk)
    image="$APK_IMAGE"
    tool='apk --version'
    script='
      while IFS= read -r v; do
        if apk version -c -- "$v" >/dev/null; then echo "valid $v"; else echo "invalid $v"; fi
      done </in/versions.txt >/out/validity.txt
      sed -n "s/^valid //p" /out/validity.txt >/tmp/valid
      awk "NR == FNR { ok[\$0] = 1; next } (\$1 in ok) && (\$2 in ok)" /tmp/valid /in/pairs.txt |
        while IFS=" " read -r a b; do echo "$a $(apk version -t -- "$a" "$b") $b"; done >/out/pairs.txt'
    ;;
  maven)
    image="$MAVEN_IMAGE"
    tool="java -version 2>&1 | head -n 1 | sed 's/^/maven-artifact $MAVEN_ARTIFACT on /'"
    fetch_jar "$MAVEN_ARTIFACT" "$MAVEN_ARTIFACT_SHA256" new
    fetch_jar "$MAVEN_ARTIFACT_OLD" "$MAVEN_ARTIFACT_OLD_SHA256" old
    cp scripts/oracle/Oracle.java "$tmp/"
    # The second run, with Maven 3.9, only records where the two versions disagree.
    script='
      java -cp /in/maven-artifact-new.jar /in/Oracle.java /in/versions.txt /in/pairs.txt \
        /out/validity.txt /out/pairs.txt &&
      java -cp /in/maven-artifact-old.jar /in/Oracle.java /in/versions.txt /in/pairs.txt \
        /tmp/validity.txt /out/pairs-old.txt'
    ;;
  golang)
    image="$GOLANG_IMAGE"
    xmod="$(sed -n 's|^require golang.org/x/mod ||p' scripts/oracle/golang/go.mod)"
    tool="go env GOVERSION | sed 's|^|golang.org/x/mod $xmod on |'"
    cp scripts/oracle/golang/main.go scripts/oracle/golang/go.mod scripts/oracle/golang/go.sum "$tmp/"
    script='cd /in && go run . /in/versions.txt /in/pairs.txt /out/validity.txt /out/pairs.txt'
    ;;
  gem)
    image="$GEM_IMAGE"
    tool="echo \"rubygems \$(gem -v) on \$(ruby -v | cut -d ' ' -f 1-2)\""
    cp scripts/oracle/gem.rb "$tmp/"
    script='cd /in && ruby gem.rb versions.txt pairs.txt requirements.txt /out/validity.txt /out/pairs.txt /out/requirements.txt'
    ;;
  nuget)
    image="$NUGET_IMAGE"
    nv="$(sed -n 's|.*Include="NuGet.Versioning" Version="\([^"]*\)".*|\1|p' scripts/oracle/nuget/Oracle.csproj)"
    tool="DOTNET_NOLOGO=1 dotnet --version | sed 's|^|NuGet.Versioning $nv on .NET SDK |'"
    mkdir "$tmp/nuget"
    cp scripts/oracle/nuget/Oracle.csproj scripts/oracle/nuget/Program.cs \
      scripts/oracle/nuget/packages.lock.json "$tmp/nuget/"
    # /in is read-only, and dotnet writes bin/ and obj/ next to the project.
    script='
      export DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1
      cp -R /in/nuget /tmp/oracle && cd /tmp/oracle &&
        dotnet restore --locked-mode >/dev/null &&
        dotnet run --no-restore -c Release -- /in/versions.txt /in/pairs.txt /in/ranges.txt \
          /in/range-rows.txt /out/validity.txt /out/pairs.txt /out/ranges.txt'
    ;;
  *)
    echo "unknown ecosystem: $eco" >&2
    exit 2
    ;;
esac

mkdir -p "$tmp/out"
# Drop the CPU architecture from the version line, so that the output is the same on amd64 and arm64.
version="$(docker run --rm "$image" sh -c "$tool" | sed -E 's/ \([a-z0-9_]+\)\.?$//; s/, compiled for .*$//')"
docker run --rm -v "$tmp:/in:ro" -v "$tmp/out:/out" "$image" sh -c "$script"

header="# Generated by scripts/oracle/run.sh $eco with $version
# Image: $image
# Inputs: scripts/oracle/cases/$eco.txt, testdata/oracle/$eco-index.txt and scripts/oracle/generate.ts."
{ echo "$header"; cat "$tmp/out/pairs.txt"; } >"testdata/oracle/$eco.txt"
{ echo "$header"; cat "$tmp/out/validity.txt"; } >"testdata/oracle/$eco-validity.txt"
if [ -f "$tmp/out/requirements.txt" ]; then
  {
    echo "$header"
    echo "# Requirements: scripts/oracle/cases/$eco-requirements.txt, checked against cases/$eco.txt."
    cat "$tmp/out/requirements.txt"
  } >"testdata/oracle/$eco-requirements.txt"
  echo "wrote testdata/oracle/$eco-requirements.txt" >&2
fi
if [ -f "$tmp/out/ranges.txt" ]; then
  {
    echo "$header"
    echo "# Ranges: scripts/oracle/cases/$eco-ranges.txt, checked against cases/$eco.txt."
    cat "$tmp/out/ranges.txt"
  } >"testdata/oracle/$eco-ranges.txt"
  echo "wrote testdata/oracle/$eco-ranges.txt" >&2
fi
if [ -f "$tmp/out/pairs-old.txt" ]; then
  old="testdata/oracle/$eco-${MAVEN_ARTIFACT_OLD%.*}.txt"
  {
    echo "# Generated by scripts/oracle/run.sh $eco with maven-artifact $MAVEN_ARTIFACT_OLD, to compare with $eco.txt"
    echo "# Image: $image"
    cat "$tmp/out/pairs-old.txt"
  } >"$old"
  echo "wrote $old" >&2
fi
echo "wrote testdata/oracle/$eco.txt ($(wc -l <"$tmp/out/pairs.txt" | tr -d ' ') pairs) and $eco-validity.txt" >&2
