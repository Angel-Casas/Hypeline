// Key + placeholder + plural-form parity of every locale against en.json (ADR-20).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(process.cwd(), 'src/i18n/locales');
const en = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8'));
const codes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['es', 'pt-BR', 'de', 'fr', 'ru', 'ja', 'ko', 'zh-TW', 'tr'];
const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'object' && v) flat(v, p + k + '.', out);
    else out[p + k] = v;
  }
  return out;
};
const params = (s) => (s.match(/\{[^}]*\}/g) ?? []).sort().join(',');
let bad = 0;
const E = flat(en);
for (const c of codes) {
  let L;
  try {
    L = flat(JSON.parse(readFileSync(join(dir, c + '.json'), 'utf8')));
  } catch (e) {
    console.log(`${c}: cannot parse — ${e.message}`);
    bad++;
    continue;
  }
  const errs = [];
  for (const k of Object.keys(E)) {
    if (!(k in L)) errs.push(`missing ${k}`);
    else {
      if (typeof L[k] !== 'string') errs.push(`not a string ${k}`);
      else {
        if (params(L[k]) !== params(E[k]))
          errs.push(`params differ ${k}: ${params(E[k])} vs ${params(L[k])}`);
        const ne = E[k].split(' | ').length,
          nl = L[k].split(' | ').length;
        if (ne !== nl) errs.push(`plural forms differ ${k}: ${ne} vs ${nl}`);
        if (L[k].trim() === '') errs.push(`empty ${k}`);
      }
    }
  }
  for (const k of Object.keys(L)) if (!(k in E)) errs.push(`extra ${k}`);
  if (errs.length) {
    bad++;
    console.log(`${c}: ${errs.length} problem(s)\n  ` + errs.slice(0, 25).join('\n  '));
  } else console.log(`${c}: OK (${Object.keys(L).length} strings)`);
}
process.exit(bad ? 1 : 0);
