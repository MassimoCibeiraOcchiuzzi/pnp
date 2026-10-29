// Build: inlinea CSS + JS + ejemplos en un único dist/resolver-pnp.html.
// Uso: node build.mjs   (sin dependencias)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CONFIG } from './src/config.js';

const leer = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Orden de los módulos: cada uno usa lo de los anteriores.
const MODULOS = ['config', 'parser', 'classifier', 'templates', 'ui'];

function aScript(codigo) {
  return codigo
    .replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:const|let|function|class)\b)/gm, '');
}

const ejemplos = JSON.parse(leer('./tests/fixtures/ejemplos.json')).map((e) => ({
  id: e.id,
  titulo: e.titulo,
  texto: e.texto ? leer(`./tests/fixtures/${e.texto}`) : '',
  query: e.query ? leer(`./tests/fixtures/${e.query}`) : '',
  tesoreria: e.tesoreria ? leer(`./tests/fixtures/${e.tesoreria}`) : '',
  archivoLote: e.archivoLote ? leer(`./tests/fixtures/${e.archivoLote}`) : '',
  overrides: e.overrides || null,
}));

const ahora = new Date();
const pad = (n) => String(n).padStart(2, '0');
const BUILD = {
  version: CONFIG.version,
  fecha: `${pad(ahora.getDate())}/${pad(ahora.getMonth() + 1)}/${ahora.getFullYear()} ${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`,
};

const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const js = [
  '(() => {',
  "'use strict';",
  `const BUILD = ${json(BUILD)};`,
  `const EJEMPLOS = ${json(ejemplos)};`,
  ...MODULOS.map((m) => `// ---- src/${m}.js ----\n${aScript(leer(`./src/${m}.js`))}`),
  '})();',
].join('\n');

if (/\bimport\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(js)) {
  throw new Error('El bundle no puede tener llamadas de red ni imports dinámicos.');
}
if (/<\/script/i.test(js)) throw new Error('El JS contiene </script>.');

const html = leer('./src/index.html')
  .replace('/*__CSS__*/', () => leer('./src/styles.css'))
  .replace('/*__JS__*/', () => js);

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/resolver-pnp.html', import.meta.url), html, 'utf8');
console.log(`dist/resolver-pnp.html generado (${(html.length / 1024).toFixed(1)} KB) · v${BUILD.version} · ${BUILD.fecha}`);
