// Dependency-free upload bundle, using the site's existing forecast/alert helpers.
import {readFile, writeFile} from 'node:fs/promises';
const file = path => new URL(path, import.meta.url);
let code = await readFile(file('./worker.mjs'), 'utf8');
for (const [name, path] of [['SunCalc','../../assets/vendor/suncalc.js'], ['alerts','../../assets/weather-alerts.js'], ['weather','../../assets/weather-core.js']]) {
  const source = await readFile(file(path), 'utf8');
  code = code.replace(`import ${name} from '${path}';`, `const ${name} = (() => { const module = {exports:{}}; const exports = module.exports;\n${source}\nreturn module.exports; })();`);
}
code = code.replace("import {send, validateSubscription} from './webpush.mjs';", (await readFile(file('./webpush.mjs'), 'utf8')).replace(/export /g,''));
await writeFile(process.argv[2] || '/private/tmp/gregle-weather-worker.mjs', code);
