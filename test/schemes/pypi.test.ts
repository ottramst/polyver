import { describe, expect, it } from 'vitest'
import {
  contains,
  fromNative,
  getScheme,
  type Scheme,
  stringifyVers,
  VersError,
  type VersErrorCode,
} from '../../src/index.ts'
import { loadComparisonPairs, readTestdata } from '../support/vectors.ts'

const s = getScheme('pypi') as Scheme

// pypa/packaging tests/test_version.py, extracted by scripts/extract-packaging-vectors.py.
const packaging = JSON.parse(readTestdata('packaging/versions.json')) as {
  sorted: string[]
  invalid: string[]
  normalized: [string, string][]
}

describe('pypi versions (pypa/packaging vectors)', () => {
  it('orders VERSIONS strictly ascending, checking every pair', () => {
    const { sorted } = packaging
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 0; j < sorted.length; j++) {
        const a = sorted[i] as string
        const b = sorted[j] as string
        expect(Math.sign(s.compare(a, b)), `${a} vs ${b}`).toBe(Math.sign(i - j))
      }
    }
  })

  it.each(packaging.invalid)('rejects %j', (v) => {
    expect(s.isValid(v)).toBe(false)
    expect(() => s.compare(v, '1.0')).toThrow(VersError)
  })

  // packaging strips surrounding whitespace; a VERS version cannot contain it.
  it.each(packaging.normalized.filter(([v]) => v.trim() === v))('%s == %s', (v, normalized) => {
    expect(s.compare(v, normalized)).toBe(0)
  })

  it.each(packaging.normalized.filter(([v]) => v.trim() !== v))('rejects whitespace in %j', (v) => {
    expect(s.isValid(v)).toBe(false)
  })
})

describe('pypi versions (osv-scalibr vectors)', () => {
  for (const file of ['pypi-versions.txt', 'pypi-versions-generated.txt']) {
    it(`passes the valid PEP 440 pairs of ${file}`, () => {
      const pairs = loadComparisonPairs(`osv-scalibr/${file}`)
      let used = 0
      for (const { a, op, b, line } of pairs) {
        if (!s.isValid(a) || !s.isValid(b)) continue
        used++
        expect(Math.sign(s.compare(a, b)), `line ${line}: ${a} ${op} ${b}`).toBe(
          { '<': -1, '=': 0, '>': 1 }[op],
        )
      }
      // pypi-versions.txt deliberately includes some legacy, non-PEP 440 versions.
      expect(used).toBeGreaterThan(Math.min(pairs.length * 0.9, 25))
    })
  }
})

describe('pypi fromNative', () => {
  it.each([
    ['>= 1.0', 'vers:pypi/>=1.0'],
    ['>=1.0, <2.0', 'vers:pypi/>=1.0|<2.0'],
    ['<2.0,>=1.0', 'vers:pypi/>=1.0|<2.0'],
    ['==1.0', 'vers:pypi/1.0'],
    ['!=1.0', 'vers:pypi/!=1.0'],
    ['>=1.0,!=1.5,<2.0', 'vers:pypi/>=1.0|!=1.5|<2.0'],
    ['!=1.5,>=1.0', 'vers:pypi/>=1.0|!=1.5'],
    ['!=0.5,>=1.0', 'vers:pypi/>=1.0'],
    ['~=2.2', 'vers:pypi/>=2.2|<3.dev0'],
    ['~=1.4.5', 'vers:pypi/>=1.4.5|<1.5.dev0'],
    ['~=2.2.post3', 'vers:pypi/>=2.2.post3|<3.dev0'],
    ['~=1!2.2', 'vers:pypi/>=1%212.2|<1%213.dev0'],
    ['==1.4.*', 'vers:pypi/>=1.4.dev0|<1.5.dev0'],
    ['!=1.4.*', 'vers:pypi/<1.4.dev0|>=1.5.dev0'],
    ['==1.9.*', 'vers:pypi/>=1.9.dev0|<1.10.dev0'],
    ['>=1.0a1,<1.0.5||>=1.1b1,<1.1.1', 'vers:pypi/>=1.0a1|<1.0.5|>=1.1b1|<1.1.1'],
    ['==2.3.0||==3.0.0', 'vers:pypi/2.3.0|3.0.0'],
    ['<2.0||<1.0', 'vers:pypi/<2.0'],
    ['>=1.0,<1.5||>=1.2,<2.0', 'vers:pypi/>=1.0|<2.0'],
    ['<1.0||>1.0', 'vers:pypi/!=1.0'],
    ['', 'vers:pypi/*'],
    ['==v1.*', 'vers:pypi/>=1.dev0|<2.dev0'],
    ['==1.0+local', 'vers:pypi/1.0+local'],
  ])('%j -> %s', (native, expected) => {
    expect(stringifyVers(fromNative('pypi', native))).toBe(expected)
  })

  it('handles epochs, which must be percent-encoded', () => {
    expect(stringifyVers(fromNative('pypi', '>=1!1.0'))).toBe('vers:pypi/>=1%211.0')
  })

  it.each<[string, VersErrorCode]>([
    ['1.0', 'INVALID_SYNTAX'],
    ['===1.0', 'INVALID_SYNTAX'],
    ['~=1', 'INVALID_SYNTAX'],
    ['~=1.0+local', 'INVALID_SYNTAX'],
    ['<1.0+local', 'INVALID_SYNTAX'],
    ['>=1.0+local', 'INVALID_SYNTAX'],
    ['>=1.0||', 'INVALID_SYNTAX'],
    ['||>=1.0', 'INVALID_SYNTAX'],
    ['>=1.0||,', 'INVALID_SYNTAX'],
    ['>=1.*', 'INVALID_SYNTAX'],
    ['==1.0a1.*', 'INVALID_SYNTAX'],
    ['>=not-a-version', 'INVALID_VERSION'],
    ['>=2.0,<1.0', 'INVALID_CONSTRAINTS'],
    ['==1.0,!=1.0', 'INVALID_CONSTRAINTS'],
  ])('rejects %j with %s', (native, code) => {
    try {
      fromNative('pypi', native)
      expect.unreachable()
    } catch (e) {
      expect((e as VersError).code).toBe(code)
    }
  })

  it('throws a VersError for a non-string range', () => {
    expect(() => fromNative('pypi', undefined as unknown as string)).toThrow(VersError)
  })

  it('intersects many != specifiers quickly', () => {
    const native = Array.from({ length: 5000 }, (_, i) => `!=${i}.0`).join(',')
    const start = performance.now()
    expect(fromNative('pypi', native).constraints).toHaveLength(5000)
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('agrees with PEP 440 prefix matching for ==X.*', () => {
    const range = fromNative('pypi', '==1.4.*')
    for (const v of ['1.4', '1.4.0', '1.4.dev0', '1.4a1', '1.4.5', '1.4.post1', '1.4.99999']) {
      expect(contains(range, v), v).toBe(true)
    }
    for (const v of ['1.3.9', '1.5', '1.5.dev0', '1.40', '1!1.4']) {
      expect(contains(range, v), v).toBe(false)
    }
  })
})
