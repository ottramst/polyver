/**
 * `all` and `none`: general VERS types whose only valid form is `vers:all/*` or `vers:none/*`.
 *
 * Reference: vers-spec docs/types/vers-types.md. Any non-empty version can be tested against them, but
 * their versions have no order.
 */
import { VersError } from '../errors.ts'
import type { Scheme } from './types.ts'

function starOnly(type: string): Scheme {
  return {
    type,
    isValid: (version) => version.length > 0,
    compare() {
      throw new VersError('INVALID_VERSION', `versions of type ${type} have no order`)
    },
  }
}

export const all: Scheme = starOnly('all')
export const none: Scheme = starOnly('none')
