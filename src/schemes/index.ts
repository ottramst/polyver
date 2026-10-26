import type { Scheme } from './types.ts'

export type { Scheme } from './types.ts'

const schemes = new Map<string, Scheme>()

/** Returns the scheme for a VERS type, or `undefined` if it is not supported. */
export function getScheme(type: string): Scheme | undefined {
  return schemes.get(type.toLowerCase())
}

/** Lists the supported VERS types. */
export function supportedSchemes(): string[] {
  return [...schemes.keys()].sort()
}
