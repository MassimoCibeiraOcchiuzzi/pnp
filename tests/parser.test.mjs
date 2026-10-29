import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectarTipo, extraerLote, extraerInfoLote, extraerErrorLote, parsearFilasPnp,
  extraerDatosError, parsearQuery, parseNumero, formatMonto, formatFecha, parseFecha,
  sumarDiasHabiles, tieneMojibake, extraerPistasUsuario,
} from '../src/parser.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('detecta el tipo de ticket', () => {
  assert.equal(detectarTipo(fx('notificacion-1684.txt')), 'notificacion');
  assert.equal(detectarTipo(fx('error-lote-20457.txt')), 'error_lote');
  assert.equal(detectarTipo(fx('error-lote-20472.txt')), 'error_lote');
  assert.equal(detectarTipo(fx('error-lote-10656.txt')), 'error_lote');
  assert.equal(detectarTipo(fx('pnp-10102-monto.txt')), 'pnp');
  assert.equal(detectarTipo(fx('el-21760.txt')), 'pnp');
  assert.equal(detectarTipo(fx('usuario-comprobante.txt')), 'usuario');
  assert.equal(detectarTipo('   '), 'vacio');
});

test('error de lote pegado sin el asunto se detecta igual', () => {
  const cuerpo = fx('error-lote-20472.txt').split('\n').slice(2).join('\n');
  assert.equal(detectarTipo(cuerpo), 'error_lote');
});

test('extrae el ID de lote conservando ceros', () => {
  assert.deepEqual(extraerLote(fx('error-lote-20457.txt')), { raw: '00020457', num: 20457, id8: '00020457' });
  assert.deepEqual(extraerLote(fx('notificacion-1684.txt')), { raw: '00001684', num: 1684, id8: '00001684' });
  assert.equal(extraerLote('Nro. Lote: 1684').id8, '00001684');
});

test('extrae entidad y archivo de la notificación', () => {
  const info = extraerInfoLote(fx('notificacion-1684.txt'));
  assert.equal(info.entidad, 'Mercado Pago');
  assert.equal(info.archivo, 'FP.9.EL.20250613.1684.txt');
  assert.equal(info.estado, 'PENDIENTE');
});

test('extrae el error de lote y la cuota mencionada', () => {
  const e = extraerErrorLote(fx('error-lote-20457.txt'));
  assert.equal(e.error, 'Hay más de un registro con el mismo id/codigo de barras en el archivo. Cuota: 0937022999990025130000877393999900251298');
  assert.equal(e.codigoMencionado, '0937022999990025130000877393999900251298');
  assert.equal(extraerErrorLote(fx('error-lote-20472.txt')).error, 'Object reference not set to an instance of an object.');
});

const ESPERADO_3 = [
  {
    nro: '00010102',
    codigo: '0937022999990024101000830173999900241038',
    error: 'El monto pagado (109569) no coincide con el monto de la Cuota (142566,0000) ni el monto de pronto pago (142566,0000) Alumno: Peralta , Julián Andrés Sub Concepto Ingreso: 1564',
  },
  {
    nro: '00010703',
    codigo: '847390',
    error: 'La Cuota (847390) ya se encuentra asociada al Recibo 00024675/2024 (Id = 437464) Alumno: Equipo de fútbol - Tercer Tiempo Sub Concepto Ingreso: clausura 24',
  },
  {
    nro: '00010840',
    codigo: '0937022999990024315000864369999900243203',
    error: 'No existe una Cuota para el Código 0937022999990024315000864369999900243203',
  },
];

for (const f of ['formato-tabs.txt', 'formato-espacios.txt', 'formato-una-linea.txt']) {
  test(`parsea las 3 filas en ${f}`, () => {
    assert.deepEqual(parsearFilasPnp(fx(f)), ESPERADO_3);
  });
}

test('parsea un error desconocido con el separador genérico', () => {
  const filas = parsearFilasPnp(fx('b4-desconocido.txt'));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nro, '00011987');
  assert.equal(filas[0].error, 'La inscripción asociada a la cuota se encuentra dada de baja');
});

test('parsea errores desconocidos mezclados con conocidos', () => {
  const t = '00000001 0937022999990025440000881234999900254412 Error raro uno 00000002 518985 No existe una Cuota para el Código 518985 00000003 0937022999990025440000881234999900254499 Otro error raro';
  const filas = parsearFilasPnp(t);
  assert.deepEqual(filas.map((f) => [f.nro, f.error]), [
    ['00000001', 'Error raro uno'],
    ['00000002', 'No existe una Cuota para el Código 518985'],
    ['00000003', 'Otro error raro'],
  ]);
});

test('extrae datos de B1', () => {
  const d = extraerDatosError(ESPERADO_3[0].error);
  assert.equal(d.tipo, 'B1');
  assert.equal(d.montoPagado, 109569);
  assert.equal(d.montoCuota, 142566);
  assert.equal(d.montoProntoPago, 142566);
  assert.equal(d.alumno, 'Peralta, Julián Andrés');
  assert.equal(d.subconcepto, '1564');
  assert.equal(d.errorCorto, 'El monto pagado (109569) no coincide con el monto de la Cuota (142566,0000) ni el monto de pronto pago (142566,0000)');
});

test('extrae datos de B2 y B3', () => {
  const b2 = extraerDatosError(ESPERADO_3[2].error);
  assert.equal(b2.tipo, 'B2');
  assert.equal(b2.codigoError, '0937022999990024315000864369999900243203');
  const b3 = extraerDatosError(ESPERADO_3[1].error);
  assert.equal(b3.tipo, 'B3');
  assert.equal(b3.cuotaId, '847390');
  assert.equal(b3.recibo, '00024675/2024');
  assert.equal(b3.reciboId, '437464');
  assert.equal(b3.alumno, 'Equipo de fútbol - Tercer Tiempo');
  assert.equal(b3.subconcepto, 'clausura 24');
});

test('parsea la query en TSV con NULL', () => {
  const filas = parsearQuery(fx('el-21760-query.tsv'));
  assert.equal(filas.length, 2);
  assert.equal(filas[0].PNP_Id, '12401');
  assert.equal(filas[0].NombreInscripto, 'Fernandez Aguirre, Bruno Ignacio');
  assert.equal(filas[0].DNI, '');
  assert.equal(filas[1].ConceptoIngreso, '');
  assert.equal(filas[1].FechaPago, '22/07/2026');
});

test('parsea la query con ; y con , (comillas)', () => {
  const tsv = fx('el-21760-query.tsv').trim().split('\n');
  const conPuntoYComa = tsv.map((l) => l.split('\t').join(';')).join('\n');
  assert.equal(parsearQuery(conPuntoYComa)[0].PlanPago, '$222000 en un pago completo en pesos');
  const csv = tsv.map((l) => l.split('\t').map((v) => (/[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
  const filas = parsearQuery(csv);
  assert.equal(filas[0].NombreInscripto, 'Fernandez Aguirre, Bruno Ignacio');
  assert.equal(filas[0].PlanPago, '$222000 en un pago completo en pesos');
});

test('query sin encabezados usa el orden de columnas', () => {
  const sinCab = fx('el-21760-query.tsv').trim().split('\n').slice(1).join('\n');
  assert.equal(parsearQuery(sinCab)[1].MontoPagado, '262682.00');
});

test('números y montos', () => {
  assert.equal(parseNumero('166500'), 166500);
  assert.equal(parseNumero('129550,0000'), 129550);
  assert.equal(parseNumero('166500.00'), 166500);
  assert.equal(parseNumero('166.500'), 166500);
  assert.equal(parseNumero('1.234,50'), 1234.5);
  assert.equal(parseNumero('NULL'), null);
  assert.equal(formatMonto(166500), '166.500');
  assert.equal(formatMonto(1234.5), '1.234,50');
  assert.equal(formatMonto(262682), '262.682');
  assert.equal(formatMonto(999), '999');
  assert.equal(formatMonto(1000000), '1.000.000');
});

test('fechas y días hábiles', () => {
  assert.equal(formatFecha('2026-07-21'), '21/07/2026');
  assert.equal(formatFecha('1/7/2026'), '01/07/2026');
  assert.equal(formatFecha(new Date(2026, 9, 21)), '21/10/2026');
  assert.equal(parseFecha('31/02/2026'), null);
  // miércoles 21/10/2026 + 5 hábiles = miércoles 28/10/2026
  assert.equal(formatFecha(sumarDiasHabiles(parseFecha('21/10/2026'), 5)), '28/10/2026');
  // viernes 23/10/2026 + 5 hábiles = viernes 30/10/2026
  assert.equal(formatFecha(sumarDiasHabiles(parseFecha('23/10/2026'), 5)), '30/10/2026');
  // sábado 24/10/2026 + 1 hábil = lunes 26/10/2026
  assert.equal(formatFecha(sumarDiasHabiles(parseFecha('24/10/2026'), 1)), '26/10/2026');
});

test('detecta mojibake', () => {
  assert.equal(tieneMojibake('MuÃ±oz , MarÃ­a Sol'), true);
  assert.equal(tieneMojibake('Peralta , Julián Andrés'), false);
  assert.equal(tieneMojibake('Pe�a'), true);
});

test('pistas del ticket de usuario', () => {
  assert.deepEqual(extraerPistasUsuario(fx('usuario-comprobante.txt')), { dni: '38456789', fecha: '15/09/2026', monto: 129550 });
});
