// Converts a node-semver test fixture (a CommonJS module exporting an array literal) to JSON.
// Usage: node scripts/js-fixture-to-json.ts <fixture.js> <out.json>
// The module runs in an empty vm context; its only `require` is the constants module it imports.
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: js-fixture-to-json.ts <fixture.js> <out.json>')

const constants = { MAX_LENGTH: 256, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER }
const module = { exports: [] as unknown[] }
runInNewContext(readFileSync(input, 'utf8'), {
  module,
  require: (id: string) => {
    if (id.endsWith('/internal/constants')) return constants
    throw new Error(`unexpected require: ${id}`)
  },
})
// One entry per line, so that a pin bump gives a readable diff.
writeFileSync(output, `[\n${module.exports.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`)
