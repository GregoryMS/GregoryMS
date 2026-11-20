// Dependency-free upload bundle, using the site's existing forecast/alert helpers.
import {readFile, writeFile} from 'node:fs/promises';
const file = path => new URL(path, import.meta.url);
let code = await readFile(file('./worker.mjs'), 'utf8');
for (const [name, path] of [['SunCalc','../../assets/vendor/suncalc.js'], ['alerts','../../assets/weather-alerts.js'], ['weather','../../assets/weather-core.js']]) {
  const source = await readFile(file(path), 'utf8');
  code = code.replace(`import ${name} from '${path}';`, `const ${name} = (() => { const module = {exports:{}}; const exports = module.exports;\n${source}\nreturn module.exports; })();`);
}
code = code.replace("import {send, validateSubscription} from './webpush.mjs';", (await readFile(file('./webpush.mjs'), 'utf8')).replace(/export /g,''));
let seismic = await readFile(file('./earthquakes.mjs'), 'utf8');
const earthquakeCore = await readFile(file('../../assets/earthquake-core.js'), 'utf8');
seismic = seismic.replace("import core from '../../assets/earthquake-core.js';", `const core = (() => { const module = {exports:{}}; const exports = module.exports;\n${earthquakeCore}\nreturn module.exports; })();`);
seismic = seismic.replace("import {send, validateSubscription} from './webpush.mjs';", '');
seismic = seismic.replace(/export default /g,'return ').replace(/export /g,'');
code = code.replace("import seismic from './earthquakes.mjs';", () => `const seismic = (() => {\n${seismic}\n})();`);
await writeFile(process.argv[2] || '/private/tmp/gregle-weather-worker.mjs', code);

