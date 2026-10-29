import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsearTesoreria, loteElDesdeArchivo, desglosarCodigoBarras, normalizarNombre, parsearQuery,
} from '../src/parser.js';
import { analizar, cruzarTesoreria, gruposSuma } from '../src/classifier.js';
import {
  salidasPnp, ticketElearning, mailCoordinador, respuestaTesoreria, queryTesoreria, tablaCruceTsv, notaInterna,
} from '../src/templates.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CTX = { fecha: '29/10/2026', firma: 'Juana Pérez\nSoporte de Aplicaciones' };

// Lo esperado de cada pago del mail de Tesorería (orden del mail).
const ESPERADO = [
  ['1231045', '2122075', 'Ferraro, Camila', 'cferraro27@example.com', '183887', '25/09/2026', '', 80000, 77967.2, 62373.76, 1895],
  ['1231164', '2122141', 'Lucia, Benitez', 'lu30783@example.com', '183855', '26/09/2026', '', 52038, 51408.3, 41126.67, 1895],
  ['1244617', '2132953', 'quiroga, Tomas', 'quirogatomas2@example.com', '183613', '15/10/2026', '', 725000, 706578, 706577.75, 1895],
  ['1227749', '2119961', 'MEDINA, Ezequiel', 'ezemed@example.com', '186730', '21/09/2026', '3 Cuotas', 110000, 100018, 80014, 1894],
  ['1227872', '2120017', 'Domínguez, Ana Paula', 'anapdominguez@example.com', '184536', '21/09/2026', '3 Cuotas', 300890, 297249, 237799.38, 1894],
  ['1228688', '2120341', 'ROMERO, SOFIA', 'romerosofia@example.com', '182012', '22/09/2026', '3 Cuotas', 180039, 163700, 130960.36, 1894],
  ['1229045', '2120561', 'Castro, Martin', 'martincastro0912@example.com', '182012', '22/09/2026', '3 Cuotas', 180039, 163700, 130960.36, 1894],
  ['1229877', '2120975', 'Molina, Paula', 'p.molina@example.com', '182012', '23/09/2026', '3 Cuotas', 180039, 177861, 142288.42, 1894],
  ['1159269', '2027515', 'PAREDES, JOAQUIN', 'calidad@empresa-ejemplo.com.ar', '182312', '22/07/2026', '3 y 6 Cuotas', 191261, 186401, 186401.06, 1893],
  ['1232541', '2122945', 'Herrera, Nicolas', 'nicolash831@example.com', '183041', '29/09/2026', '3 y 6 Cuotas', 92433, 79571, 79570.95, 1893],
  ['1232542', '2122945', 'Herrera, Nicolas', 'nicolash831@example.com', '183041', '29/09/2026', '3 y 6 Cuotas', 92433, 84044.7, 84044.7, 1893],
  ['1236361', '2125786', 'Acosta, Federico', 'federico.acosta@example.com', '182262', '02/10/2026', '3 y 6 Cuotas', 194454, 167396, 167395.73, 1893],
  ['1238886', '2127671', 'Sosa, Gabriel Andres', 'gsosa@empresa-ejemplo.com.ar', '183041', '05/10/2026', '3 y 6 Cuotas', 217489, 187225, 187225.4, 1893],
  ['1243651', '2131922', 'Rios, Florencia', 'rrhh@otra-empresa.com.ar', '185842', '08/10/2026', '3 y 6 Cuotas', 229235, 223410, 223410.14, 1893],
  ['1244508', '2132869', 'vega, Matias', 'matias.vega@example.org', '184429', '15/10/2026', '3 y 6 Cuotas', 206224, 177528, 177527.93, 1893],
  ['1244349', '2131220', 'Navarro, Pablo Ezequiel', 'pnavarro89@example.com', '183613', '07/10/2026', '', 242000, 235851, 235850.78, 1892],
];

function chequearPagos(pagos) {
  // El fixture real tiene 16 pagos (3 del lote 1895, 5 del 1894, 7 del 1893 y 1 del 1892).
  assert.equal(pagos.length, ESPERADO.length);
  pagos.forEach((x, i) => {
    const [idPago, idOrden, nombre, email, idCurso, fechaPago, planMP, bruto, neto, facultad, loteEl] = ESPERADO[i];
    assert.deepEqual(
      [x.idPago, x.idOrden, x.nombre, x.email, x.idCurso, x.fechaPago, x.planMP, x.montoBruto, x.montoNeto, x.montoFacultad, x.loteEl],
      [idPago, idOrden, nombre, email, idCurso, fechaPago, planMP, bruto, neto, facultad, loteEl],
      `pago ${i + 1} (${idPago})`,
    );
    assert.equal(x.entidad, 'Mercado Pago');
    assert.equal(x.moneda, 'Pesos');
    assert.equal(x.estado, 'No liquidado Argentina En tesoreria');
    assert.equal(x.aviso, undefined);
  });
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

test('Tesorería: lee los 16 pagos con todos sus campos (mails en markdown)', () => {
  const pagos = parsearTesoreria(fx('tesoreria-johanna.txt'));
  chequearPagos(pagos);
  const primero = pagos[0];
  assert.equal(primero.fechaAcreditacion, '01/10/2026');
  assert.equal(primero.nombreNormalizado, 'camila ferraro');
  assert.match(primero.crudo, /^1231045 2122075 Ferraro,Camila cferraro27@example\.com 183887/);
  assert.doesNotMatch(pagos[pagos.length - 1].crudo, /GRACIAS|Por favor/);
});

test('Tesorería: "En lote nº" aplica a las filas anteriores aunque no haya línea en blanco', () => {
  const pagos = parsearTesoreria(fx('tesoreria-johanna.txt'));
  // quiroga (último del 1895) va pegado a MEDINA (primero del 1894), etc.
  assert.equal(pagos.find((x) => x.idPago === '1244617').loteEl, 1895);
  assert.equal(pagos.find((x) => x.idPago === '1227749').loteEl, 1894);
  assert.equal(pagos.find((x) => x.idPago === '1229877').loteEl, 1894);
  assert.equal(pagos.find((x) => x.idPago === '1159269').loteEl, 1893);
  assert.equal(pagos.find((x) => x.idPago === '1244508').loteEl, 1893);
  assert.equal(pagos.find((x) => x.idPago === '1244349').loteEl, 1892);
});

test('Tesorería: mails en texto plano y columnas con tabs (una línea por pago)', () => {
  chequearPagos(parsearTesoreria(fx('tesoreria-johanna-plano.txt')));
  const tabs = fx('tesoreria-johanna-tabs.txt');
  assert.ok(tabs.includes('\t'));
  chequearPagos(parsearTesoreria(tabs));
});

test('Tesorería: nombre normalizado no depende del orden ni de tildes/mayúsculas', () => {
  assert.equal(normalizarNombre('Lucia,Benitez'), normalizarNombre('BENITEZ, Lucia'));
  assert.equal(normalizarNombre('Domínguez,Ana Paula'), normalizarNombre('Dominguez, Ana Paula'));
});

test('Tesorería: un pago incompleto se devuelve igual con aviso', () => {
  const pagos = parsearTesoreria('1231045 2122075 Perez,Juan juan@x.com 183887 - sin fecha\nEn lote nº 1895\n1231046 2122076 Gomez,Ana ana@x.com 183887 - 2026-10-01 01-10-2026 25-09-2026 Mercado pago Pesos 1000 900 800 No liquidado');
  assert.equal(pagos.length, 2);
  assert.equal(pagos[0].nombre, 'Perez, Juan');
  assert.equal(pagos[0].email, 'juan@x.com');
  assert.equal(pagos[0].loteEl, 1895);
  assert.equal(pagos[0].montoBruto, null);
  assert.match(pagos[0].aviso, /Pago 1231045: no pude leer fechaPago/);
  assert.equal(pagos[1].montoBruto, 1000);
  assert.match(pagos[1].aviso, /no tiene "En lote nº"/);
  assert.deepEqual(parsearTesoreria('Muchas gracias.\nSaludos'), []);
});

test('loteElDesdeArchivo', () => {
  assert.equal(loteElDesdeArchivo('FP.19.EL.20260923.1881_21760.txt'), 1881);
  assert.equal(loteElDesdeArchivo('FP.9.EL.20250613.1684.txt'), 1684);
  assert.equal(loteElDesdeArchivo('C:\\inetpub\\SCI\\ELEARNING\\MERCADOPAGO\\PENDIENTE\\FP.9.EL.20250613.1684.txt'), 1684);
  assert.equal(loteElDesdeArchivo('MP.SCEU.20260901.txt'), null);
  assert.equal(loteElDesdeArchivo(''), null);
});

test('código de barras de 40 dígitos: ID y fechas julianas (informativo)', () => {
  assert.deepEqual(desglosarCodigoBarras('0937022999990026283000948906999900262890'), { id: '948906', fechas: ['10/10/2026', '16/10/2026'] });
  assert.equal(desglosarCodigoBarras('518985'), null);
});

test('la query acepta líneas de comentario "--"', () => {
  const filas = parsearQuery(fx('lote-21852-query.tsv'));
  assert.equal(filas.length, 5);
  assert.equal(filas[0].PNP_Id, '12467');
});

// ---------------------------------------------------------------------------
// Cruce
// ---------------------------------------------------------------------------

test('cruce sin query: Herrera = suma de 2 pagos (alta), sugerencia de lote EL y aviso de la query para los B2', () => {
  const m = analizar({ texto: fx('lote-21852.txt'), tesoreria: fx('tesoreria-johanna.txt') });
  assert.equal(m.tipo, 'pnp');
  const herrera = m.pnps.find((p) => p.idKey === '12468');
  const r = herrera.tesoreria;
  assert.equal(r.estado, 'cruzado');
  assert.equal(r.confianza, 'alta');
  assert.ok(r.suma);
  assert.deepEqual(r.pagos.map((x) => x.idPago), ['1232541', '1232542']);
  assert.ok(r.razones.includes('nombre coincide'));
  assert.ok(r.razones.some((t) => t.startsWith('monto 184.866 = 2 × 92.433')));
  assert.match(herrera.avisoSuma, /^El monto pagado \(184\.866\) es la suma de 2 pagos de 92\.433 de la misma orden: pagó dos cuotas en un mismo pago\.$/);
  // No pisa el nombre del error; completa el mail.
  assert.equal(herrera.fuentes.nombre, 'error');
  assert.equal(herrera.campos.email, 'nicolash831@example.com');
  assert.equal(herrera.fuentes.email, 'tesoreria');

  assert.deepEqual(m.tesoreria.sugerencias.map((s) => [s.lote.num, s.loteEl, s.pnpId]), [[21852, 1893, '00012468']]);
  assert.ok(m.avisos.some((a) => /lote SCI 00021852 parece ser el lote EL 1893/.test(a.texto)));

  const b2 = m.pnps.filter((p) => p.tipo === 'B2');
  assert.equal(b2.length, 4);
  b2.forEach((p) => assert.equal(p.tesoreria, null));
  assert.ok(m.avisos.some((a) => /00012467, 00012469, 00012470 y 00012471 \(no existe la cuota\) no traen monto ni fecha de pago: hace falta la query/.test(a.texto)));
  // La query de "Datos faltantes" sale con el WHERE completado.
  const s = salidasPnp(m, CTX);
  assert.match(s.query, /WHERE pnp\.LoteId = 21852;$/);
  // Los demás pagos quedan "sin cruzar (falta la query)", no "sin PNP".
  assert.equal(m.tesoreria.filas.filter((f) => f.estado === 'sin_datos').length, 14);
});

test('cruce: aceptar la sugerencia de lote EL filtra los pagos de otros lotes', () => {
  const m = analizar({
    texto: fx('lote-21852.txt'),
    tesoreria: fx('tesoreria-johanna.txt'),
    overrides: { lotes: { 21852: { loteEl: '1893' } } },
  });
  assert.equal(m.lotes[0].loteEl, 1893);
  assert.equal(m.lotes[0].fuente.loteEl, 'sugerencia');
  assert.deepEqual(m.tesoreria.sugerencias, []);
  assert.ok(m.pnps.find((p) => p.idKey === '12468').tesoreria.razones.includes('mismo lote EL 1893'));
  // Con los B2 todavía sin monto, solo los pagos de otros lotes quedan "sin PNP".
  const estados = Object.fromEntries(m.tesoreria.filas.map((f) => [f.pago.idPago, f.estado]));
  assert.equal(estados['1231045'], 'sin_pnp');   // lote 1895
  assert.equal(estados['1236361'], 'sin_datos'); // lote 1893
});

test('cruce con query (datos ficticios): cada B2 toma nombre y mail de Tesorería; el pago que sobra queda sin PNP', () => {
  const m = analizar({ texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv'), tesoreria: fx('tesoreria-johanna.txt') });
  assert.equal(m.lotes[0].loteEl, 1893);
  const esperado = {
    12467: ['1159269', 'PAREDES, JOAQUIN', 'calidad@empresa-ejemplo.com.ar'],
    12469: ['1236361', 'Acosta, Federico', 'federico.acosta@example.com'],
    12470: ['1238886', 'Sosa, Gabriel Andres', 'gsosa@empresa-ejemplo.com.ar'],
    12471: ['1243651', 'Rios, Florencia', 'rrhh@otra-empresa.com.ar'],
  };
  for (const [id, [pago, nombre, email]] of Object.entries(esperado)) {
    const p = m.pnps.find((x) => x.idKey === id);
    assert.equal(p.tesoreria.estado, 'cruzado', id);
    assert.equal(p.tesoreria.confianza, 'alta', id);
    assert.deepEqual(p.tesoreria.pagos.map((x) => x.idPago), [pago]);
    assert.equal(p.campos.nombre, nombre);
    assert.equal(p.fuentes.nombre, 'tesoreria');
    assert.equal(p.campos.email, email);
    assert.equal(p.fuentes.email, 'tesoreria');
    assert.equal(p.fuentes.montoPagado, 'query'); // nunca se pisa la query
    assert.equal(p.faltaNombreB2, false);
    assert.ok(m.avisos.some((a) => a.texto === `PNP ${p.id}: nombre tomado del mensaje de Tesorería (pago ${pago}, lote EL 1893).`));
  }
  const herrera = m.pnps.find((x) => x.idKey === '12468');
  assert.deepEqual(herrera.tesoreria.pagos.map((x) => x.idPago), ['1232541', '1232542']);
  assert.equal(herrera.fuentes.nombre, 'query');

  const estados = Object.fromEntries(m.tesoreria.filas.map((f) => [f.pago.idPago, f.estado]));
  assert.equal(estados['1244508'], 'sin_pnp'); // lopez: el pago del lote 1893 que sobra
  assert.equal(Object.values(estados).filter((e) => e === 'cruzado').length, 6);
  assert.equal(Object.values(estados).filter((e) => e === 'sin_pnp').length, 10);
});

test('ambigüedad: dos pagos con mismo monto, fecha y lote contra un solo PNP → no se asigna', () => {
  const pagos = parsearTesoreria(fx('tesoreria-johanna.txt')).filter((x) => ['1228688', '1229045'].includes(x.idPago));
  const query = [
    'PNP_Id\tLote_Id\tEntidadRecaudadora\tNombreArchivo\tError\tCodigoBarras\tFechaPago\tMontoPagado',
    '99001\t29999\tMercado Pago\tFP.1.EL.20261001.1894_29999.txt\tNo existe una Cuota para el Código 0937022999990026283000900000999900262890\t0937022999990026283000900000999900262890\t22/09/2026\t180039.00',
  ].join('\n');
  const m = analizar({ query, overrides: {} });
  const r = cruzarTesoreria(m.pnps, pagos, m.lotes);
  const p = r.porPnp['99001'];
  assert.equal(p.estado, 'ambiguo');
  assert.equal(p.candidatos.length, 2);
  assert.deepEqual(r.filas.map((f) => f.estado), ['ambiguo', 'ambiguo']);

  // Integrado: no completa nada y la respuesta queda en borrador.
  const texto = pagos.map((x) => x.crudo).join('\n') + '\nEn lote nº 1894';
  const m2 = analizar({ query, tesoreria: texto });
  assert.equal(m2.pnps[0].tesoreria.estado, 'ambiguo');
  assert.equal(m2.pnps[0].campos.nombre, '');
  const resp = respuestaTesoreria(m2, CTX);
  assert.ok(resp.borrador);
  assert.match(resp.texto, /ROMERO, SOFIA — \$180\.039 \(22\/09\/2026, lote 1894\): puede corresponder al PNP 99001, pero hay otro pago/);

  // "Usar este pago" fija la elección.
  const m3 = analizar({ query, tesoreria: texto, overrides: { pnps: { 99001: { pagosTesoreria: ['1229045'] } } } });
  assert.equal(m3.pnps[0].tesoreria.estado, 'cruzado');
  assert.ok(m3.pnps[0].tesoreria.manual);
  assert.equal(m3.pnps[0].campos.nombre, 'Castro, Martin');
});

test('confianza media: no completa solo; al elegirlo a mano sí', () => {
  // Sin archivo (lote EL desconocido): monto + fecha = media.
  const query = 'PNP_Id\tLote_Id\tError\tCodigoBarras\tFechaPago\tMontoPagado\n99002\t29998\tNo existe una Cuota para el Código 0937022999990026283000900001999900262890\t0937022999990026283000900001999900262890\t25/09/2026\t80000';
  const m = analizar({ query, tesoreria: fx('tesoreria-johanna.txt') });
  const p = m.pnps[0];
  assert.equal(p.tesoreria.estado, 'cruzado');
  assert.equal(p.tesoreria.confianza, 'media');
  assert.equal(p.campos.nombre, '');
  assert.ok(p.faltaNombreB2);
  const m2 = analizar({ query, tesoreria: fx('tesoreria-johanna.txt'), overrides: { pnps: { 99002: { pagosTesoreria: ['1231045'] } } } });
  assert.equal(m2.pnps[0].campos.nombre, 'Ferraro, Camila');
  assert.equal(m2.pnps[0].fuentes.nombre, 'tesoreria');
});

test('un pago de Tesorería no queda en dos PNP', () => {
  const query = [
    'PNP_Id\tLote_Id\tNombreArchivo\tError\tCodigoBarras\tFechaPago\tMontoPagado',
    '99003\t29997\tFP.1.EL.20261001.1895_29997.txt\tNo existe una Cuota para el Código 0937022999990026283000900002999900262890\t0937022999990026283000900002999900262890\t25/09/2026\t80000',
    '99004\t29997\tFP.1.EL.20261001.1895_29997.txt\tNo existe una Cuota para el Código 0937022999990026283000900003999900262890\t0937022999990026283000900003999900262890\t25/09/2026\t80000',
  ].join('\n');
  const m = analizar({ query, tesoreria: fx('tesoreria-johanna.txt') });
  assert.deepEqual(m.pnps.map((p) => p.tesoreria && p.tesoreria.estado), ['ambiguo', 'ambiguo']);
  assert.equal(m.tesoreria.filas.find((f) => f.pago.idPago === '1231045').estado, 'ambiguo');
});

test('solo el mensaje de Tesorería → "Pedido de Tesorería" con la query para buscar los PNP', () => {
  const m = analizar({ tesoreria: fx('tesoreria-johanna-plano.txt') });
  assert.equal(m.tipo, 'tesoreria');
  assert.equal(m.pnps.length, 0);
  assert.ok(m.tesoreria.filas.every((f) => f.estado === 'sin_datos'));
  const s = salidasPnp(m, CTX);
  assert.match(s.diagnostico, /^Pedido de Tesorería/);
  assert.equal(s.faltantes, null);
  assert.equal(s.tesoreria.respuesta, null);
  assert.ok(s.tesoreria.query);
  // Pegado en el cuadro 1 también se reconoce.
  const m2 = analizar({ texto: fx('tesoreria-johanna.txt') });
  assert.equal(m2.tipo, 'tesoreria');
  assert.ok(m2.avisos.some((a) => /cuadro 1 parece el mensaje de Tesorería/.test(a.texto)));
});

test('query de Tesorería: lotes EL, montos sueltos y sumas por orden', () => {
  const pagos = parsearTesoreria(fx('tesoreria-johanna.txt'));
  assert.deepEqual(gruposSuma(pagos).map((g) => [g.monto, g.loteEl, g.pagos.length]), [[184866, 1893, 2]]);
  const q = queryTesoreria(pagos);
  for (const n of [1892, 1893, 1894, 1895]) assert.ok(q.includes(`l.NombreArchivo LIKE '%.EL.%.${n}[_.]%'`), n);
  assert.match(q, /AND pnp\.Monto IN \(52038, 80000, 92433, 110000, 180039, 184866, 191261, 194454, 206224, 217489, 229235, 242000, 300890, 725000\)\nORDER BY pnp\.LoteId, pnp\.Id;$/);
  assert.match(q, /FROM SciLotePagoNoProcesable pnp\nLEFT JOIN SciLote l {24}ON l\.Id = pnp\.LoteId/);
});

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

test('respuesta a Tesorería: borrador con huecos mientras falta revisar en SCI', () => {
  const m = analizar({ texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv'), tesoreria: fx('tesoreria-johanna.txt') });
  const r = respuestaTesoreria(m, { fecha: '29/10/2026' });
  assert.ok(r.borrador);
  assert.ok(r.texto.startsWith('Hola Johanna,\n\nTe paso el estado de los pagos que nos enviaste:\n\n- Ferraro, Camila — $80.000 (25/09/2026, lote 1895): no encontramos el PNP en los lotes revisados. Lo seguimos buscando.\n'));
  assert.match(r.texto, /\n- Herrera, Nicolas — 2 pagos de \$92\.433 \(29\/09\/2026, lote 1893\): PNP 00012468\. El monto pagado no coincide con la cuota; se informó a E-Learning \(ticket <NÚMERO>\)\. Queda pendiente\.\n/);
  assert.match(r.texto, /\n- Acosta, Federico — \$194\.454 \(02\/10\/2026, lote 1893\): PNP 00012469\. El pago apunta a una cuota inexistente; se informó a E-Learning \(ticket <NÚMERO>\)\. Queda pendiente\.\n/);
  assert.match(r.texto, /\n- Navarro, Pablo Ezequiel — \$242\.000 \(07\/10\/2026, lote 1892\): no encontramos el PNP en los lotes revisados\. Lo seguimos buscando\.\n/);
  assert.ok(r.texto.endsWith('\n\nSaludos,\n<FIRMA>'));
  assert.equal(r.texto.match(/^- /gm).length, 15); // Herrera: 2 pagos en una línea

  const cobrado = analizar({
    texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv'), tesoreria: fx('tesoreria-johanna.txt'),
    overrides: { pnps: { 12468: { decision: 'si' } } },
  });
  assert.match(respuestaTesoreria(cobrado, CTX).texto, /PNP 00012468\. Se cobró manualmente\. Recibo <NRO_RECIBO>\./);
});

test('respuesta a Tesorería: versión completa sin huecos', () => {
  const lote1893 = fx('tesoreria-johanna.txt').split('1159269 2027515')[1].split('1244349')[0];
  const m = analizar({
    texto: fx('lote-21852.txt'),
    query: fx('lote-21852-query.tsv'),
    tesoreria: `1159269 2027515${lote1893}`,
    overrides: {
      pnps: {
        12467: { decision: 'no' }, 12469: { decision: 'no' }, 12470: { decision: 'no' }, 12471: { decision: 'no' },
        12468: { decision: 'si', recibo: '00031234/2026' },
      },
    },
  });
  const r = respuestaTesoreria(m, { ...CTX, ticketNro: '123456' });
  assert.equal(r.borrador, false);
  assert.equal(r.texto, [
    'Hola Johanna,',
    '',
    'Te paso el estado de los pagos que nos enviaste:',
    '',
    '- PAREDES, JOAQUIN — $191.261 (22/07/2026, lote 1893): PNP 00012467. El pago apunta a una cuota inexistente; se informó a E-Learning (ticket 123456). Queda pendiente.',
    '- Herrera, Nicolas — 2 pagos de $92.433 (29/09/2026, lote 1893): PNP 00012468. Se cobró manualmente. Recibo 00031234/2026.',
    '- Acosta, Federico — $194.454 (02/10/2026, lote 1893): PNP 00012469. El pago apunta a una cuota inexistente; se informó a E-Learning (ticket 123456). Queda pendiente.',
    '- Sosa, Gabriel Andres — $217.489 (05/10/2026, lote 1893): PNP 00012470. El pago apunta a una cuota inexistente; se informó a E-Learning (ticket 123456). Queda pendiente.',
    '- Rios, Florencia — $229.235 (08/10/2026, lote 1893): PNP 00012471. El pago apunta a una cuota inexistente; se informó a E-Learning (ticket 123456). Queda pendiente.',
    '- vega, Matias — $206.224 (15/10/2026, lote 1893): no encontramos el PNP en los lotes revisados. Lo seguimos buscando.',
    '',
    'Saludos,',
    'Juana Pérez',
    'Soporte de Aplicaciones',
  ].join('\n'));
  assert.doesNotMatch(r.texto, /<[A-ZÚ_]+>|\[COMPLETAR/);
});

test('ticket a E-Learning: "Mail inscripto" solo si hay mail', () => {
  const m = analizar({ texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv'), tesoreria: fx('tesoreria-johanna.txt') });
  const t = ticketElearning(m.lotes[0], m.pnps).descripcion;
  assert.match(t, /Nombre inscripto: Acosta, Federico\nMail inscripto: federico\.acosta@example\.com\n/);
  assert.match(t, /Nombre inscripto: Herrera, Nicolas\nMail inscripto: nicolash831@example\.com\nConcepto Ingreso: Curso ficticio de test/);
  const sinTes = analizar({ texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv') });
  assert.doesNotMatch(ticketElearning(sinTes.lotes[0], sinTes.pnps).descripcion, /Mail inscripto/);
});

test('mail al coordinador: "Mail inscripto" opcional', () => {
  const con = analizar({ texto: fx('pnp-10703-cuota-impactada.txt'), overrides: { pnps: { 10703: { decision: 'c', email: 'equipo@ejemplo.com' } } } });
  const t = mailCoordinador(con.lotes[0], 'SAE', con.pnps, CTX);
  assert.match(t, /Número de documento: \[COMPLETAR: Número de documento\]\nMail inscripto: equipo@ejemplo\.com\nConcepto Ingreso/);
  const sin = analizar({ texto: fx('pnp-10703-cuota-impactada.txt'), overrides: { pnps: { 10703: { decision: 'c' } } } });
  assert.doesNotMatch(mailCoordinador(sin.lotes[0], 'SAE', sin.pnps, CTX), /Mail inscripto/);
});

test('SNAPSHOT: ticket a E-Learning sin cambios cuando no hay mensaje de Tesorería', () => {
  const m = analizar({
    texto: fx('el-21760.txt'),
    query: fx('el-21760-query.tsv'),
    tesoreria: '',
    overrides: { pnps: { 12402: { nombre: 'Ruiz Ortega, Micaela Belen' } } },
  });
  assert.equal(m.tesoreria, undefined);
  const s = salidasPnp(m, CTX);
  assert.equal(s.tesoreria, null);
  assert.equal(s.ticketsEL[0].descripcion, fx('el-21760-ticket-esperado.txt').replace(/\n$/, ''));
  assert.doesNotMatch(s.nota, /Tesorería/);
});

test('nota interna: una línea por PNP cruzado', () => {
  const m = analizar({ texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv'), tesoreria: fx('tesoreria-johanna.txt') });
  const n = notaInterna(m.pnps, CTX);
  assert.match(n, /\nPNP 00012469: datos completados con el mensaje de Tesorería \(pago 1236361, lote EL 1893\)\./);
  assert.match(n, /\nPNP 00012468: datos completados con el mensaje de Tesorería \(pagos 1232541 y 1232542, lote EL 1893\)\./);
  const sinQuery = analizar({ texto: fx('lote-21852.txt'), tesoreria: fx('tesoreria-johanna.txt') });
  assert.match(notaInterna(sinQuery.pnps, CTX), /PNP 00012468: datos completados con el mensaje de Tesorería \(pagos 1232541 y 1232542, lote EL 1893\)\.$/);
});

test('tabla de cruce en TSV', () => {
  const m = analizar({
    texto: fx('lote-21852.txt'), query: fx('lote-21852-query.tsv'), tesoreria: fx('tesoreria-johanna.txt'),
    overrides: { pnps: { 12468: { decision: 'si', recibo: '00031234/2026' }, 12469: { decision: 'no' } } },
  });
  const filas = tablaCruceTsv(m, CTX).split('\n');
  assert.equal(filas.length, 17);
  assert.equal(filas[0], 'ID pago\tNombre\tFecha de pago\tMonto\tLote EL\tPNP\tLote SCI\tCaso\tConfianza\tRazones\tEstado');
  const herrera = filas.find((f) => f.startsWith('1232541\t')).split('\t');
  assert.deepEqual([herrera[5], herrera[6], herrera[7], herrera[8], herrera[10]], ['00012468', '00021852', 'B1', 'alta', 'Cobrado con recibo 00031234/2026']);
  assert.equal(filas.find((f) => f.startsWith('1236361\t')).split('\t')[10], 'Derivado a E-Learning');
  assert.equal(filas.find((f) => f.startsWith('1159269\t')).split('\t')[10], 'Pendiente (sin revisar en SCI)');
  assert.equal(filas.find((f) => f.startsWith('1244508\t')).split('\t')[10], 'Sin PNP en este ticket');
});
