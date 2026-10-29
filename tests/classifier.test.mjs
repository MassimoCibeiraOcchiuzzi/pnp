import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analizar, clasificarError, detectarArea, resolverAccion, clasificarErrorLote, detectarDuplicados,
} from '../src/classifier.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('clasifica B1/B2/B3/B4 y sub-casos de B2', () => {
  assert.equal(clasificarError('El monto pagado (1) no coincide con el monto de la Cuota (2) ni el monto de pronto pago (2)').tipo, 'B1');
  assert.equal(clasificarError('No existe una Cuota para el Código 0937022999990024315000864369999900243203').sub, 'largo');
  assert.equal(clasificarError('No existe una Cuota para el Código 518985').sub, 'corto');
  assert.equal(clasificarError('No existe una Cuota para el Código 0000000000000000').sub, 'ceros');
  assert.equal(clasificarError('La Cuota (847390) ya se encuentra asociada al Recibo 00024675/2024 (Id = 437464)').tipo, 'B3');
  assert.equal(clasificarError('Cualquier otra cosa').tipo, 'B4');
});

test('área dueña: archivo primero, después palabras clave', () => {
  assert.equal(detectarArea({ archivo: 'FP.19.EL.20260923.1881_21760.txt' }).key, 'EL');
  assert.equal(detectarArea({ archivo: 'MP.SCEU.20260901.txt' }).key, 'SCEU');
  assert.equal(detectarArea({ archivo: 'FP.19.EL.x.txt', concepto: 'Maestría en X' }).key, 'EL');
  assert.equal(detectarArea({ alumno: 'Equipo de fútbol - Tercer Tiempo' }).key, 'SAE');
  assert.equal(detectarArea({ alumno: 'Equipo de futbol - X' }).key, 'SAE');
  assert.equal(detectarArea({ concepto: 'Tecnicatura TSNB' }).key, 'TSNB');
  assert.equal(detectarArea({ concepto: 'Maestría en Ingeniería' }).key, 'POSGRADO');
  assert.equal(detectarArea({ concepto: 'Curso APM 2026' }).key, 'APM');
  assert.equal(detectarArea({ concepto: 'Curso de Seguridad e Higiene' }).key, 'SEGURIDAD');
  assert.equal(detectarArea({ concepto: 'Diplomatura en Relaciones Internacionales' }).key, null);
});

test('acciones según decisión', () => {
  assert.deepEqual(resolverAccion({ tipo: 'B1' }, 'pendiente'), { tipo: 'derivar', motivo: 'montos', borrador: true });
  assert.deepEqual(resolverAccion({ tipo: 'B1' }, 'si'), { tipo: 'cobro_manual' });
  assert.deepEqual(resolverAccion({ tipo: 'B1' }, 'no'), { tipo: 'derivar', motivo: 'montos', borrador: false });
  assert.deepEqual(resolverAccion({ tipo: 'B2', sub: 'corto' }), { tipo: 'irresoluble' });
  assert.deepEqual(resolverAccion({ tipo: 'B2', sub: 'ceros' }), { tipo: 'registro' });
  assert.deepEqual(resolverAccion({ tipo: 'B2', sub: 'largo' }, 'no'), { tipo: 'derivar', motivo: 'cuota_inexistente', borrador: false });
  assert.deepEqual(resolverAccion({ tipo: 'B3' }, 'a'), { tipo: 'cobro_manual' });
  assert.equal(resolverAccion({ tipo: 'B3' }, 'b').motivo, 'cuotas_anteriores');
  assert.equal(resolverAccion({ tipo: 'B3' }, 'c').motivo, 'sin_cuotas');
  assert.equal(resolverAccion({ tipo: 'B3' }, 'd').motivo, 'montos');
  assert.equal(resolverAccion({ tipo: 'B3' }, 'pendiente').borrador, true);
  assert.deepEqual(resolverAccion({ tipo: 'B4' }), { tipo: 'soporte' });
});

test('errores de lote', () => {
  assert.equal(clasificarErrorLote('Hay más de un registro con el mismo id/codigo de barras en el archivo.').id, 'duplicados');
  assert.equal(clasificarErrorLote('Object reference not set to an instance of an object.').id, 'object_reference');
  assert.equal(clasificarErrorLote('La cantidad de comprobantes procesados no coincide con …').id, 'cantidad_importes');
  assert.equal(clasificarErrorLote('La fecha pertenece a un período cerrado').id, 'periodo_cerrado');
  assert.equal(clasificarErrorLote('La inscripción no presenta deuda').id, 'cuotas_pagas');
  assert.equal(clasificarErrorLote('Archivo sin contenido. Ver comprobante linea: 0').id, 'sin_contenido');
  assert.equal(clasificarErrorLote('Algo nuevo').id, 'otro');
});

test('detector de duplicados = awk | sort | uniq -d', () => {
  assert.deepEqual(detectarDuplicados(fx('archivo-lote-duplicados.txt')), [
    '0937022999990025130000877393999900251298',
    '0937022999990025130000877455999900251322',
  ]);
  assert.deepEqual(detectarDuplicados('a\r\nb\r\n\r\n'), []);
});

test('analizar: notificación', () => {
  const m = analizar({ texto: fx('notificacion-1684.txt') });
  assert.equal(m.tipo, 'notificacion');
  assert.equal(m.loteTexto.id8, '00001684');
});

test('analizar: error de lote', () => {
  const m = analizar({ texto: fx('error-lote-20457.txt') });
  assert.equal(m.tipo, 'error_lote');
  assert.equal(m.errorLote.caso.id, 'duplicados');
  assert.equal(m.errorLote.lote.num, 20457);
});

test('analizar: B3 Equipo de fútbol → SAE', () => {
  const m = analizar({ texto: fx('pnp-10703-cuota-impactada.txt') });
  assert.equal(m.pnps.length, 1);
  const p = m.pnps[0];
  assert.equal(p.tipo, 'B3');
  assert.equal(p.area.key, 'SAE');
  assert.equal(p.accion.motivo, 'b3_pendiente');
});

test('analizar: B1 sin query → área indeterminada y faltantes', () => {
  const m = analizar({ texto: fx('pnp-10102-monto.txt') });
  const p = m.pnps[0];
  assert.equal(p.tipo, 'B1');
  assert.equal(p.area.key, null);
  assert.equal(p.areaIndeterminada, true);
  assert.equal(p.campos.montoPagado, 109569);
  assert.equal(p.campos.nombre, 'Peralta, Julián Andrés');
  assert.deepEqual(p.faltantes, ['fechaPago', 'concepto', 'planPago']);
  assert.deepEqual(m.lotes[0].faltantes, ['archivo', 'entidad']);
  assert.ok(m.avisos.some((a) => /indeterminada/.test(a.texto)));
});

test('analizar: irresoluble no pide datos', () => {
  const m = analizar({ texto: fx('pnp-518985-irresoluble.txt') });
  assert.equal(m.pnps[0].accion.tipo, 'irresoluble');
  assert.deepEqual(m.pnps[0].faltantes, []);
  assert.deepEqual(m.lotes[0].faltantes, []);
});

test('analizar: mojibake', () => {
  const m = analizar({ texto: fx('mojibake.txt') });
  assert.equal(m.pnps[0].mojibake, true);
  assert.ok(m.avisos.some((a) => /caracteres rotos/.test(a.texto)));
});

test('analizar: B4', () => {
  const m = analizar({ texto: fx('b4-desconocido.txt') });
  assert.equal(m.pnps[0].tipo, 'B4');
  assert.equal(m.pnps[0].accion.tipo, 'soporte');
});

test('analizar: lote EL con query matchea por PNP_Id sin ceros', () => {
  const m = analizar({ texto: fx('el-21760.txt'), query: fx('el-21760-query.tsv') });
  assert.equal(m.pnps.length, 2);
  assert.equal(m.lotes.length, 1);
  const L = m.lotes[0];
  assert.equal(L.entidad, 'Mercado Pago');
  assert.equal(L.archivo, 'FP.19.EL.20260923.1881_21760.txt');
  const [b1, b2] = m.pnps;
  assert.equal(b1.area.key, 'EL');
  assert.equal(b1.campos.fechaPago, '21/07/2026');
  assert.equal(b1.campos.nombre, 'Fernandez Aguirre, Bruno Ignacio');
  assert.deepEqual(b1.faltantes, []);
  assert.equal(b2.tipo, 'B2');
  assert.equal(b2.campos.montoPagado, 262682);
  assert.equal(b2.faltaNombreB2, true);
});

test('analizar: match por código de barras cuando el ID no coincide', () => {
  const q = fx('el-21760-query.tsv').replace(/^12401\t/m, '99999\t');
  const m = analizar({ texto: fx('el-21760.txt'), query: q });
  assert.equal(m.pnps.length, 2);
  assert.equal(m.pnps[0].campos.fechaPago, '21/07/2026');
});

test('analizar: overrides manuales ganan', () => {
  const m = analizar({
    texto: fx('pnp-10102-monto.txt'),
    overrides: {
      lotes: { 16079: { entidad: 'Rapipago', archivo: 'MP.SCEU.20260901.txt' } },
      pnps: { 10102: { fechaPago: '01/09/2026', concepto: 'X', planPago: 'Y', dni: '30111222', decision: 'no' } },
    },
  });
  const p = m.pnps[0];
  assert.equal(p.area.key, 'SCEU');
  assert.equal(p.accion.borrador, false);
  assert.deepEqual(p.faltantes, []);
  assert.deepEqual(m.lotes[0].faltantes, []);
  const m2 = analizar({ texto: fx('pnp-10102-monto.txt'), overrides: { pnps: { 10102: { area: 'POSGRADO' } } } });
  assert.equal(m2.pnps[0].area.key, 'POSGRADO');
  assert.equal(m2.pnps[0].area.fuente, 'manual');
});

test('analizar: solo query (sin texto) arma los PNP', () => {
  const m = analizar({ query: fx('el-21760-query.tsv') });
  assert.equal(m.tipo, 'pnp');
  assert.equal(m.pnps.length, 2);
  assert.equal(m.lotes[0].lote.num, 21760);
});
