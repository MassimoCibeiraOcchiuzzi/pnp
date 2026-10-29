// Verificación E2E (solo desarrollo): abre dist/resolver-pnp.html como file://
// en Chrome headless, carga cada ejemplo, junta errores de consola y requests
// de red, y guarda capturas en tools/capturas/.
// Uso: cd tools && npm install && node e2e.mjs

import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const url = pathToFileURL(`${raiz}dist/resolver-pnp.html`).href;
const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
mkdirSync(capturas, { recursive: true });

const todos = JSON.parse(readFileSync(`${raiz}tests/fixtures/ejemplos.json`, 'utf8'));
// Los ejemplos con mensaje de Tesorería tienen su propia sección (capturas t*.png).
const ejemplos = todos.filter((e) => !e.tesoreria);
const esperado = readFileSync(`${raiz}tests/fixtures/el-21760-ticket-esperado.txt`, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const page = await context.newPage();

const problemas = [];
const red = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problemas.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problemas.push(`[pageerror] ${e.message}`));
page.on('request', (r) => { if (!/^(file|data|about):/.test(r.url())) red.push(r.url()); });

await page.goto(url);
await page.screenshot({ path: `${capturas}00-vacio.png`, fullPage: true });

const resultados = [];
let i = 1;
for (const e of ejemplos) {
  await page.selectOption('#ejemplo', e.id);
  await page.waitForTimeout(150);
  const tipo = await page.locator('#tipo').innerText();
  const tarjetas = await page.locator('#salidas .tarjeta').count();
  const pnps = await page.locator('#pnps .tarjeta').count();
  resultados.push({ id: e.id, tipo: tipo.replace(/\s+/g, ' '), pnps, salidas: tarjetas });
  await page.screenshot({ path: `${capturas}${String(i++).padStart(2, '0')}-${e.id}.png`, fullPage: true });
}

// Snapshot en el DOM: el ticket a E-Learning del ejemplo 21760.
await page.selectOption('#ejemplo', 'el-21760');
await page.waitForTimeout(150);
const descripcion = await page.locator('#salidas .sub-salida pre').nth(1).innerText();
const snapshotOk = descripcion === esperado;

// Interacción: contestar "Sí" en el B1 → cobro manual, resolución 3b.
await page.check('#dec-12401-si');
await page.fill('#f-12401-recibo', '00031234/2026');
await page.waitForTimeout(300);
const resolucionCobro = await page.locator('#salidas').innerText();
const cobroOk = resolucionCobro.includes('Se cobró manualmente. Recibo 00031234/2026') && resolucionCobro.includes('Checklist: Cobro manual');
await page.screenshot({ path: `${capturas}${String(i++).padStart(2, '0')}-el-21760-cobro-manual.png`, fullPage: true });

// Copiar todo (permiso de portapapeles)
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#copiar-todo');
const copiado = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
const copiarOk = copiado.includes('===== 1. Diagnóstico =====');

// Ayuda
await page.click('header .abrir-ayuda');
await page.screenshot({ path: `${capturas}${String(i++).padStart(2, '0')}-ayuda.png` });
await page.click('#cerrar-ayuda');

// Modo oscuro
await page.selectOption('#ejemplo', 'formato-una-linea');
await page.click('#tema');
await page.waitForTimeout(100);
await page.screenshot({ path: `${capturas}${String(i++).padStart(2, '0')}-oscuro.png`, fullPage: true });
await page.click('#tema');

// Celular
await page.setViewportSize({ width: 390, height: 844 });
await page.selectOption('#ejemplo', 'pnp-10703');
await page.waitForTimeout(150);
let desborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await page.screenshot({ path: `${capturas}${String(i++).padStart(2, '0')}-celular.png`, fullPage: true });

// ---- Cruce con Tesorería ----------------------------------------------------
await page.setViewportSize({ width: 1440, height: 1000 });
const tes = {};
await page.selectOption('#ejemplo', 'tesoreria-21852');
await page.waitForTimeout(200);
let salidas = await page.locator('#salidas').innerText();
tes.tablaFilas = await page.locator('table.cruce tbody tr').count();
tes.sugerencia = salidas.includes('parece ser el lote EL 1893');
tes.sumaHerrera = (await page.locator('#pnp-12468').innerText()).includes('es la suma de 2 pagos de 92.433');
tes.avisoQuery = (await page.locator('#avisos').innerText()).includes('hace falta la query para cruzarlos');
tes.tesoreriaNoGuardada = await page.evaluate(() => Object.keys(localStorage).every((k) => !/tesorer/i.test(k) && !/Herrera/.test(localStorage.getItem(k) || '')));
await page.screenshot({ path: `${capturas}t1-tesoreria-sin-query.png`, fullPage: true });
await page.getByRole('button', { name: /^Aceptar: comparar el lote/ }).click();
await page.waitForTimeout(200);
tes.sugerenciaAceptada = (await page.locator('#salidas').innerText()).includes('sugerencia aceptada');

await page.selectOption('#ejemplo', 'tesoreria-21852-query');
await page.waitForTimeout(200);
salidas = await page.locator('#salidas').innerText();
tes.nombreB2 = (await page.locator('#pnp-12469').innerText()).includes('Nombre tomado del mensaje de Tesorería');
tes.mailEnTicket = salidas.includes('Mail inscripto: federico.acosta@example.com');
tes.respuesta = salidas.includes('Hola Johanna,') && salidas.includes('7. Respuesta a Tesorería');
await page.click('.cruce-tesoreria .btn-copiar');
const tsv = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
tes.copiarTabla = tsv.startsWith('ID pago\tNombre') && tsv.split('\n').length === 17;
await page.screenshot({ path: `${capturas}t2-tesoreria-con-query.png`, fullPage: true });
await page.click('#tema');
await page.waitForTimeout(100);
await page.screenshot({ path: `${capturas}t3-tesoreria-oscuro.png`, fullPage: true });
await page.click('#tema');

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
const desbordeTes = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
desborde = desborde || desbordeTes;
await page.screenshot({ path: `${capturas}t4-tesoreria-celular.png`, fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
await page.selectOption('#ejemplo', 'tesoreria-sola');
await page.waitForTimeout(200);
tes.pedido = (await page.locator('#tipo').innerText()).includes('Pedido de Tesorería') &&
  (await page.locator('#salidas').innerText()).includes("l.NombreArchivo LIKE '%.EL.%.1893[_.]%'");
await page.screenshot({ path: `${capturas}t5-tesoreria-sola.png`, fullPage: true });

await browser.close();

console.table(resultados);
console.log('Snapshot ticket E-Learning en el DOM:', snapshotOk ? 'OK' : 'DIFERENTE');
if (!snapshotOk) console.log(descripcion);
console.log('Cobro manual (3b + checklist):', cobroOk ? 'OK' : 'FALLÓ');
console.log('Copiar todo:', copiarOk ? 'OK' : 'FALLÓ');
console.log('Desborde horizontal en celular:', desborde ? 'SÍ (mal)' : 'no');
console.log('Tesorería:', tes);
const tesOk = tes.tablaFilas === 16 && Object.entries(tes).every(([k, v]) => k === 'tablaFilas' || v === true);
console.log('Errores/warnings de consola:', problemas.length ? problemas : 'ninguno');
console.log('Requests de red:', red.length ? red : 'ninguna');
process.exitCode = tesOk && snapshotOk && cobroOk && copiarOk && !desborde && !problemas.length && !red.length ? 0 : 1;
