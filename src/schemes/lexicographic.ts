/**
 * `lexicographic`: byte-wise comparison of the UTF-8 encoding, without normalisation.
 *
 * Reference: vers-spec docs/types/vers-types.md. Comparing Unicode code points gives the same order as
 * comparing UTF-8 bytes; comparing JavaScript strings directly would compare UTF-16 code units, which
 * sorts characters above U+FFFF before U+E000 to U+FFFF.
 */
import type { Scheme } from './types.ts'
import { compareCodePoints, invalidVersion } from './util.ts'

// Rejects lone surrogates, which have no UTF-8 encoding.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function isValid(version: string): boolean {
  return version.length > 0 && !LONE_SURROGATE.test(version)
}

export const lexicographic: Scheme = {
  type: 'lexicographic',
  isValid,
  compare(a, b) {
    for (const v of [a, b]) if (!isValid(v)) throw invalidVersion('lexicographic', v)
    return compareCodePoints(a, b)
  },
}
