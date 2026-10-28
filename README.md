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

`fromNative` converts npm ranges (`^`, `~`, x-ranges, hyphen ranges, `||`), PEP 440 specifiers
(`~=`, `==1.*`, `!=`, `,` and `||`), Maven version ranges (`[1.0,2.0)`, `(,1.0],[1.2,)`, `[1.0]`),
RubyGems requirements (`~>`, `>=`, `!=`, joined with `,`) and Composer constraints (`^`, `~`, `1.2.*`,
`1.0 - 2.0`, `,` or space for AND, `||` for OR) to canonical VERS by interval arithmetic, so
overlapping alternatives are merged.
A bare Maven version such as `1.0`, which Maven treats as a soft requirement, means `>=1.0`, as in the
[enforcer plugin's range documentation](https://maven.apache.org/enforcer/enforcer-rules/versionRanges.html).
A bare RubyGems version means `=`, as in `Gem::Requirement`. Two conventions follow vers-spec rather
than the native tool: npm upper bounds are written `<2.0.0` (node-semver uses `<2.0.0-0`), and the
native rules that exclude some pre-releases (npm, and RubyGems `~>`, which rejects `2.1.a` for
`~> 2.0.8`) or post-releases (PEP 440 `>V`) are not applied, because a VERS range is a plain set of
intervals.
Composer constraints keep the bounds Composer itself compares against, including its `-dev` bounds:
`^1.2` is `>=1.2.0.0-dev|<2.0.0.0-dev`, so `1.2.0-beta` matches and `2.0.0-beta` does not. A constraint
on a `dev-` branch (`dev-main`, `1.0 || dev-main`) throws, because a branch has no place in the order.

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
| `composer` (versions and native ranges)                        | done    |
| `nuget`, `cargo`                                               | planned |

## Correctness

Every scheme is tested against the
[vers-spec conformance suite](https://github.com/package-url/vers-spec/tree/main/tests), permissively
licensed vectors (such as [osv-scalibr](https://github.com/google/osv-scalibr/tree/main/semantic/testdata)),
and vectors generated by running the ecosystem's own tool (`dpkg`, `rpm`, `apk`, Maven's
`ComparableVersion`, Go's `golang.org/x/mod`, RubyGems, Composer's composer/semver) as an oracle. See
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
- `composer` matches composer/semver 3.5.2 on PHP 8.5.12: a version is valid if
  `VersionParser::normalize` accepts it, and two versions compare as PHP's `version_compare` compares
  their normalized forms (`Semver::sort`). Versions are padded to four numbers (`1.2 == 1.2.0.0`),
  `dev < alpha < beta < RC < (release) < patch`, branch aliases sort after their branch's releases
  (`1.x-dev` is `1.9999999.9999999.9999999-dev`), and numbers above 2^63 - 1 are equal, as in PHP.
  `dev-` branches (`dev-main`, and `master`, which Composer reads as `dev-master`) are rejected, because
  Composer only matches a branch to itself, and so are versions with whitespace, which Composer trims
  or reads as an alias (`1.0 as 2.0`). `fromNative` is checked against `Semver::satisfies` on 18,000
  constraint and version pairs. It rejects a line break inside a constraint (Composer ignores the rest
  of the line) and throws on `>=1.0-p1@beta`, whose bound `1.0.0.0-patch1-beta` is not a version.

Upstream test cases that polyver deliberately disagrees with are listed, with reasons, in
[`test/support/divergences.ts`](test/support/divergences.ts).

## License

[MIT](LICENSE)
