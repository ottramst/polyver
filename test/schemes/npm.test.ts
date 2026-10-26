import { describe, expect, it } from 'vitest'
import { getScheme, type Scheme, VersError } from '../../src/index.ts'
import { loadComparisonPairs } from '../support/vectors.ts'

const s = getScheme('npm') as Scheme

describe('npm', () => {
  it.each(['1.2.3', 'v1.2.3', '1.2.3-beta.1+build', `${Number.MAX_SAFE_INTEGER}.0.0`])(
    'accepts %s',
    (v) => expect(s.isValid(v)).toBe(true),
  )

  it.each([
    '1.2',
    '=1.2.3',
    'vv1.2.3',
    'V1.2.3',
    '01.2.3',
    `${Number.MAX_SAFE_INTEGER + 2}.0.0`,
    `1.2.3-${'a'.repeat(251)}`,
  ])('rejects %s', (v) => expect(s.isValid(v)).toBe(false))

  it('ignores a leading v and build metadata', () => {
    expect(s.compare('v1.2.3', '1.2.3')).toBe(0)
    expect(s.compare('1.2.3+a', '1.2.3+b')).toBe(0)
    expect(s.compare('1.2.3-beta', '1.2.3')).toBeLessThan(0)
  })

  it('compares large numeric pre-release identifiers exactly', () => {
    expect(s.compare('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBeGreaterThan(0)
  })

  it('throws on invalid versions', () => {
    expect(() => s.compare('latest', '1.0.0')).toThrow(VersError)
  })

  it('passes the osv-scalibr vectors that are valid npm versions', () => {
    let used = 0
    for (const { a, op, b, line } of loadComparisonPairs('osv-scalibr/semver-versions.txt')) {
      if (!s.isValid(a) || !s.isValid(b)) continue
      used++
      expect(Math.sign(s.compare(a, b)), `line ${line}: ${a} ${op} ${b}`).toBe(
        { '<': -1, '=': 0, '>': 1 }[op],
      )
    }
    expect(used).toBeGreaterThan(70)
  })
})
