/**
 * Upstream test cases where polyver deliberately gives a different result, each with the reason.
 *
 * The cases still run, asserting polyver's own result, so that a behaviour change is noticed. Keys are
 * the vendored file (relative to testdata/) and the case's input; upstream descriptions are not unique.
 */

interface Divergence {
  readonly reason: string
  /** Fields that replace the upstream expectation. */
  readonly override: { readonly expected_failure?: boolean; readonly expected_output?: unknown }
}

const PYPI_VALIDATE = 'vers-spec/tests/pypi_range_validate_test.json'
const PYPI_INVALID =
  'Clause 5.4: the expected output has a duplicate version, an equality followed by "<", or ' +
  'consecutive ">" comparators, so it is not a valid VERS.'
const NPM_FROM_NATIVE = 'vers-spec/tests/npm_range_from_native_test.json'
const OVERLAP =
  'Upstream keeps overlapping || alternatives as-is, which gives duplicate versions or repeated "<"/">" ' +
  'and breaks Clause 5.4; polyver merges the intervals.'

const MAVEN_CMP = 'vers-spec/tests/maven_version_cmp_test.json'
const MAVEN_DOT =
  'Maven 3.9 and later read a qualifier after "." as one after "-" (MNG-7644), so 2.0.a and 2.0.0.a ' +
  'are both 2-a, which sorts before 2-1. maven-artifact 3.9.16 and 4.0.0-rc-7 give this order.'

const DIVERGENCES: ReadonlyMap<string, Divergence> = new Map([
  [
    key('vers-spec/tests/vers_canonical_parse_test.json', 'vers:npm/1.0%252F0'),
    {
      reason:
        'The decoded version "1.0%2F0" is not a valid npm (SemVer) version. npm is a registered type, ' +
        'and Clause 5.3.2 makes a VERS invalid if it breaks the rules of a registered type.',
      override: { expected_failure: true, expected_output: null },
    },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '<= 1.0', scheme: 'npm' }),
    {
      reason: '<=1.0 is an x-range: node-semver desugars it to <1.1.0-0, so 1.0.5 is included.',
      override: { expected_output: 'vers:npm/<1.1.0' },
    },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '>= 0.2.0 <= 0.9.6 || ~0.8.0-pre', scheme: 'npm' }),
    { reason: OVERLAP, override: { expected_output: 'vers:npm/>=0.2.0|<=0.9.6' } },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '>= 2.2.x', scheme: 'npm' }),
    {
      reason: '>=2.2.x has no upper bound: node-semver desugars it to >=2.2.0.',
      override: { expected_output: 'vers:npm/>=2.2.0' },
    },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '2.0.x || 2.1.x', scheme: 'npm' }),
    { reason: OVERLAP, override: { expected_output: 'vers:npm/>=2.0.0|<2.2.0' } },
  ],
  [
    key(NPM_FROM_NATIVE, {
      native_range: '^2.0.18 || ^3.0.16 || ^3.1.6 || ^4.0.8 || ^5.0.0-beta.5',
      scheme: 'npm',
    }),
    {
      reason: OVERLAP,
      override: { expected_output: 'vers:npm/>=2.0.18|<3.0.0|>=3.0.16|<4.0.0|>=4.0.8|<6.0.0' },
    },
  ],
  [
    key(NPM_FROM_NATIVE, {
      native_range: '<2.0.18 || <3.0.16 || <3.1.6 || <4.0.8 || <5.0.0-beta.5',
      scheme: 'npm',
    }),
    { reason: OVERLAP, override: { expected_output: 'vers:npm/<5.0.0-beta.5' } },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '>= 1.x', scheme: 'npm' }),
    {
      reason: '>=1.x has no upper bound: node-semver desugars it to >=1.0.0.',
      override: { expected_output: 'vers:npm/>=1.0.0' },
    },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '<2.0.1 || <1.1.7', scheme: 'npm' }),
    { reason: OVERLAP, override: { expected_output: 'vers:npm/<2.0.1' } },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '>= 5.2.1 <= 6.0.0 || >=6.0.0 <= 6.0.2', scheme: 'npm' }),
    { reason: OVERLAP, override: { expected_output: 'vers:npm/>=5.2.1|<=6.0.2' } },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '2.1 || 2.6', scheme: 'npm' }),
    {
      reason:
        '2.1 is an x-range (2.1.x), not the version 2.1.0: node-semver desugars it to >=2.1.0 <2.2.0-0.',
      override: { expected_output: 'vers:npm/>=2.1.0|<2.2.0|>=2.6.0|<2.7.0' },
    },
  ],
  [
    key(NPM_FROM_NATIVE, { native_range: '<=2.1 >=1.1', scheme: 'npm' }),
    {
      reason: '<=2.1 is an x-range: node-semver desugars it to <2.2.0-0.',
      override: { expected_output: 'vers:npm/>=1.1.0|<2.2.0' },
    },
  ],
  [
    key(PYPI_VALIDATE, 'vers:pypi/>0.0.0|>=0.0.1|0.0.2|<0.0.3|0.0.4|<0.0.5|>=0.0.6'),
    { reason: PYPI_INVALID, override: { expected_failure: true, expected_output: null } },
  ],
  [
    key(
      PYPI_VALIDATE,
      'vers:pypi/>0.0.0|>=0.0.1|>=0.0.1|0.0.2|0.0.3|0.0.4|<0.0.5|<=0.0.6|!=0.7|8.0|>12|<15.3',
    ),
    { reason: PYPI_INVALID, override: { expected_failure: true, expected_output: null } },
  ],
  [
    key(PYPI_VALIDATE, 'vers:pypi/>0.0.0|>=0.0.1|0.0.2|0.0.3|0.0.4|<0.0.5|>=0.0.6|!=0.8'),
    { reason: PYPI_INVALID, override: { expected_failure: true, expected_output: null } },
  ],
  [
    key(PYPI_VALIDATE, 'vers:pypi/0.0.2|0.0.6|>=0.0.0|0.0.1|0.0.4|0.0.5|0.0.3'),
    {
      reason:
        'normalizeVers also removes redundant constraints (how-to-parse.md, "Simplifying ' +
        'constraints"): 0.0.1 to 0.0.6 are already in >=0.0.0.',
      override: { expected_output: 'vers:pypi/>=0.0.0' },
    },
  ],
  [
    key('vers-spec/types/npm-definition.json', '>= 2.2.x'),
    {
      reason: '>=2.2.x has no upper bound: node-semver desugars it to >=2.2.0.',
      override: { expected_output: 'vers:npm/>=2.2.0' },
    },
  ],
  [
    key('vers-spec/types/npm-definition.json', '2.0.x || 2.1.x'),
    { reason: OVERLAP, override: { expected_output: 'vers:npm/>=2.0.0|<2.2.0' } },
  ],
  [
    key(MAVEN_CMP, { input_scheme: 'maven', versions: ['2-1', '2.0.a'] }),
    { reason: MAVEN_DOT, override: { expected_output: ['2.0.a', '2-1'] } },
  ],
  [
    key(MAVEN_CMP, { input_scheme: 'maven', versions: ['2-1', '2.0.0.a'] }),
    { reason: MAVEN_DOT, override: { expected_output: ['2.0.0.a', '2-1'] } },
  ],
  [
    key(MAVEN_CMP, { input_scheme: 'maven', versions: ['2.0.0.a', '2.0.a'] }),
    // The two versions are equal, so a stable sort keeps the input order.
    { reason: MAVEN_DOT, override: { expected_output: ['2.0.0.a', '2.0.a'] } },
  ],
])

/** A pair of an `a <op> b` file (see loadComparisonPairs) where polyver gives another order. */
interface PairDivergence {
  readonly reason: string
  readonly op: '<' | '=' | '>'
}

const MAVEN_PAIRS = 'osv-scalibr/maven-versions.txt'
const MAVEN_GENERATED = 'osv-scalibr/maven-versions-generated.txt'
const MAVEN_39 =
  "osv-scalibr's Maven vectors predate Maven 3.9 (the generated file comes from maven-artifact " +
  '3.8.6); maven-artifact 3.9.16 and 4.0.0-rc-7 both give this order.'
const MAVEN_4 =
  'Maven 4 changed this order (polyver follows maven-artifact 4.0.0-rc-7); maven-artifact 3.9.16 ' +
  'gives the upstream order.'

function pair(
  path: string,
  a: string,
  op: PairDivergence['op'],
  b: string,
  reason: string,
): [string, PairDivergence] {
  return [key(path, [a, b]), { reason, op }]
}

const PAIR_DIVERGENCES: ReadonlyMap<string, PairDivergence> = new Map([
  pair(MAVEN_PAIRS, '1-1.foo-bar-1-baz-0.1', '>', '1-1.foo-bar1baz-.1', MAVEN_4),
  pair(MAVEN_PAIRS, '1-1', '>', '1-ga-1', MAVEN_39),
  pair(MAVEN_GENERATED, '3.2.0rc2', '>', '3.2.0-rc.1', MAVEN_4),
  pair(MAVEN_GENERATED, '1.0.0-RC16', '>', '1.0.0.RC8-beta', MAVEN_39),
  pair(MAVEN_GENERATED, '1.0.0-gradle-rework-beta3', '>', '1.0.0.RC7-3', MAVEN_39),
  pair(MAVEN_GENERATED, '2.9.0-1', '>', '2.9.0.RC1', MAVEN_39),
  pair(MAVEN_GENERATED, '6.1.12.rc5', '>', '6.1.12rc1', MAVEN_39),
  pair(MAVEN_GENERATED, '1.0.0-beta11', '>', '1.0.0-beta.6', MAVEN_4),
  pair(MAVEN_GENERATED, '1.1.31.sec10', '>', '1.1.31_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.1.34.sec10', '>', '1.1.34_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.1.46.sec10', '>', '1.1.46_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.8.sec10_noneautotype', '>', '1.2.8_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.31.sec10', '>', '1.2.31_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.48.sec10', '>', '1.2.48_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.50.sec10', '>', '1.2.50_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.54.sec10', '>', '1.2.54_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.57.sec10', '>', '1.2.57_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.60.sec10', '>', '1.2.60_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.2.67.sec10', '>', '1.2.67_noneautotype', MAVEN_39),
  pair(MAVEN_GENERATED, '1.0.0rc0', '>', '1.0.beta8', MAVEN_39),
  pair(MAVEN_GENERATED, '1.5.9.RC1', '>', '1.5.9-RC0', MAVEN_39),
  pair(MAVEN_GENERATED, '3.5.0-CR-2', '>', '3.5.0.Beta-1', MAVEN_4),
  pair(MAVEN_GENERATED, '1.1.0-01-glassfish', '>', '1.1.0.Beta1', MAVEN_39),
  pair(MAVEN_GENERATED, 'v3.7.0rc2', '>', 'v3.7.0-rc.3', MAVEN_4),
])

/** A row of testdata/oracle/gem-requirements.txt where polyver gives the opposite verdict. */
const GEM_REQUIREMENTS = 'oracle/gem-requirements.txt'
const GEM_TILDE =
  'RubyGems also rejects pre-releases of the ~> upper bound (v.release < r.bump), which no VERS ' +
  'interval can express, since there is no smallest pre-release (2.1.A.A < 2.1.A). As in vers-spec, ' +
  '~>2.0.8 is >=2.0.8|<2.1, which contains 2.1.a.'

const REQUIREMENT_DIVERGENCES: ReadonlyMap<string, string> = new Map(
  [
    ['2.0.a', '~> 1'],
    ['2.0.a', '~> 1.2'],
    ['1.5.a', '~> 1.4.4'],
    ['1.5.0.rc1', '~> 1.4.4'],
    ['2.1.a', '~> 2.0.8'],
    ['2.1.0.a', '~> 2.0.8'],
    ['2.1.A', '~> 2.0.8'],
    ['2.1.A.A', '~> 2.0.8'],
    ['3.0.rc2', '~> 2.0'],
    ['1.1.pre', '~> 1.0.0'],
    ['1.1.pre', '~> 1.0.0.a'],
    ['2.0.a', '~> 1.0a1'],
    ['2.0.a', '~>1.1'],
    ['2.0.a', '~> 1.4, >= 1.4.4'],
    ['3.0.rc2', '~> 2.0, != 2.0.9'],
  ].map(([version, requirement]) => [key(GEM_REQUIREMENTS, [version, requirement]), GEM_TILDE]),
)

// Cargo's divergences are rules rather than rows: they apply to every build-metadata tie among the
// oracle pairs and to hundreds of requirement rows (every pre-release case against almost every
// requirement). The cargo tests check that nothing outside these rules differs.

/** A pair of Cargo versions that differ only in build metadata. */
const CARGO_BUILD =
  "semver's Ord for Version breaks ties by build metadata (1.2.3+23 < 1.2.3+42), but SemVer " +
  'precedence, Version::cmp_precedence and VersionReq::matches ignore it, and so does polyver: ' +
  'vers:cargo/=1.0.0 contains 1.0.0+build, as =1.0.0 matches it.'

const CARGO_PAIRS = ['oracle/cargo.txt', 'dtolnay-semver/test_version.json']

/** The reason polyver orders two Cargo versions as equal where semver's Ord does not, if it does. */
export function cargoBuildDivergence(path: string, a: string, b: string): string | undefined {
  const release = (v: string): string => v.split('+')[0] as string
  return CARGO_PAIRS.includes(path) && a !== b && release(a) === release(b)
    ? CARGO_BUILD
    : undefined
}

/** A pre-release version that VersionReq::matches rejects but polyver's VERS range contains. */
const CARGO_PRERELEASE =
  'VersionReq::matches only lets a pre-release match if a comparator names a pre-release of the ' +
  "same major.minor.patch (eval.rs, pre_is_compatible), and a bound such as <1.0 or ^1.2.3's upper " +
  'bound excludes the pre-releases of 1.0.0 and 2.0.0 (<1.0.0-0). As for npm, the VERS range is a ' +
  'plain set of intervals written with bounds such as <2.0.0, so it contains these pre-releases.'

const CARGO_REQUIREMENTS = ['oracle/cargo-requirements.txt', 'dtolnay-semver/test_version_req.json']

/** The reason polyver contains a pre-release that Cargo's requirement rejects, if that is the case. */
export function cargoPrereleaseDivergence(
  path: string,
  version: string,
  cargoMatches: boolean,
  polyverContains: boolean,
): string | undefined {
  const prerelease = (version.split('+')[0] as string).includes('-')
  return CARGO_REQUIREMENTS.includes(path) && prerelease && !cargoMatches && polyverContains
    ? CARGO_PRERELEASE
    : undefined
}

function key(path: string, input: unknown): string {
  return `${path} ${JSON.stringify(input)}`
}

/** The number of divergences for vendored files whose path starts with `prefix`. */
export function divergenceCount(prefix: string): number {
  return [
    ...DIVERGENCES.keys(),
    ...PAIR_DIVERGENCES.keys(),
    ...REQUIREMENT_DIVERGENCES.keys(),
  ].filter((k) => k.startsWith(prefix)).length
}

export function divergence(path: string, input: unknown): Divergence | undefined {
  return DIVERGENCES.get(key(path, input))
}

export function pairDivergence(path: string, a: string, b: string): PairDivergence | undefined {
  const build = cargoBuildDivergence(path, a, b)
  if (build) return { reason: build, op: '=' }
  return PAIR_DIVERGENCES.get(key(path, [a, b]))
}

/** The reason polyver gives the opposite verdict for a row of an oracle requirements file, if it does. */
export function requirementDivergence(
  path: string,
  version: string,
  requirement: string,
): string | undefined {
  return REQUIREMENT_DIVERGENCES.get(key(path, [version, requirement]))
}
