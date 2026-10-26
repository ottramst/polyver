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

// Native range syntax to VERS
stringifyVers(fromNative('npm', '^1.1.7 || >= 2.0.1')) // 'vers:npm/>=1.1.7|<2.0.0|>=2.0.1'
stringifyVers(fromNative('pypi', '>=1.0,!=1.5,<2.0')) // 'vers:pypi/>=1.0|!=1.5|<2.0'
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

`fromNative` converts npm ranges (`^`, `~`, x-ranges, hyphen ranges, `||`) and PEP 440 specifiers
(`~=`, `==1.*`, `!=`, `,` and `||`) to canonical VERS by interval arithmetic, so overlapping alternatives
are merged. Two conventions follow vers-spec rather than the native tool: npm upper bounds are written
`<2.0.0` (node-semver uses `<2.0.0-0`), and the native rules that exclude some pre-releases (npm) or
post-releases (PEP 440 `>V`) are not applied, because a VERS range is a plain set of intervals.

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
| `maven`, `golang`, `gem`, `nuget`, `cargo`, `composer`         | planned |

## Correctness

Every scheme is tested against the
[vers-spec conformance suite](https://github.com/package-url/vers-spec/tree/main/tests), permissively
licensed vectors (such as [osv-scalibr](https://github.com/google/osv-scalibr/tree/main/semantic/testdata)),
and vectors generated by running the ecosystem's own tool (`dpkg`, `rpm`, `apk`) as an oracle. See
[testdata/README.md](testdata/README.md).

- `deb` matches dpkg 1.22, including validity (`dpkg --validate-version`), except that surrounding
  whitespace, which dpkg trims, is rejected.
- `rpm` matches rpm 6.0's EVR comparison for printable ASCII versions (rpm accepts any string). A missing
  epoch is 0 and a missing release sorts before any release, so `1.0 < 1.0-~1 < 1.0-1`.
- `apk` matches apk-tools 3.0, including validity (`apk version -c`), except that numbers do not wrap at
  2^64. apk-tools 2.x (Alpine 3.22 and older) orders some versions differently, notably components with
  leading zeros such as `0.002`.

Upstream test cases that polyver deliberately disagrees with are listed, with reasons, in
[`test/support/divergences.ts`](test/support/divergences.ts).

## License

[MIT](LICENSE)
