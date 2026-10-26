/**
 * `intdot`: non-negative integers separated by dots, such as `10.234.5.12`.
 *
 * Reference: vers-spec docs/types/vers-types.md. Leading zeros are ignored, a missing trailing segment
 * equals `0`, and interpretation stops at the first character that is neither a digit nor a dot, so
 * `1.2beta` equals `1.2rc1`.
 */
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

const INTDOT = /^\d+(?:\.\d+)*/

function segments(version: string): string[] {
  const m = INTDOT.exec(version)
  if (!m) throw invalidVersion('intdot', version)
  return m[0].split('.')
}

export const intdot: Scheme = {
  type: 'intdot',
  isValid: (version) => INTDOT.test(version),
  compare(a, b) {
    const x = segments(a)
    const y = segments(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const c = compareDigits(x[i] ?? '0', y[i] ?? '0')
      if (c !== 0) return c
    }
    return 0
  },
}
