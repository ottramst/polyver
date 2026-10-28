# Research notes

Background research done before starting the project (October 2026). Links are the sources; re-check
anything marked _unverified_ before relying on it.

## Why this library

No npm package both parses [VERS](https://github.com/package-url/vers-spec) and evaluates ranges across
many ecosystems.

| Existing package                                                                                                                                                      | What it covers                                             | Gap                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`@csaf-rs/vers-rs`](https://github.com/csaf-rs/vers-rs)                                                                                                              | Rust compiled to WASM (~1.4 MB): parse, validate, contains | Only semver, npm, deb, cargo, intdot. PEP 440, Maven and RubyGems are TODO     |
| [`@windlass/vers-js`](https://github.com/windlasstech/vers-js)                                                                                                        | Zero-dep TypeScript, parse/validate/canonicalize           | Comparison and containment explicitly out of scope                             |
| [`@renovatebot/pep440`](https://github.com/renovatebot/pep440) (Apache-2.0), [`@renovatebot/ruby-semver`](https://github.com/renovatebot/ruby-semver) (MIT), `semver` | One ecosystem each, well maintained                        | No VERS                                                                        |
| `dpkg-compare-versions`, `deb-version-compare`, `mvncmp`                                                                                                              | One ecosystem each                                         | Stale or unmaintained                                                          |
| Renovate `lib/modules/versioning/`                                                                                                                                    | Most ecosystems                                            | **AGPL-3.0** and not published standalone. Read for reference only; never copy |

There is **no JS comparator for RPM or Alpine apk** at all.

Implementations in other languages: [univers](https://github.com/aboutcode-org/univers) (Python),
[andrew/vers](https://github.com/andrew/vers) (Ruby), versatile (Java),
[vers.net](https://github.com/JamieMagee/vers.net) (C#), and the Go comparators in
[osv-scalibr `semantic/`](https://github.com/google/osv-scalibr/tree/main/semantic) (Apache-2.0).

## The spec

- Lives at [package-url/vers-spec](https://github.com/package-url/vers-spec), split from purl-spec at
  v1.0.0 (2026-08-04); v1.2.1 (2026-10-07) was approved for submission to the Ecma General Assembly in
  December 2026. Ecma draft: [Ecma-TC54/ECMA-xxx-VERS](https://github.com/Ecma-TC54/ECMA-xxx-VERS).
- [Clause 5](https://github.com/package-url/vers-spec/blob/main/docs/specification/standard/Clause-5-VERS-Specification.md)
  defines syntax, the comparators `= != < <= > >= *`, validation (constraints sorted by version, unique
  versions, a single `*`, alternating `>`/`<`) and containment. **Comparison is delegated to each type.**
- Registered type definitions exist only for **npm** and **pypi**
  ([vers-types-index.json](https://github.com/package-url/vers-spec/blob/main/vers-types-index.json)).
  [vers-types.md](https://github.com/package-url/vers-spec/blob/main/docs/types/vers-types.md) lists
  alpm, apk, cargo, composer, cpan, dart, deb, gem, golang, hackage, maven, nuget, npm, pypi, rpm and the
  general types all, none, datetime, generic, intdot, lexicographic, semver. Writing type definitions for
  deb, rpm and apk upstream is a good way to contribute back.
- Conformance data in [tests/](https://github.com/package-url/vers-spec/tree/main/tests): canonical parse,
  npm/pypi containment, range-from-native for several types, version-compare for alpine, alpm, conan,
  datetime, gentoo, intdot, maven, nuget, openssl. README says MIT (GitHub shows NOASSERTION). The
  alpine file is copied from GPL apk-tools data (see below).
- The how-to containment algorithm ignores a range with a single `<` or `>` bound
  ([vers-spec#54](https://github.com/package-url/vers-spec/issues/54)); polyver implements the fix.
- Some upstream vectors contradict Clause 5.4 (checked 2026-10-26): 3 required cases in
  `pypi_range_validate_test.json` expect duplicate versions or broken `<`/`>` alternation to be valid,
  and 6 cases in `npm_range_from_native_test.json` turn overlapping `||` alternatives into duplicate
  versions or repeated `<`/`>` (one is the npm type definition's own example, `2.0.x || 2.1.x` to
  `>=2.0.0|<2.1.0|>=2.1.0|<2.2.0`). The canonical parse case `vers:npm/1.0%252F0` expects `1.0%2F0` to
  be a valid npm version. Separately, 5 npm range-from-native cases disagree with node-semver's own
  desugaring of x-ranges (`2.1 || 2.6` expected as exact versions, `>= 2.2.x` given an upper bound,
  `<= 1.0` as `<=1.0.0`). polyver follows Clause 5 and node-semver, and lists each case in
  `test/support/divergences.ts`.

## Demand

- CycloneDX 1.7 `versionRange` and `vulnerabilities[].affects[].versions[].range` must use VERS.
- CSAF 2.0/2.1 uses VERS (and the type-less "vls" variant).
- Dependency-Track uses versatile (Java) and has open work on CycloneDX 1.7 ranges
  ([DT#6934](https://github.com/DependencyTrack/dependency-track/issues/6934)) and false positives from
  wrong version comparison ([DT#3808](https://github.com/DependencyTrack/dependency-track/issues/3808)).
- OSV does not use VERS (it uses SEMVER/ECOSYSTEM/GIT events), but its comparators are the same problem;
  an OSV-range adapter is a natural later addition.

## Per-ecosystem references

| Scheme   | Spec                                                                                                                 | Reference implementation          | Permissive test vectors                                                    | Notorious edge cases                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| deb      | [Debian Policy §5.6.12](https://www.debian.org/doc/debian-policy/ch-controlfields.html#version)                      | dpkg `lib/dpkg/version.c` (GPL)   | osv-scalibr `debian-versions*.txt`; univers tests                          | `1.0~rc1 < 1.0`; epoch wins (`1:0.1 > 9.9`); missing revision = `-0`; letters sort before non-letters |
| rpm      | [RPM dependencies](https://rpm-software-management.github.io/rpm/manual/dependencies.html)                           | `rpmio/rpmvercmp.cc` (GPL/LGPL)   | our `rpm` oracle only (osv-scalibr `redhat-versions.txt` is GPL-derived)   | `~` before everything; `1.0 < 1.0^git1 < 1.0.1`; numeric beats alpha; separators ignored              |
| apk      | apk-tools `src/version.c` (GPL-2.0-only)                                                                             | same                              | osv-scalibr `alpine-versions-generated.txt`; our `apk` oracle              | `_alpha < _beta < _pre < _rc < (none) < _cvs < _svn < _git < _hg < _p`; `1.2a`; `-rN`                 |
| pypi     | [Version specifiers (PEP 440)](https://packaging.python.org/en/latest/specifications/version-specifiers/)            | pypa/packaging (Apache/BSD)       | vers-spec `pypi_*`; osv-scalibr `pypi-versions*.txt`                       | `1.0.dev0 < 1.0a1 < 1.0 < 1.0.post1`; epochs `1!`; normalization `1.0-1 == 1.0.post1`                 |
| npm      | [semver 2.0.0](https://semver.org/spec/v2.0.0.html), [node-semver ranges](https://github.com/npm/node-semver#ranges) | node-semver (ISC)                 | node-semver fixtures; vers-spec `npm_*`                                    | pre-releases only match within the same `M.m.p`; build metadata ignored                               |
| maven    | [POM version order](https://maven.apache.org/pom.html#version-order-specification)                                   | `ComparableVersion.java` (Apache) | osv-scalibr `maven-versions*.txt`; vers-spec `maven_version_cmp_test.json` | `alpha < beta < milestone < rc=cr < snapshot < "" = ga = final < sp`; `1.0 == 1.0.0`                  |
| golang   | [go.dev/ref/mod#versions](https://go.dev/ref/mod#versions)                                                           | golang.org/x/mod (BSD-3)          | `semver_test.go`, `pseudo_test.go`                                         | pseudo-versions are pre-releases; `+incompatible`; `v` prefix often omitted in OSV/VERS               |
| gem      | [RubyGems patterns](https://guides.rubygems.org/patterns/)                                                           | `rubygems/version.rb` (MIT)       | osv-scalibr `rubygems-versions*.txt`                                       | any letter makes a pre-release; `1.0 == 1.0.0`                                                        |
| nuget    | [NuGet versioning](https://learn.microsoft.com/en-us/nuget/concepts/package-versioning)                              | NuGet.Versioning (Apache)         | vers-spec `nuget_*`                                                        | 4-part versions; case-insensitive pre-release labels                                                  |
| cargo    | [Cargo dependencies](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html)                         | dtolnay/semver (MIT/Apache)       | its tests                                                                  | bare `1.2` = `^1.2`; `^0.0.3` = `=0.0.3`                                                              |
| composer | [Composer versions](https://getcomposer.org/doc/articles/versions.md)                                                | composer/semver (MIT)             | osv-scalibr `packagist-versions*.txt`                                      | 4-part normalization; stability flags; `dev-` branches                                                |

## Findings from the oracles (2026-10-26)

- dpkg 1.22 reads the epoch with `strtol`, so `+2:1` is valid and equal to `2:1`, and so is `-0:1`;
  a negative epoch such as `-1:1` is invalid.
- rpm 6.0 (`rpm.ver`): a missing release sorts before any release, even one starting with `~`
  (`1.0 < 1.0-~1`); rpm accepts any string as a version.
- apk-tools 3.0: a missing suffix number or revision sorts before an explicit 0 (`1.0 < 1.0-r0`,
  `_svn < _svn0`), unless a post-release suffix follows the missing number (`1.0_rc_p > 1.0_rc1`), and
  more components sort higher (`1.0 < 1.0.0`). apk-tools 2.14 differs on `~hash`
  validity and on components with leading zeros; see [testdata/README.md](../testdata/README.md#oracle-vectors).

## Findings from the Maven oracle (2026-10-28)

- `ComparableVersion` in maven-artifact 4.0.0-rc-7 has changes that 3.9.16 lacks: MNG-7714 (2023)
  makes a qualifier followed by a number, such as `sp1` or `X-1`, a single item, so `1-sp1 > 1-final`;
  MNG-6568 (September 2026) removes cycles from qualifier comparison; and a fix from the same month
  corrects parsing inconsistencies and rejects versions over 256 characters. On the same inputs, 3.9.16
  orders 110 of 7,883 pairs differently; none of the 946 pairs of two real Maven Central versions are
  affected.
- osv-scalibr's Maven vectors predate Maven 3.9: 19 of their pairs disagree with both 3.9.16 and
  4.0.0-rc-7, and 5 more with 4.0.0-rc-7 only. vers-spec `maven_version_cmp_test.json` expects
  `2-1 < 2.0.a`, but since Maven 3.9 (MNG-7644) `2.0.a` reads as `2-a`, which sorts first.

## Licensing of test data

- **Do not vendor** dpkg's `t-version.c`, rpm's `tests/rpmvercmp.at`, apk-tools' `test/unit/version.data`,
  or univers' `alpine_test.txt` / `rpmvercmp.at`: they are GPL.
- **Also do not vendor copies of them published under permissive licenses:** vers-spec
  `alpine_version_cmp_test.json` (all 716 pairs are from apk-tools' `version.data`), osv-scalibr
  `alpine-versions.txt` (says it is from that file) and osv-scalibr `redhat-versions.txt` (contains 96 of
  the 103 pairs of `rpmvercmp.at`). Details in [testdata/README.md](../testdata/README.md#excluded).
- **Permissive sources:** osv-scalibr `semantic/testdata` (Apache-2.0), vers-spec `tests/` (MIT),
  pypa/packaging tests, node-semver fixtures, dtolnay/semver tests.
- **Oracles:** generate our own vectors by running the real tools (`dpkg --compare-versions`,
  `rpmdev-vercmp`/`rpm --eval '%{lua:...}'`, `apk version -t`) in containers, and commit the output with
  the generator script. Record the tool version for each file.

## npm name

`vers` and `univers` are taken (dead packages). `polyver` was free in October 2026.
