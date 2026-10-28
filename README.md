# polyver

Compare package versions and evaluate [VERS](https://github.com/package-url/vers-spec) version ranges
across ecosystems, in JavaScript and TypeScript. Zero dependencies; runs in Node.js, browsers, Deno and Bun.

> **Status:** stable. Since 1.0.0 the API follows [Semantic Versioning](https://semver.org). See
> [Supported schemes](#supported-schemes).

```shell
npm install polyver
```

polyver is ESM-only and needs Node.js 22 or newer (or a current browser, Deno or Bun). Releases are
published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
which `npm audit signatures` verifies.

```ts
import { contains, fromNative, getScheme, normalizeVers, parseVers, stringifyVers } from 'polyver'

contains('vers:npm/>=1.2.3|<2.0.0', '1.4.0') // true
contains('vers:npm/<1.0.0|>=2.0.0', '1.5.0') // false

parseVers('vers:npm/>=1.0.0|<2.0.0')
// { type: 'npm', constraints: [{ comparator: '>=', version: '1.0.0' }, { comparator: '<', version: '2.0.0' }] }

contains('vers:deb/>=1.2.3-1|<1.2.3-4~bpo11', '1.2.3-2') // true
getScheme('rpm')?.compare('1.0^git1', '1.0.1') // < 0
getScheme('apk')?.compare('1.2_rc1', '1.2') // < 0
getScheme('maven')?.compare('1.0-SNAPSHOT', '1.0') // < 0

// Native range syntax to VERS
stringifyVers(fromNative('npm', '^1.1.7 || >= 2.0.1')) // 'vers:npm/>=1.1.7|<2.0.0|>=2.0.1'
stringifyVers(fromNative('pypi', '>=1.0,!=1.5,<2.0')) // 'vers:pypi/>=1.0|!=1.5|<2.0'
stringifyVers(fromNative('maven', '(,1.0],[1.2,)')) // 'vers:maven/<=1.0|>=1.2'
stringifyVers(fromNative('gem', '~> 2.0.8, != 2.0.9')) // 'vers:gem/>=2.0.8|!=2.0.9|<2.1'
stringifyVers(fromNative('nuget', '[1.0.0, 2.0.0)')) // 'vers:nuget/>=1.0.0|<2.0.0'
stringifyVers(fromNative('cargo', '^0.2.3, <0.2.7')) // 'vers:cargo/>=0.2.3|<0.2.7'
stringifyVers(fromNative('composer', '^1.2 || ~2.0.3'))
// 'vers:composer/>=1.2.0.0-dev|<2.0.0.0-dev|>=2.0.3.0-dev|<2.1.0.0-dev'
```

### Strict and lenient parsing

`parseVers`, `contains` and `stringifyVers` follow the VERS specification strictly: a range must be in
canonical form (constraints sorted and unique, no explicit `=`, no whitespace, canonical
percent-encoding), and anything else is an error. To accept ranges from sources that are not canonical,
normalise them first:

```ts
parseVers('vers:npm/ <2.0.0|>= 1.0.0') // throws VersError (code 'INVALID_SYNTAX')
stringifyVers(normalizeVers('vers:npm/ <2.0.0|>= 1.0.0')) // 'vers:npm/>=1.0.0|<2.0.0'
```

`normalizeVers` sorts constraints, removes duplicates and redundant constraints, and fixes case,
whitespace and percent-encoding. It still throws if the input is ambiguous, for example the same version
with two comparators.

### Errors

Every function throws a `VersError` with a `code`:

| Code                  | Meaning                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `INVALID_SYNTAX`      | Not a syntactically valid, canonical VERS string                                                          |
| `INVALID_VERSION`     | A version is not valid in the range's scheme                                                              |
| `INVALID_CONSTRAINTS` | Unsorted or duplicate versions, an invalid comparator sequence, or a native range that matches no version |
| `UNSUPPORTED_SCHEME`  | polyver does not implement the VERS type                                                                  |

### Native ranges

`fromNative(type, range)` converts a range written in an ecosystem's own syntax to canonical VERS.
Alternatives are combined by interval arithmetic, so overlapping ones are merged.

| Scheme     | Native syntax                                                           | A bare `1.2` means |
| ---------- | ----------------------------------------------------------------------- | ------------------ |
| `npm`      | `^`, `~`, x-ranges (`1.x`), hyphen ranges (`1.0 - 2.0`), `\|\|`         | `1.2.x`            |
| `pypi`     | PEP 440 specifiers: `~=`, `==1.*`, `!=`, joined with `,`; `\|\|` for OR | invalid            |
| `maven`    | Version ranges: `[1.0,2.0)`, `(,1.0],[1.2,)`, `[1.0]`                   | `>=1.2` ¹          |
| `gem`      | RubyGems requirements: `~>`, `>=`, `!=`, joined with `,`                | `=1.2`             |
| `nuget`    | Version ranges: `[1.0,2.0)`, `(,1.0]`, `[1.0]` ²                        | `>=1.2`            |
| `cargo`    | `^`, `~`, `1.*`, `>=`, joined with `,`                                  | `^1.2`             |
| `composer` | `^`, `~`, `1.2.*`, `1.0 - 2.0`; `,` or a space for AND, `\|\|` for OR   | `==1.2` ³          |
1. Maven treats a bare version as a soft requirement; polyver reads it as `>=`, as the
   [enforcer plugin](https://maven.apache.org/enforcer/enforcer-rules/versionRanges.html) does.
2. NuGet floating versions (`1.*`, `1.0.0-*`) are not supported: they pick the newest matching version
   rather than describe a set of versions.
3. Composer's own bound, `==1.2.0.0`.

#### Where the result differs from the native tool

A VERS range is a plain set of intervals, so some native rules cannot be expressed:

- **Pre-release and post-release exclusions are not applied.** npm and Cargo match a pre-release only
  when a comparator names a pre-release of the same version (Cargo's `^1.0.0` does not match
  `1.5.0-alpha`). RubyGems `~> 2.0.8` rejects `2.1.a`, and PEP 440 `>1.0` rejects `1.0.post1`. The VERS
  range contains these versions.
- **npm and Cargo upper bounds are written `<2.0.0`**, following vers-spec, although node-semver and
  Cargo also exclude the pre-releases of `2.0.0`.

#### Scheme notes

- **Cargo.** A range always contains every version the requirement matches, plus some pre-releases it
  does not. Because `^1.2`, a bare `1.2` and `>1.1` also match pre-releases of `1.2.0` such as
  `1.2.0-beta`, their lower bound is `1.2.0-0`, the smallest pre-release: `1.2` is `>=1.2.0-0|<2.0.0`.
  On a `0.0` major and minor, `^` is exact: `0.0.3` is `=0.0.3`.
- **Composer.** Ranges keep the bounds Composer itself compares against, including its `-dev` bounds:
  `^1.2` is `>=1.2.0.0-dev|<2.0.0.0-dev`, so `1.2.0-beta` matches and `2.0.0-beta` does not.
  - A `dev-` branch matches only itself. It is dropped from an OR (`dev-main || ^1.0` is `^1.0`),
    `!=dev-main` matches every version, and a constraint that matches only branches (`dev-main`,
    `>=dev-main`) throws.
  - A stability flag keeps its case, so `>=1.0@BETA` is `>=1.0.0.0-STABLE`. `version_compare` reads
    `BETA` and `STABLE` as unknown words, which compare equal, so the range is exact.

### Notes

The containment check includes the fix for single-bound ranges such as `vers:npm/>=1.0.0`
([vers-spec#54](https://github.com/package-url/vers-spec/issues/54)), and a range made only of `!=`
constraints contains every other version.

## Why

Security tooling keeps asking the same question: _is this installed version inside that affected range?_
Getting the answer right means following each ecosystem's own ordering rules: Debian's `~`, RPM's `^`,
Alpine's `_p` suffixes, PEP 440's `.post`/`.dev`, Maven's qualifiers. CycloneDX 1.7 and CSAF express those
ranges as VERS. Until now there was no JavaScript library that evaluates them across ecosystems, and none at
all for RPM or Alpine versions.

## Supported schemes

| Scheme                                                         | Status |
| -------------------------------------------------------------- | ------ |
| VERS core (parse, validate, canonicalize, contains)            | done   |
| `semver`, `intdot`, `lexicographic`, `datetime`, `all`, `none` | done   |
| `npm`, `pypi` (versions and native ranges)                     | done   |
| `deb`, `rpm`, `apk` (versions)                                 | done   |
| `maven` (versions and native ranges)                           | done   |
| `golang` (versions)                                            | done   |
| `gem` (versions and native ranges)                             | done   |
| `nuget` (versions and native ranges)                           | done   |
| `cargo` (versions and native ranges)                           | done   |
| `composer` (versions and native ranges)                        | done   |

## Correctness

Every scheme is tested against three kinds of vectors, described in [testdata/README.md](testdata/README.md):

1. the [vers-spec conformance suite](https://github.com/package-url/vers-spec/tree/main/tests);
2. permissively licensed vectors, such as
   [osv-scalibr](https://github.com/google/osv-scalibr/tree/main/semantic/testdata)'s;
3. vectors generated by running the ecosystem's own tool as an oracle.

Upstream test cases that polyver deliberately disagrees with are listed, with reasons, in
[`test/support/divergences.ts`](test/support/divergences.ts).

| Scheme                  | Matches (oracle)                                                     |
| ----------------------- | -------------------------------------------------------------------- |
| [`deb`](#deb)           | dpkg 1.22                                                            |
| [`rpm`](#rpm)           | rpm 6.0                                                              |
| [`apk`](#apk)           | apk-tools 3.0                                                        |
| [`maven`](#maven)       | `ComparableVersion` in maven-artifact 4.0.0-rc-7                     |
| [`golang`](#golang)     | `golang.org/x/mod/semver` v0.42.0                                    |
| [`gem`](#gem)           | `Gem::Version` and `Gem::Requirement` in RubyGems 4.0.20             |
| [`nuget`](#nuget)       | NuGet.Versioning 7.9.0                                               |
| [`cargo`](#cargo)       | [dtolnay/semver](https://github.com/dtolnay/semver) 1.0.28 (Cargo's) |
| [`composer`](#composer) | composer/semver 3.5.2 on PHP 8.5.12                                  |

### `deb`

- Matches dpkg 1.22, including validity (`dpkg --validate-version`).
- Surrounding whitespace, which dpkg trims, is rejected.

### `rpm`

- Matches rpm 6.0's EVR comparison for printable ASCII versions (rpm accepts any string).
- A missing epoch is 0 and a missing release sorts before any release, so `1.0 < 1.0-~1 < 1.0-1`.

### `apk`

- Matches apk-tools 3.0, including validity (`apk version -c`), except that numbers do not wrap at 2^64.
- apk-tools 2.x (Alpine 3.22 and older) orders some versions differently, notably components with
  leading zeros such as `0.002`.

### `maven`

- Matches `ComparableVersion` in maven-artifact 4.0.0-rc-7. Compared with Maven 3.9, it changes how a
  qualifier followed by a number is ordered ([MNG-7714](https://issues.apache.org/jira/browse/MNG-7714))
  and fixes cycles in the order ([MNG-6568](https://issues.apache.org/jira/browse/MNG-6568)).
- A valid version is printable ASCII without spaces and at most 256 characters; Maven itself accepts
  any string.
- Maven 3.9.16 orders 110 of the 7,883 oracle pairs differently, none of them between two versions
  sampled from Maven Central. For example, `1.0-1` equals `1-1` in Maven 3.9 but is greater in Maven 4,
  and `1.0.0-beta.6` is greater than `1.0.0-beta11` in Maven 3.9 but smaller in Maven 4.

### `golang`

- Matches `golang.org/x/mod/semver` v0.42.0, including the shorthands `v1` and `v1.2` (equal to
  `v1.0.0` and `v1.2.0`).
- The `v` is optional, because advisories often omit it, so `1.2.3` equals `v1.2.3`.
- Pseudo-versions order by timestamp and `+incompatible` is ignored, as in Go.
- Go has no native range syntax, so there is no `fromNative`.

### `gem`

- Matches `Gem::Version` in RubyGems 4.0.20 (bundled with Ruby 4.0.9; the code is unchanged in 4.0.23).
- Surrounding whitespace and the empty string, which RubyGems reads as `0`, are rejected.
- Any letter makes a pre-release, `-` reads as `.pre.`, letters compare case-sensitively
  (`1.A < 1.a`), and zeros before the first letter are ignored (`1.0.a == 1.a`).
- `fromNative` is checked against `Gem::Requirement#satisfied_by?` on 3,663 requirement and version
  pairs. The only differences are the `~>` pre-releases described under
  [Native ranges](#native-ranges).

### `nuget`

- Matches `NuGetVersion.TryParse` and `VersionComparer.Default` in NuGet.Versioning 7.9.0.
- Whitespace, which NuGet trims and ignores around numbers (`1 . 0`), is rejected.
- Versions have up to four numbers, each at most 2147483647; missing numbers are 0 (`1.0 == 1.0.0.0`).
- Pre-release labels compare ignoring case, and a label is a number if .NET's `int.TryParse` reads it
  (`1.0--1 < 1.0-0`). Build metadata is ignored.
- `fromNative` is checked against `Satisfies` and `VersionRange.TryParse` without floating versions
  (the same as `Parse` for ranges that do not float) on 84 ranges and 3,960 range and version pairs.
  The only differences are three ranges that NuGet accepts and polyver rejects: `(1.0,1.0)`, which
  matches no version, and `1 . 0` and `[1 .0,2.0)`, which have whitespace inside a version.

### `cargo`

- Matches `Version::parse` and `VersionReq::parse` in dtolnay/semver 1.0.28, the crate Cargo uses:
  SemVer 2.0.0 with major, minor and patch numbers no larger than u64::MAX, and only U+0020 spaces in a
  requirement.
- Build metadata is ignored when comparing, as in SemVer precedence and `VersionReq::matches`, so
  `vers:cargo/1.0.0` contains `1.0.0+build`. The crate's `Ord` for `Version` instead breaks ties by
  build metadata (`1.2.3+23 < 1.2.3+42`), which polyver does not follow.
- `fromNative` is checked against `VersionReq::matches` on 13,764 requirement and version pairs. Every
  release version agrees, every version that Cargo matches is in the VERS range, and the only
  differences are the pre-releases described under [Native ranges](#native-ranges).

### `composer`

- Matches composer/semver 3.5.2 on PHP 8.5.12. A version is valid if `VersionParser::normalize`
  accepts it, and two versions compare as PHP's `version_compare` compares their normalized forms
  (`Semver::sort`).
- Ordering:
  - versions are padded to four numbers (`1.2 == 1.2.0.0`);
  - `dev < alpha < beta < RC < (release) < patch`;
  - branch aliases sort after their branch's releases (`1.x-dev` is `1.9999999.9999999.9999999-dev`);
  - numbers above 2^63 - 1 are equal, as in PHP.
- Rejected versions:
  - `dev-` branches (`dev-main`, and `master`, which Composer reads as `dev-master`), because Composer
    only matches a branch to itself;
  - versions with whitespace or NUL (`1.0\0`), which Composer trims or reads as an alias
    (`1.0 as 2.0`).
- `fromNative` is checked against `Semver::satisfies` on 22,800 constraint and version pairs. It
  rejects a line break inside a constraint (Composer ignores the rest of the line), and it throws where
  Composer's bound is not a version:
  - `>=1.0-p1@beta`, whose bound is `1.0.0.0-patch1-beta`;
  - bounds above PHP_INT_MAX, which PHP turns into floats: `^9223372036854775807`,
    `^0.9223372036854775807`, `~9223372036854775807`, `1 - 9223372036854775807` and
    `^99999999999999999999`.

## License

[MIT](LICENSE)
