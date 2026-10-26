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
])

function key(path: string, input: unknown): string {
  return `${path} ${JSON.stringify(input)}`
}

export function divergenceCount(): number {
  return DIVERGENCES.size
}

export function divergence(path: string, input: unknown): Divergence | undefined {
  return DIVERGENCES.get(key(path, input))
}
