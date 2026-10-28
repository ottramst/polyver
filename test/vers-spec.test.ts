// Conformance with the package-url/vers-spec test suite, vendored under testdata/vers-spec/tests.
import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  contains,
  fromNative,
  getScheme,
  normalizeVers,
  parseVers,
  stringifyVers,
  VersError,
} from '../src/index.ts'
import { divergenceCount } from './support/divergences.ts'
import { loadVersTests, type VersTest } from './support/vectors.ts'

const DIR = 'vers-spec/tests/'
const files = readdirSync(new URL(`../testdata/${DIR}`, import.meta.url)).filter((f) =>
  f.endsWith('.json'),
)

function typeOf(vers: string): string {
  return vers.slice(vers.indexOf(':') + 1, vers.indexOf('/'))
}

/** The VERS type a case needs, so that cases for unimplemented types can be listed as todo. */
function requiredType(t: VersTest): string | undefined {
  switch (t.test_type) {
    case 'parse':
    case 'validate':
      return typeOf(t.input)
    case 'containment':
      return typeOf(t.input.vers)
    case 'comparison':
    case 'equality':
      return t.input.input_type ?? t.input.input_scheme
    case 'from_native':
      return getScheme(t.input.scheme)?.fromNative ? t.input.scheme : undefined
  }
}

function expectVersError(fn: () => unknown): void {
  expect(fn).toThrow(VersError)
}

function run(t: VersTest): void {
  switch (t.test_type) {
    case 'parse': {
      if (t.expected_failure) {
        expectVersError(() => parseVers(t.input))
        return
      }
      const expected = t.expected_output as NonNullable<typeof t.expected_output>
      expect(parseVers(t.input)).toEqual({
        type: expected.type,
        constraints: expected.constraints.map(([comparator, version]) =>
          version === undefined ? { comparator } : { comparator, version },
        ),
      })
      return
    }
    case 'validate': {
      // Required cases have canonical input; recommended ones show how to normalise input first.
      const parse = t.test_group === 'required' ? parseVers : normalizeVers
      if (t.expected_failure) {
        expectVersError(() => parse(t.input))
        return
      }
      expect(stringifyVers(parse(t.input))).toBe(t.expected_output)
      return
    }
    case 'containment': {
      const range =
        t.test_group === 'required' ? parseVers(t.input.vers) : normalizeVers(t.input.vers)
      expect(contains(range, t.input.version)).toBe(t.expected_output)
      return
    }
    case 'comparison': {
      const scheme = getScheme(requiredType(t) as string)
      const sorted = [...t.input.versions].sort((a, b) => scheme?.compare(a, b) ?? 0)
      expect(sorted).toEqual(t.expected_output)
      return
    }
    case 'equality': {
      const scheme = getScheme(requiredType(t) as string)
      const [a, b] = t.input.versions as [string, string]
      expect(scheme?.compare(a, b) === 0).toBe(t.expected_output)
      return
    }
    case 'from_native': {
      const { scheme, native_range } = t.input
      if (t.expected_failure) {
        expectVersError(() => fromNative(scheme, native_range))
        return
      }
      expect(stringifyVers(fromNative(scheme, native_range))).toBe(t.expected_output)
      return
    }
  }
}

// Upstream files repeat some inputs, so count the distinct divergent inputs.
const divergent = new Set<string>()

for (const file of files) {
  describe(file, () => {
    for (const [i, t] of loadVersTests(DIR + file).entries()) {
      const name = `#${i} ${t.test_group} ${t.test_type}: ${JSON.stringify(t.input)}`
      const type = requiredType(t)
      if (type === undefined || !getScheme(type)) {
        it.todo(name)
        continue
      }
      if (t.divergence) divergent.add(`${file} ${JSON.stringify(t.input)}`)
      it(t.divergence ? `${name} (diverges: ${t.divergence})` : name, () => run(t))
    }
  })
}

it('every documented divergence matches a vendored case', () => {
  expect(divergent.size).toBe(divergenceCount(DIR))
})
