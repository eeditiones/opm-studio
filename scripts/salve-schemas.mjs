// node scripts/salve-schemas.mjs <name> <schema.rng>: write schema/<name>.salve.json, the grammar
// the editor validates against (src/runtime/validator.ts). scripts/schemas.py calls it with the
// RELAX NG it downloaded, includes beside it.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import salve from 'salve-annos';

const [name, rng] = process.argv.slice(2);
const { simplified, warnings } = await salve.convertRNGToPattern(pathToFileURL(rng));
// DocBook's ENTITY attributes, checked as plain strings, are the only ones so far
if (warnings.length) console.warn(`${name}: ${warnings.length} conversion warnings, e.g. ${warnings[0].replace(/^WARNING: \S+ /, '')}`);
const out = new URL(`../schema/${name}.salve.json`, import.meta.url);
writeFileSync(out, salve.writeTreeToJSON(simplified, 3));
console.log(`Wrote schema/${name}.salve.json`);
