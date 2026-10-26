import { VersError } from '../errors.ts'

/** Compares two strings of ASCII digits numerically, without converting them to numbers. */
export function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+/, '')
  const y = b.replace(/^0+/, '')
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)
}

/** Compares two strings by Unicode code point, which matches UTF-8 byte order. */
export function compareCodePoints(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number
    const y = b.codePointAt(j) as number
    if (x !== y) return x - y
    i += x > 0xffff ? 2 : 1
    j += y > 0xffff ? 2 : 1
  }
  return a.length - i - (b.length - j)
}

export function invalidVersion(type: string, version: string): VersError {
  return new VersError('INVALID_VERSION', `invalid ${type} version: ${JSON.stringify(version)}`)
}
