import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analizar } from '../src/classifier.js';
import {
  salidasPnp, ticketElearning, resumenTicket, mailCoordinador, resolucionPnp, notaInterna,
  armarQuery, textoFaltantes, notaErrorLote, recordatorio, fechaSeguimiento,
} from '../src/templates.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CTX = { fecha: '21/10/2026', firma: 'Juana Pérez\nSoporte de Aplicaciones' };

function modeloEL(extra = {}) {
  return analizar({
    texto: fx('el-21760.txt'),
    query: fx('el-21760-query.tsv'),
    overrides: { pnps: { 12402: { nombre: 'Ruiz Ortega, Micaela Belen' }, ...extra } },
  });
}

test('SNAPSHOT: ticket a E-Learning idéntico al ejemplo de SKILL.md', () => {
  const m = modeloEL();
  const s = salidasPnp(m, CTX);
  assert.equal(s.ticketsEL.length, 1);
  assert.equal(s.ticketsEL[0].descripcion, fx('el-21760-ticket-esperado.txt').replace(/\n$/, ''));
  assert.equal(s.ticketsEL[0].resumen, 'Pagos no procesables en SCI - Montos no coinciden y cuotas inexistentes - FP.19.EL.20260923.1881_21760.txt');
  assert.equal(s.mails.length, 0);
  assert.equal(s.faltantes, null);
});

test('resumen singular', () => {
  const m = modeloEL();
  const L = m.lotes[0];
  assert.equal(resumenTicket(L, [m.pnps[0]]), 'Pago no procesable en SCI - Monto no coincide con la cuota - FP.19.EL.20260923.1881_21760.txt');
});

test('plural cuando el grupo principal tiene varios pagos', () => {
  const m = modeloEL();
  const L = m.lotes[0];
  const b1 = m.pnps[0];
  const otro = { ...b1, id: '00012499', campos: { ...b1.campos } };
  const t = ticketElearning(L, [b1, otro]).descripcion;
  assert.match(t, /tenemos pagos los cuales no se pudieron procesar .* Por lo tanto tampoco los podemos impactar manualmente\./);
  assert.equal(t.match(/^Error: /gm).length, 2);
});

test('motivo principal = el más frecuente', () => {
  const m = modeloEL();
  const [b1, b2] = m.pnps;
  const b2b = { ...b2, id: '00012403' };
  const t = ticketElearning(m.lotes[0], [b1, b2, b2b]).descripcion;
  assert.match(t, /debido a que el pago apunta a un número de cuota inexistente\. Por lo tanto tampoco los podemos/);
  assert.match(t, /Ademas, en el mismo lote, algunos pagos tienen un valor abonado que no coincide con el valor de la cuota\./);
});

test('B2 sin nombre omite la línea; B1 sin datos pone [COMPLETAR]', () => {
  const m = analizar({ texto: fx('el-21760.txt'), overrides: { lotes: { 21760: { archivo: 'FP.19.EL.20260923.1881_21760.txt' } } } });
  const t = salidasPnp(m, CTX).ticketsEL[0].descripcion;
  assert.match(t, /Entidad Recaudadora: \[COMPLETAR: Entidad Recaudadora\]/);
  assert.match(t, /Fecha de pago: \[COMPLETAR: Fecha de pago\]/);
  assert.match(t, /Monto pagado: 166\.500/);
  assert.match(t, /Nombre inscripto: Fernandez Aguirre, Bruno Ignacio/);
  assert.match(t, /Plan Pago: \[COMPLETAR: Plan Pago\]/);
  const bloqueB2 = t.split('Ademas')[1];
  assert.doesNotMatch(bloqueB2, /Nombre inscripto/);
  assert.match(bloqueB2, /Monto pagado: \[COMPLETAR: Monto pagado\]/);
});

test('mail al coordinador (SAE) con CCO, documento y firma', () => {
  const m = analizar({ texto: fx('pnp-10703-cuota-impactada.txt'), overrides: { pnps: { 10703: { decision: 'c' } } } });
  const s = salidasPnp(m, CTX);
  assert.equal(s.ticketsEL.length, 0);
  assert.equal(s.mails.length, 1);
  const t = s.mails[0].texto;
  assert.ok(t.startsWith('Asunto: Pago no Procesable en SCI\nPara: wviscovich@frba.utn.edu.ar\nCCO: soportedeaplicaciones@frba.utn.edu.ar\n\nBuenas tardes,\n\n'));
  assert.match(t, /debido a que el inscripto ya tiene todas las cuotas del curso abonadas \(por lo que correspondería evaluar un reembolso o si se encuentra cursando otro curso\)\./);
  assert.match(t, /Error: La Cuota \(847390\) ya se encuentra asociada al Recibo 00024675\/2024 \(Id = 437464\)\n/);
  assert.match(t, /Nombre inscripto: Equipo de fútbol - Tercer Tiempo\nNúmero de documento: \[COMPLETAR: Número de documento\]/);
  assert.match(t, /SubConcepto Ingreso: clausura 24/);
  assert.ok(t.endsWith('Quedamos al pendiente acerca de cómo proceder en este caso.\n\nSaludos cordiales,\nJuana Pérez\nSoporte de Aplicaciones'));
});

test('mail sin área → destinatario a completar; APM lleva CC', () => {
  const m = analizar({ texto: fx('pnp-10102-monto.txt') });
  const s = salidasPnp(m, {});
  assert.match(s.mails[0].texto, /Para: \[COMPLETAR: destinatario/);
  assert.match(s.mails[0].texto, /\[COMPLETAR: firma\]$/);
  const t = mailCoordinador(m.lotes[0], 'APM', m.pnps, CTX);
  assert.match(t, /Para: mrodriguezgiavarini@frba\.utn\.edu\.ar\nCC: poliveto@frba\.utn\.edu\.ar\nCCO: /);
});

test('resolución 3a / 3b / 3c', () => {
  const m = modeloEL();
  const [b1] = m.pnps;
  assert.deepEqual(resolucionPnp(b1, CTX), {
    pendiente: 'Sí',
    texto: 'No se puede cobrar manualmente (monto pagado no coincide con la cuota). Se comunicó con E-Learning vía ticket en su portal (Jira). Ticket #<NÚMERO> donde se trabaja el PNP: https://atencion.frba.utn.edu.ar/scp/tickets.php?id=<IDTICKET>',
  });
  assert.match(resolucionPnp(b1, { ...CTX, ticketNro: '123456', ticketId: '98765' }).texto, /Ticket #123456 donde se trabaja el PNP: https:\/\/atencion\.frba\.utn\.edu\.ar\/scp\/tickets\.php\?id=98765$/);

  const m2 = modeloEL({ 12401: { decision: 'si', recibo: '00031234/2026' } });
  assert.deepEqual(resolucionPnp(m2.pnps[0], CTX), { pendiente: 'No', texto: 'Se cobró manualmente. Recibo 00031234/2026' });

  const m3 = analizar({ texto: fx('pnp-518985-irresoluble.txt') });
  assert.deepEqual(resolucionPnp(m3.pnps[0], CTX), {
    pendiente: 'Sí',
    texto: '00011022: Irresoluble.\n21/10/2026: No existe ninguna cuota asociada con el código de barras. Por lo tanto tampoco se puede determinar a qué inscripción, curso y/o área correspondería el pago.',
  });

  const m4 = analizar({ texto: fx('pnp-10102-monto.txt'), overrides: { pnps: { 10102: { area: 'POSGRADO' } } } });
  assert.match(resolucionPnp(m4.pnps[0], CTX).texto, /Se comunicó con Posgrado vía mail\./);
});

test('nota interna', () => {
  const m = analizar({
    texto: fx('formato-tabs.txt'),
    overrides: { lotes: { 16079: { archivo: 'FP.19.EL.x.txt' } }, pnps: { 10703: { decision: 'a' } } },
  });
  assert.equal(notaInterna(m.pnps, CTX), [
    'PNP 00010102: Pendiente.',
    '21/10/2026: Monto pagado no coincide con la cuota. Se abrió ticket a E-Learning (portal Jira) con los datos del pago. Se marcó el PNP como pendiente.',
    'PNP 00010703: Resuelto.',
    '21/10/2026: Cuota ya impactada; se cobró manualmente la cuota siguiente (Recibo [COMPLETAR: Nº de recibo]).',
    'PNP 00010840: Pendiente.',
    '21/10/2026: El pago apunta a un número de cuota inexistente. Se abrió ticket a E-Learning (portal Jira) con los datos del pago. Se marcó el PNP como pendiente.',
  ].join('\n'));
});

test('faltantes con el formato de SKILL.md y query con WHERE', () => {
  const m = analizar({ texto: fx('pnp-10102-monto.txt') });
  assert.equal(textoFaltantes(m).split('\n\n')[0], [
    'Para armar el ticket me faltan estos datos:',
    '- Lote 00016079: Nombre de archivo y Entidad Recaudadora',
    '- PNP 00010102: Fecha de pago, Concepto Ingreso, Plan Pago',
  ].join('\n'));
  const s = salidasPnp(m, CTX);
  assert.ok(s.query.endsWith('LEFT JOIN SciPlanPago pp                   ON pp.id = scp.PlanPagoId\nWHERE pnp.LoteId = 16079;'));
  assert.ok(armarQuery({ pnpIds: ['00010102', '00010840'] }).endsWith('WHERE pnp.Id IN (10102, 10840);'));
  assert.match(armarQuery({ fecha: '15/09/2026', monto: 129550 }), /WHERE CONVERT\(date, pnp\.Fecha\) = '20260915'\n {2}AND pnp\.Monto = 129550/);
});

test('recordatorio a 5 días hábiles', () => {
  assert.equal(fechaSeguimiento('23/10/2026'), '30/10/2026');
  assert.match(recordatorio(CTX), /^Seguimiento: el 28\/10\/2026 \(5 días hábiles\)/);
  const m = analizar({ texto: fx('pnp-518985-irresoluble.txt') });
  assert.equal(salidasPnp(m, CTX).recordatorio, '');
});

test('nota de error de lote con duplicados', () => {
  const m = analizar({ texto: fx('error-lote-20457.txt') });
  const t = notaErrorLote(m.errorLote, CTX, ['0937022999990025130000877393999900251298', '0937022999990025130000877455999900251322']);
  const l = t.split('\n');
  assert.equal(l[0], '00020457: [COMPLETAR: Pendiente/Resuelto].');
  assert.equal(l[1], 'Entidad Recaudadora: [COMPLETAR: Entidad Recaudadora]');
  assert.equal(l[5], '0937022999990025130000877393999900251298');
  assert.equal(l[6], '0937022999990025130000877455999900251322');
  assert.match(l[7], /al día siguiente hábil 22\/10\/2026\. En todo caso se resolverán los PNPs manualmente\.$/);
  assert.match(l[8], /Ticket con PNPs asociado: \[COMPLETAR: link\]$/);
  // Sin detector: usa la cuota que menciona el error
  assert.match(notaErrorLote(m.errorLote, CTX), /son:\n0937022999990025130000877393999900251298\n/);
});

test('ningún texto generado contiene la contraseña del portal', () => {
  const m = modeloEL();
  const s = salidasPnp(m, CTX);
  const todo = JSON.stringify(s);
  assert.doesNotMatch(todo, /SoporteDeAplicaciones(?!@)/);
});
