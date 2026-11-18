/* Build the calculator's offline MathML from the authored LaTeX with Pandoc. */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.join(__dirname,'..');
const entries = Object.entries(JSON.parse(fs.readFileSync(path.join(root,'data/calc-formulas-latex.json'),'utf8')));
const markdown = entries.flatMap(([,equations]) => equations.map(tex => '$$'+tex+'$$')).join('\n\n');
const result = spawnSync('pandoc',['-f','markdown+tex_math_dollars','-t','html5','--mathml','--wrap=none'],{input:markdown,encoding:'utf8'});
if (result.error) throw result.error;
if (result.status !== 0 || result.stderr.trim()) throw Error(result.stderr || 'Pandoc could not build the equations');
const equations = result.stdout.match(/<math\b[^>]*>[\s\S]*?<\/math>/g) || [];
if (equations.length !== entries.reduce((count,[,items]) => count+items.length,0)) {
  throw Error('Some formulas did not render as MathML');
}

let offset = 0;
const asset = {};
for (const [id,items] of entries) {
  asset[id] = equations.slice(offset,offset+items.length);
  offset += items.length;
}
fs.writeFileSync(path.join(root,'assets/calc-formula-math.js'),
  '/* Generated from data/calc-formulas-latex.json by scripts/build-calc-formula-math.cjs. */\n'+
  'window.GregleFormulaMath = '+JSON.stringify(asset,null,2)+';\n');
