# polyver

Compare package versions and evaluate [VERS](https://github.com/package-url/vers-spec) version ranges
across ecosystems, in JavaScript and TypeScript. Zero dependencies; runs in Node.js, browsers, Deno and Bun.

> **Status:** early development; the API may change before 1.0. See [Supported schemes](#supported-schemes).

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

`fromNative` converts npm ranges (`^`, `~`, x-ranges, hyphen ranges, `||`), PEP 440 specifiers
(`~=`, `==1.*`, `!=`, `,` and `||`), Maven version ranges (`[1.0,2.0)`, `(,1.0],[1.2,)`, `[1.0]`),
RubyGems requirements (`~>`, `>=`, `!=`, joined with `,`), NuGet version ranges (`[1.0,2.0)`,
`(,1.0]`, `[1.0]`) and Cargo requirements (`^`, `~`, `1.*`, `>=`, joined with `,`) to canonical VERS
by interval arithmetic, so overlapping alternatives are merged.
A bare Maven version such as `1.0`, which Maven treats as a soft requirement, means `>=1.0`, as in the
[enforcer plugin's range documentation](https://maven.apache.org/enforcer/enforcer-rules/versionRanges.html).
A bare RubyGems version means `=`, as in `Gem::Requirement`, and a bare NuGet version means `>=`, as in
`VersionRange.TryParse` without floating versions (the same as `Parse` for ranges that do not float).
NuGet floating versions (`1.*`, `1.0.0-*`) are not supported, because they pick
the newest matching version instead of describing a set of versions. A bare Cargo version means `^`, so
`0.0.3` is `=0.0.3` and `1.2` is `>=1.2.0-0|<2.0.0`: Cargo's `^1.2` and `>1.1` also match pre-releases
of `1.2.0` such as `1.2.0-beta`, so their lower bound is `1.2.0-0`, the smallest pre-release. Two
conventions follow vers-spec rather than the native tool: npm and Cargo upper bounds are written
`<2.0.0` (node-semver and Cargo exclude the pre-releases of `2.0.0`), and the native rules that exclude
some pre-releases (npm; Cargo, where `^1.0.0` does not match `1.5.0-alpha`; and RubyGems `~>`, which
rejects `2.1.a` for `~> 2.0.8`) or post-releases (PEP 440 `>V`) are not applied, because a VERS range
is a plain set of intervals. A Cargo range therefore contains every version that the requirement
matches, and some pre-releases that it does not.

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

| Scheme                                                         | Status  |
| -------------------------------------------------------------- | ------- |
| VERS core (parse, validate, canonicalize, contains)            | done    |
| `semver`, `intdot`, `lexicographic`, `datetime`, `all`, `none` | done    |
| `npm`, `pypi` (versions and native ranges)                     | done    |
| `deb`, `rpm`, `apk` (versions)                                 | done    |
| `maven` (versions and native ranges)                           | done    |
| `golang` (versions)                                            | done    |
| `gem` (versions and native ranges)                             | done    |
| `nuget` (versions and native ranges)                           | done    |
| `cargo` (versions and native ranges)                           | done    |
| `composer`                                                     | planned |

## Correctness

Every scheme is tested against the
[vers-spec conformance suite](https://github.com/package-url/vers-spec/tree/main/tests), permissively
licensed vectors (such as [osv-scalibr](https://github.com/google/osv-scalibr/tree/main/semantic/testdata)),
and vectors generated by running the ecosystem's own tool (`dpkg`, `rpm`, `apk`, Maven's
`ComparableVersion`, Go's `golang.org/x/mod`, RubyGems, NuGet.Versioning, Cargo's `semver` crate) as an
oracle. See
[testdata/README.md](testdata/README.md).

- `deb` matches dpkg 1.22, including validity (`dpkg --validate-version`), except that surrounding
  whitespace, which dpkg trims, is rejected.
- `rpm` matches rpm 6.0's EVR comparison for printable ASCII versions (rpm accepts any string). A missing
  epoch is 0 and a missing release sorts before any release, so `1.0 < 1.0-~1 < 1.0-1`.
- `apk` matches apk-tools 3.0, including validity (`apk version -c`), except that numbers do not wrap at
  2^64. apk-tools 2.x (Alpine 3.22 and older) orders some versions differently, notably components with
  leading zeros such as `0.002`.
- `maven` matches `ComparableVersion` in maven-artifact 4.0.0-rc-7, which changes how Maven 3.9 orders
  a qualifier followed by a number ([MNG-7714](https://issues.apache.org/jira/browse/MNG-7714)) and
  fixes cycles in its order ([MNG-6568](https://issues.apache.org/jira/browse/MNG-6568)). A valid version is printable
  ASCII without spaces and at most 256 characters; Maven itself accepts any string. Maven 3.9.16 orders
  110 of the 7,883 oracle pairs differently, none of them between two versions sampled from Maven
  Central: for example, `1.0-1` equals `1-1` in Maven 3.9 but is greater in Maven 4, and
  `1.0.0-beta.6` is greater than `1.0.0-beta11` in Maven 3.9 but smaller in Maven 4.
- `golang` matches `golang.org/x/mod/semver` v0.42.0, including the shorthands `v1` and `v1.2` (equal to
  `v1.0.0` and `v1.2.0`). The `v` is optional, because advisories often omit it, so `1.2.3` equals
  `v1.2.3`. Pseudo-versions order by timestamp and `+incompatible` is ignored, as in Go. Go has no
  native range syntax, so there is no `fromNative`.
- `gem` matches `Gem::Version` in RubyGems 4.0.20 (bundled with Ruby 4.0.9; the code is unchanged in
  4.0.23), except that surrounding whitespace and the empty string, which RubyGems reads as `0`, are
  rejected. Any letter makes a pre-release, `-` reads as `.pre.`, letters compare case-sensitively
  (`1.A < 1.a`), and zeros before the first letter are ignored (`1.0.a == 1.a`). `fromNative` is
  checked against `Gem::Requirement#satisfied_by?` on 3,663 requirement and version pairs; the only
  differences are the `~>` pre-releases described under [Native ranges](#native-ranges).
- `nuget` matches `NuGetVersion.TryParse` and `VersionComparer.Default` in NuGet.Versioning 7.9.0,
  except that whitespace, which NuGet trims and ignores around numbers (`1 . 0`), is rejected. Versions
  have up to four numbers, each at most 2147483647; missing numbers are 0 (`1.0 == 1.0.0.0`).
  Pre-release labels compare ignoring case, and a label is a number if .NET's `int.TryParse` reads it
  (`1.0--1 < 1.0-0`). Build metadata is ignored. `fromNative` is checked against `VersionRange.TryParse`
  without floating versions (the same as `Parse` for ranges that do not float) and `Satisfies` on 84
  ranges and 3,960 range and version pairs. The only differences are three ranges that NuGet accepts
  and polyver rejects: `(1.0,1.0)`, which matches no version, and `1 . 0` and `[1 .0,2.0)`, which
  have whitespace inside a version.
- `cargo` matches `Version::parse` and `VersionReq::parse` in [dtolnay/semver](https://github.com/dtolnay/semver)
  1.0.28, the crate Cargo uses: SemVer 2.0.0 with major, minor and patch numbers no larger than u64::MAX,
  and only U+0020 spaces in a requirement. Build metadata is ignored when comparing, as in SemVer
  precedence and `VersionReq::matches`, so `vers:cargo/1.0.0` contains `1.0.0+build`; the crate's `Ord`
  for `Version` instead breaks ties by build metadata (`1.2.3+23 < 1.2.3+42`), which polyver does not
  follow. `fromNative` is checked against `VersionReq::matches` on 13,764 requirement and version
  pairs: every release version agrees, every version that Cargo matches is in the VERS range, and the
  only differences are the pre-releases described under [Native ranges](#native-ranges).

Upstream test cases that polyver deliberately disagrees with are listed, with reasons, in
[`test/support/divergences.ts`](test/support/divergences.ts).

## License

[MIT](LICENSE)
