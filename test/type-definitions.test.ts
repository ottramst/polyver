// The examples in vers-spec's registered type definitions (testdata/vers-spec/types).
import { describe, expect, it } from 'vitest'
import { fromNative, normalizeVers, stringifyVers } from '../src/index.ts'
import { divergence, divergenceCount } from './support/divergences.ts'
import { readTestdata } from './support/vectors.ts'

interface TypeDefinition {
  readonly type: string
  readonly vers_examples: readonly string[]
  readonly native_range_and_vers_equivalent_examples: readonly {
    readonly native_range: string
    readonly vers: string
  }[]
}

let divergent = 0

for (const type of ['npm', 'pypi']) {
  const path = `vers-spec/types/${type}-definition.json`
  const definition = JSON.parse(readTestdata(path)) as TypeDefinition

  describe(path, () => {
    // Some examples are not in canonical order, so they are normalised first.
    it.each(definition.vers_examples)('normalises %s', (vers) => {
      expect(stringifyVers(normalizeVers(vers))).toMatch(new RegExp(`^vers:${type}/`))
    })

    for (const { native_range, vers } of definition.native_range_and_vers_equivalent_examples) {
      const d = divergence(path, native_range)
      if (d) divergent++
      const name = `fromNative(${JSON.stringify(native_range)})`
      it(d ? `${name} (diverges: ${d.reason})` : `${name} is ${vers}`, () => {
        const expected = d
          ? (d.override.expected_output as string)
          : stringifyVers(normalizeVers(vers))
        expect(stringifyVers(fromNative(type, native_range))).toBe(expected)
      })
    }
  })
}

it('every documented divergence matches an example', () => {
  expect(divergent).toBe(divergenceCount('vers-spec/types/'))
})
