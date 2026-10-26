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
])

function key(path: string, input: unknown): string {
  return `${path} ${JSON.stringify(input)}`
}

/** The number of divergences for vendored files whose path starts with `prefix`. */
export function divergenceCount(prefix: string): number {
  return [...DIVERGENCES.keys()].filter((k) => k.startsWith(prefix)).length
}

export function divergence(path: string, input: unknown): Divergence | undefined {
  return DIVERGENCES.get(key(path, input))
}
