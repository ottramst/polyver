// Extracts the version tables from golang.org/x/mod's tests as JSON, without running them.
// Usage: node scripts/go-fixture-to-json.ts <semver_test.go> <pseudo_test.go> <out-dir>
// Writes <out-dir>/semver.json (`tests` from semver_test.go: {in, out} rows in table order, where an
// empty `out` marks an invalid version) and <out-dir>/pseudo.json (`pseudoTests` from pseudo_test.go:
// {major, older, version} rows). TestSort's golden list is not extracted: it breaks ties with
// strings.Compare, which is not part of the version order.
import { readFileSync, writeFileSync } from 'node:fs'

const [semverTest, pseudoTest, out] = process.argv.slice(2)
if (!semverTest || !pseudoTest || !out) {
  throw new Error('usage: go-fixture-to-json.ts <semver_test.go> <pseudo_test.go> <out-dir>')
}

// A Go interpreted string literal without escapes other than JSON's.
const STRING = '"(?:[^"\\\\]|\\\\.)*"'

/** Returns the rows of `var <name> = []struct{...}{ ... }` as arrays of strings. */
function table(path: string, name: string, columns: number): string[][] {
  const source = readFileSync(path, 'utf8')
  const start = source.indexOf(`var ${name} = []struct {`)
  if (start < 0) throw new Error(`${path}: no table ${name}`)
  const lines = source.slice(start).split('\n')
  const body = lines.indexOf('}{')
  const end = lines.indexOf('}')
  if (body < 0 || end < body) throw new Error(`${path}: cannot find the rows of ${name}`)
  const row = new RegExp(`^\\t\\{(${STRING}(?:, ${STRING}){${columns - 1}})\\},$`)
  return lines.slice(body + 1, end).map((line) => {
    const m = row.exec(line)
    if (!m) throw new Error(`${path}: unexpected row in ${name}: ${JSON.stringify(line)}`)
    return JSON.parse(`[${m[1]}]`) as string[]
  })
}

// One entry per line, so that a pin bump gives a readable diff.
function write(path: string, rows: object[]): void {
  writeFileSync(path, `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`)
}

write(
  `${out}/semver.json`,
  table(semverTest, 'tests', 2).map(([input, output]) => ({ in: input, out: output })),
)
write(
  `${out}/pseudo.json`,
  table(pseudoTest, 'pseudoTests', 3).map(([major, older, version]) => ({ major, older, version })),
)
