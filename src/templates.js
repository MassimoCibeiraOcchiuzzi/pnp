// Plantillas: todos los textos listos para copiar. Salen EXACTOS de docs/SKILL.md.
// Los huecos van como [COMPLETAR: campo]; nunca se inventan datos.

import { CONFIG } from './config.js';
import { formatMonto, parseFecha, formatFecha, sumarDiasHabiles, sinCeros } from './parser.js';
import { ETIQUETAS, CASOS, gruposSuma } from './classifier.js';

export const completar = (campo) => `[COMPLETAR: ${campo}]`;

// ---------------------------------------------------------------------------
// Motivos por tipo de derivación
// ---------------------------------------------------------------------------

export const MOTIVOS = {
  montos: {
    ticket: 'el valor abonado no coincide con el valor de la cuota',
    mail: 'el monto abonado no coincide con ninguna de las cuotas del curso',
    grupo: 'tienen un valor abonado que no coincide con el valor de la cuota',
    resumen1: 'Monto no coincide con la cuota',
    resumenN: 'Montos no coinciden',
    resolucion: 'monto pagado no coincide con la cuota',
    nota: 'Monto pagado no coincide con la cuota',
  },
  cuota_inexistente: {
    ticket: 'el pago apunta a un número de cuota inexistente',
    mail: 'el pago apunta a un número de cuota inexistente',
    grupo: 'apuntan a un numero de cuota inexistente',
    resumen1: 'Cuota inexistente',
    resumenN: 'Cuotas inexistentes',
    resolucion: 'el pago apunta a un número de cuota inexistente',
    nota: 'El pago apunta a un número de cuota inexistente',
  },
  cuotas_anteriores: {
    ticket: 'el inscripto tiene una o más cuotas anteriores sin abonar, lo que impide imputar el pago',
    mail: 'el inscripto tiene una o más cuotas anteriores sin abonar, lo que impide imputar el pago',
    grupo: 'corresponden a inscriptos con una o más cuotas anteriores sin abonar, lo que impide imputarlos',
    resumen1: 'Cuotas anteriores sin abonar',
    resumenN: 'Cuotas anteriores sin abonar',
    resolucion: 'cuotas anteriores sin abonar',
    nota: 'Cuota ya impactada y hay cuotas anteriores sin abonar',
  },
  sin_cuotas: {
    ticket: 'el inscripto ya tiene todas las cuotas del curso abonadas (por lo que correspondería evaluar un reembolso o si se encuentra cursando otro curso)',
    mail: 'el inscripto ya tiene todas las cuotas del curso abonadas (por lo que correspondería evaluar un reembolso o si se encuentra cursando otro curso)',
    grupo: 'corresponden a inscriptos que ya tienen todas las cuotas del curso abonadas',
    resumen1: 'Sin cuotas disponibles',
    resumenN: 'Sin cuotas disponibles',
    resolucion: 'no hay cuotas disponibles',
    nota: 'Cuota ya impactada y no quedan cuotas disponibles',
  },
  b3_pendiente: {
    ticket: completar('motivo según lo que veas en la inscripción'),
    mail: completar('motivo según lo que veas en la inscripción'),
    grupo: completar('motivo'),
    resumen1: completar('motivo corto'),
    resumenN: completar('motivo corto'),
    resolucion: completar('resumen'),
    nota: `Cuota ya impactada (${completar('qué se vio en la inscripción')})`,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nombreArea(key) {
  return key && CONFIG.areas[key] ? CONFIG.areas[key].nombre : completar('área');
}

function valor(v, etiqueta) {
  return v === null || v === undefined || String(v).trim() === '' ? completar(etiqueta) : String(v);
}

function montoTexto(p) {
  return p.campos.montoPagado === null ? completar(ETIQUETAS.montoPagado) : formatMonto(p.campos.montoPagado);
}

/** Agrupa los PNP por motivo, ordenando por cantidad (empate: el que apareció primero). */
export function agruparPorMotivo(pnps) {
  const grupos = [];
  for (const p of pnps) {
    let g = grupos.find((x) => x.motivo === p.accion.motivo);
    if (!g) { g = { motivo: p.accion.motivo, pnps: [], orden: grupos.length }; grupos.push(g); }
    g.pnps.push(p);
  }
  return grupos.sort((a, b) => b.pnps.length - a.pnps.length || a.orden - b.orden);
}

function lineasPnp(p, destino) {
  const c = p.campos;
  const l = [
    `Error: ${p.errorCorto || p.error}`,
    `Código de barras: ${valor(c.codigoBarras, 'Código de barras')}`,
    `Fecha de pago: ${valor(c.fechaPago, ETIQUETAS.fechaPago)}`,
    `Monto pagado: ${montoTexto(p)}`,
  ];
  if (p.accion.motivo === 'cuota_inexistente') {
    // Solo Error, Código, Fecha, Monto y Nombre (si se consiguió de otra fuente).
    if (c.nombre) l.push(`Nombre inscripto: ${c.nombre}`);
    if (c.dni) l.push(`Número de documento: ${c.dni}`);
    if (c.email) l.push(`Mail inscripto: ${c.email}`);
    return l;
  }
  if (c.razonSocial && !c.nombre) {
    l.push(`Nombre razón social inscripción: ${c.razonSocial}`);
  } else {
    l.push(`Nombre inscripto: ${valor(c.nombre, ETIQUETAS.nombre)}`);
  }
  if (destino === 'mail' && !c.razonSocial) l.push(`Número de documento: ${valor(c.dni, ETIQUETAS.dni)}`);
  else if (c.dni) l.push(`Número de documento: ${c.dni}`);
  if (c.email) l.push(`Mail inscripto: ${c.email}`);
  if (c.razonSocial && c.nombre) l.push(`Nombre razón social inscripción: ${c.razonSocial}`);
  if (c.cuit) l.push(`CUIT: ${c.cuit}`);
  l.push(
    `Concepto Ingreso: ${valor(c.concepto, ETIQUETAS.concepto)}`,
    `SubConcepto Ingreso: ${valor(c.subconcepto, ETIQUETAS.subconcepto)}`,
    `Plan Pago: ${valor(c.planPago, ETIQUETAS.planPago)}`,
  );
  if (c.notas) l.push(`Notas: ${c.notas}`);
  if (c.motivoBeca) l.push(`Motivo beca: ${c.motivoBeca}`);
  return l;
}

function cuerpo(lote, pnps, destino) {
  const grupos = agruparPorMotivo(pnps);
  const principal = grupos[0];
  const motivo = MOTIVOS[principal.motivo][destino === 'mail' ? 'mail' : 'ticket'];
  const uno = principal.pnps.length === 1;
  const intro = uno
    ? `Me comunico desde el área de Soporte de Aplicaciones ya que tenemos un pago el cual no se pudo procesar en el Sistema de Control de Ingresos (SCI) debido a que ${motivo}. Por lo tanto tampoco lo podemos impactar manualmente.`
    : `Me comunico desde el área de Soporte de Aplicaciones ya que tenemos pagos los cuales no se pudieron procesar en el Sistema de Control de Ingresos (SCI) debido a que ${motivo}. Por lo tanto tampoco los podemos impactar manualmente.`;

  const bloque = (g) => g.pnps.map((p) => lineasPnp(p, destino).join('\n')).join('\n\n');
  const partes = [
    'Buenas tardes,',
    intro,
    'A continuación le incluyo más datos:',
    `Entidad Recaudadora: ${valor(lote.entidad, ETIQUETAS.entidad)}\nNombre Archivo/Lote: ${valor(lote.archivo, ETIQUETAS.archivo)}`,
    bloque(principal),
  ];
  for (const g of grupos.slice(1)) {
    partes.push(`Ademas, en el mismo lote, algunos pagos ${MOTIVOS[g.motivo].grupo}.`, bloque(g));
  }
  partes.push('Quedamos al pendiente acerca de cómo proceder en este caso.');
  return { partes, grupos };
}

// ---------------------------------------------------------------------------
// 1. Ticket a E-Learning (uno por lote)
// ---------------------------------------------------------------------------

export function resumenTicket(lote, pnps) {
  const grupos = agruparPorMotivo(pnps);
  const archivo = valor(lote.archivo, ETIQUETAS.archivo);
  if (pnps.length === 1) {
    return `Pago no procesable en SCI - ${MOTIVOS[grupos[0].motivo].resumen1} - ${archivo}`;
  }
  const frases = grupos.map((g, i) => {
    const f = MOTIVOS[g.motivo].resumenN;
    return i === 0 ? f : f.charAt(0).toLowerCase() + f.slice(1);
  });
  const motivo = frases.length === 1 ? frases[0] : `${frases.slice(0, -1).join(', ')} y ${frases[frases.length - 1]}`;
  return `Pagos no procesables en SCI - ${motivo} - ${archivo}`;
}

export function ticketElearning(lote, pnps) {
  const { partes } = cuerpo(lote, pnps, 'ticket');
  partes.push('Saludos cordiales.');
  return { resumen: resumenTicket(lote, pnps), descripcion: partes.join('\n\n') };
}

// ---------------------------------------------------------------------------
// 2. Mail al coordinador del área (no E-Learning)
// ---------------------------------------------------------------------------

export function mailCoordinador(lote, areaKey, pnps, ctx = {}) {
  const area = areaKey ? CONFIG.areas[areaKey] : null;
  const para = area && area.para ? area.para.join('; ') : completar('destinatario (elegí el área dueña)');
  const cab = ['Asunto: Pago no Procesable en SCI', `Para: ${para}`];
  if (area && area.cc && area.cc.length) cab.push(`CC: ${area.cc.join('; ')}`);
  cab.push(`CCO: ${CONFIG.cco}`);
  const { partes } = cuerpo(lote, pnps, 'mail');
  const firma = ctx.firma && ctx.firma.trim() ? ctx.firma.trim() : completar('firma');
  partes.push(`Saludos cordiales,\n${firma}`);
  return [cab.join('\n'), ...partes].join('\n\n');
}

// ---------------------------------------------------------------------------
// 3. Descripción Resolución del PNP (campo en SCI)
// ---------------------------------------------------------------------------

export function resolucionPnp(p, ctx = {}) {
  const fecha = ctx.fecha || formatFecha(new Date());
  const a = p.accion;
  if (a.tipo === 'cobro_manual') {
    return { pendiente: 'No', texto: `Se cobró manualmente. Recibo ${valor(p.campos.recibo || ctx.recibo, 'Nº de recibo')}` };
  }
  if (a.tipo === 'irresoluble') {
    return {
      pendiente: 'Sí',
      texto: `${p.id}: Irresoluble.\n${fecha}: No existe ninguna cuota asociada con el código de barras. Por lo tanto tampoco se puede determinar a qué inscripción, curso y/o área correspondería el pago.`,
    };
  }
  if (a.tipo === 'registro') {
    return {
      pendiente: 'Sí',
      texto: `${p.id}: Pendiente.\n${fecha}: El pago llegó sin código de cuota (código ${p.codigo}); causa desconocida. Se deja registro hasta que aparezca el reclamo.`,
    };
  }
  if (a.tipo === 'soporte') {
    return {
      pendiente: 'Sí',
      texto: `No se puede cobrar manualmente (error sin procedimiento documentado: ${p.errorCorto || p.error}). Se derivó a Soporte de Aplicaciones.`,
    };
  }
  const area = p.area.key ? CONFIG.areas[p.area.key] : null;
  const areaMedio = area ? `${area.nombre} vía ${area.medio}` : `${completar('área')} vía ${completar('medio')}`;
  const nro = ctx.ticketNro ? String(ctx.ticketNro).replace(/^#/, '') : '<NÚMERO>';
  const id = ctx.ticketId ? String(ctx.ticketId) : '<IDTICKET>';
  return {
    pendiente: 'Sí',
    texto: `No se puede cobrar manualmente (${MOTIVOS[a.motivo].resolucion}). Se comunicó con ${areaMedio}. Ticket #${nro} donde se trabaja el PNP: ${CONFIG.urlTicket}${id}`,
  };
}

// ---------------------------------------------------------------------------
// 4. Nota interna del ticket
// ---------------------------------------------------------------------------

function accionNota(p, ctx) {
  const a = p.accion;
  const recibo = valor(p.campos.recibo || ctx.recibo, 'Nº de recibo');
  switch (a.tipo) {
    case 'cobro_manual':
      if (p.tipo === 'B3') return ['Resuelto', `Cuota ya impactada; se cobró manualmente la cuota siguiente (Recibo ${recibo}).`];
      if (p.tipo === 'B2') return ['Resuelto', `La cuota apareció buscando por código de barras en SCI; se cobró manualmente (Recibo ${recibo}).`];
      return ['Resuelto', `El monto pagado coincide con otra cuota del plan; se cobró manualmente (Recibo ${recibo}).`];
    case 'irresoluble':
      return ['Irresoluble', `No existe cuota para el código ${p.datos.codigoError || p.codigo} (la cuota fue eliminada antes de que llegue el pago). Se dejó el PNP como pendiente.`];
    case 'registro':
      return ['Pendiente', 'Pago sin código de cuota, causa desconocida. Se cierra el ticket y se deja registro hasta que aparezca el reclamo.'];
    case 'soporte':
      return ['Pendiente', 'Error sin procedimiento documentado. Se derivó a Soporte de Aplicaciones.'];
    default: {
      const area = p.area.key ? CONFIG.areas[p.area.key] : null;
      let medio;
      if (!area) medio = `Se comunicó con ${completar('área')} vía ${completar('medio')} con los datos del pago.`;
      else if (area.canal === 'ticket') medio = `Se abrió ticket a ${area.nombre} (portal Jira) con los datos del pago.`;
      else medio = `Se envió mail a ${area.nombre} con los datos del pago.`;
      return ['Pendiente', `${MOTIVOS[a.motivo].nota}. ${medio} Se marcó el PNP como pendiente.`];
    }
  }
}

function listaY(xs) {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

/** "PNP 00012469: datos completados con el mensaje de Tesorería (pago 1236361, lote EL 1893)." o null. */
function lineaTesoreria(p) {
  const r = p.tesoreria;
  if (!r || r.estado !== 'cruzado' || r.confianza !== 'alta') return null;
  const ids = r.pagos.map((x) => x.idPago);
  const pagos = `${ids.length === 1 ? 'pago' : 'pagos'} ${listaY(ids)}${r.loteEl !== null && r.loteEl !== undefined ? `, lote EL ${r.loteEl}` : ''}`;
  const que = p.completadoTesoreria && p.completadoTesoreria.length ? 'datos completados con' : 'cruzado con';
  return `PNP ${p.id}: ${que} el mensaje de Tesorería (${pagos}).`;
}

export function notaInterna(pnps, ctx = {}) {
  const fecha = ctx.fecha || formatFecha(new Date());
  const lineas = pnps.map((p) => {
    const [estado, accion] = accionNota(p, ctx);
    return `PNP ${p.id}: ${estado}.\n${fecha}: ${accion}`;
  });
  return [...lineas, ...pnps.map(lineaTesoreria).filter(Boolean)].join('\n');
}

// ---------------------------------------------------------------------------
// Seguimiento a 5 días hábiles
// ---------------------------------------------------------------------------

export function fechaSeguimiento(fecha) {
  const d = parseFecha(fecha) || new Date();
  return formatFecha(sumarDiasHabiles(d, CONFIG.diasSeguimiento));
}

export function recordatorio(ctx = {}) {
  const fecha = ctx.fecha || formatFecha(new Date());
  return `Seguimiento: el ${fechaSeguimiento(fecha)} (${CONFIG.diasSeguimiento} días hábiles) revisar si el área respondió o hizo el cambio. Si no, cerrar el ticket sin éxito y actualizar la Descripción Resolución del PNP (queda pendiente).`;
}

// ---------------------------------------------------------------------------
// Query de datos faltantes
// ---------------------------------------------------------------------------

const QUERY_BASE = `SELECT
    pnp.Id                               AS PNP_Id,
    pnp.LoteId                           AS Lote_Id,
    er.Descripcion                       AS EntidadRecaudadora,
    l.NombreArchivo                      AS NombreArchivo,
    pnp.DescripcionError                 AS Error,
    pnp.CodigoBarras                     AS CodigoBarras,
    CONVERT(varchar(10), pnp.Fecha, 103) AS FechaPago,
    pnp.Monto                            AS MontoPagado,
    c.Monto                              AS MontoCuota,
    RTRIM(p.Nombre)                      AS NombreInscripto,
    i.NroDocumento                       AS DNI,
    RTRIM(ci.nombre)                     AS ConceptoIngreso,
    sc.Descripcion                       AS SubConceptoIngreso,
    pp.Descripcion                       AS PlanPago
FROM SciLotePagoNoProcesable pnp
LEFT JOIN SciLote l                        ON l.Id = pnp.LoteId
LEFT JOIN SciEntidadRecaudadora er         ON er.Id = l.EntidadRecaudadoraId
LEFT JOIN scicuota c                       ON c.CodigoBarras = pnp.CodigoBarras
LEFT JOIN SciInscripcion i                 ON i.id = c.InscripcionId
LEFT JOIN SciSubConceptoIngresoPlanPago scp ON scp.id = i.SubConceptoIngresoPlanPago
LEFT JOIN SciSubConceptoIngreso sc         ON sc.id = scp.SubConceptoIngresoId
LEFT JOIN personas p                       ON p.nrodocumento = i.NroDocumento
LEFT JOIN ConceptosIngresos ci             ON ci.conceptoingreso = sc.ConceptoIngresoId
LEFT JOIN SciPlanPago pp                   ON pp.id = scp.PlanPagoId`;

/** where: { loteId } | { pnpIds: [] } | { fecha: 'DD/MM/AAAA', monto, texto } */
export function armarQuery(where = {}) {
  let w;
  if (where.pnpIds && where.pnpIds.length) {
    w = `WHERE pnp.Id IN (${where.pnpIds.map((x) => sinCeros(x)).join(', ')});`;
  } else if (where.loteId !== undefined && where.loteId !== null && where.loteId !== '') {
    w = `WHERE pnp.LoteId = ${sinCeros(where.loteId)};`;
  } else {
    const c = [];
    const d = parseFecha(where.fecha || '');
    if (d) {
      const iso = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      c.push(`CONVERT(date, pnp.Fecha) = '${iso}'`);
    }
    if (where.monto !== undefined && where.monto !== null && where.monto !== '') c.push(`pnp.Monto = ${where.monto}`);
    if (where.texto) c.push(`pnp.DescripcionError LIKE '%${String(where.texto).replace(/'/g, "''")}%'`);
    w = c.length ? `WHERE ${c.join('\n  AND ')}\nORDER BY pnp.Fecha DESC;` : 'WHERE pnp.LoteId = /*ID de lote*/;   -- o: WHERE pnp.Id IN (/*IDs de PNP*/)';
  }
  return `${QUERY_BASE}\n${w}`;
}

/** "Para armar el ticket me faltan estos datos: …" o null si no falta nada. */
export function textoFaltantes(modelo) {
  const lineas = [];
  for (const L of modelo.lotes) {
    if (L.faltantes.length) {
      lineas.push(`- Lote ${L.lote ? L.lote.id8 : completar('ID de lote')}: ${listaY(L.faltantes.map((k) => ETIQUETAS[k]))}`);
    }
  }
  for (const p of modelo.pnps) {
    if (p.faltantes.length) lineas.push(`- PNP ${p.id}: ${p.faltantes.map((k) => ETIQUETAS[k]).join(', ')}`);
  }
  if (!lineas.length) return null;
  return `Para armar el ticket me faltan estos datos:\n${lineas.join('\n')}\n\nLo más rápido es correr esta consulta en la DB de SysAdmin y pegar el resultado en "Resultado de la query".`;
}

export function queryFaltantes(modelo) {
  const lotes = modelo.lotes.filter((L) => L.lote);
  if (lotes.length === 1) return armarQuery({ loteId: lotes[0].lote.num });
  return armarQuery({ pnpIds: modelo.pnps.map((p) => p.id) });
}

const numeroSql = (n) => String(Math.round(n * 100) / 100);

/**
 * Query para encontrar los PNP de los pagos de Tesorería: filtra por los lotes
 * EL (en el nombre de archivo) y por los montos (cada pago y la suma de los
 * pagos de una misma orden/mail en el mismo lote).
 */
export function queryTesoreria(pagos) {
  const lotes = [...new Set(pagos.map((x) => x.loteEl).filter((v) => v !== null))].sort((a, b) => a - b);
  const montos = new Set(pagos.filter((x) => x.montoBruto !== null).map((x) => x.montoBruto));
  gruposSuma(pagos).forEach((g) => montos.add(g.monto));
  const listaMontos = [...montos].sort((a, b) => a - b).map(numeroSql);

  const cond = [];
  const todosConLote = pagos.every((x) => x.loteEl !== null);
  if (lotes.length && todosConLote) {
    // "[_.]" evita que el lote 1893 matchee 18930: el lote EL va seguido de "_<loteSCI>" o ".txt".
    cond.push(`(${lotes.map((n) => `l.NombreArchivo LIKE '%.EL.%.${n}[_.]%'`).join('\n    OR ')})`);
  }
  if (listaMontos.length) cond.push(`pnp.Monto IN (${listaMontos.join(', ')})`);
  const comentario = [
    `-- PNP de los pagos que mandó Tesorería${lotes.length ? ` (lotes EL ${listaY(lotes.map(String))})` : ''}.`,
    '-- Montos: cada pago y la suma de los pagos de una misma orden o mail en el mismo lote.',
  ];
  if (!todosConLote) comentario.push('-- Hay pagos sin "En lote nº": no se filtra por lote, solo por monto.');
  const where = cond.length ? `WHERE ${cond.join('\n  AND ')}` : 'WHERE 1 = 0   -- no hay montos para buscar';
  return `${comentario.join('\n')}\n${QUERY_BASE}\n${where}\nORDER BY pnp.LoteId, pnp.Id;`;
}

// ---------------------------------------------------------------------------
// Cruce con Tesorería: tabla y respuesta
// ---------------------------------------------------------------------------

export const ESTADOS_PAGO = {
  cruzado: 'Cruzado',
  ambiguo: 'Ambiguo',
  sin_pnp: 'Sin PNP en este ticket',
  sin_datos: 'Sin cruzar (falta la query)',
};

/** Estado de resolución del PNP, según lo que contestó el usuario en las preguntas de SCI. */
export function estadoResolucion(p, ctx = {}) {
  const a = p.accion;
  switch (a.tipo) {
    case 'cobro_manual': {
      const r = p.campos.recibo || ctx.recibo;
      return r ? `Cobrado con recibo ${r}` : 'Cobro manual (falta el recibo)';
    }
    case 'irresoluble': return 'Irresoluble';
    case 'registro': return 'Pendiente (registro)';
    case 'soporte': return 'Derivado a Soporte de Aplicaciones';
    default:
      if (a.borrador) return 'Pendiente (sin revisar en SCI)';
      return `Derivado a ${p.area.key ? CONFIG.areas[p.area.key].nombre : 'área sin definir'}`;
  }
}

export const COLUMNAS_CRUCE = [
  'ID pago', 'Nombre', 'Fecha de pago', 'Monto', 'Lote EL', 'PNP', 'Lote SCI', 'Caso', 'Confianza', 'Razones', 'Estado',
];

/** Una fila por pago de Tesorería, con las columnas de COLUMNAS_CRUCE. */
export function tablaCruce(modelo, ctx = {}) {
  const t = modelo.tesoreria;
  if (!t) return [];
  const loteSci = (p) => {
    const L = modelo.lotes.find((x) => x.key === p.loteKey);
    return L && L.lote ? L.lote.id8 : '';
  };
  return t.filas.map((f) => {
    const x = f.pago;
    const base = [x.idPago, x.nombre, x.fechaPago, x.montoBruto === null ? '' : formatMonto(x.montoBruto), x.loteEl === null ? '' : String(x.loteEl)];
    if (f.estado === 'cruzado') {
      const p = f.pnp;
      return [...base, p.id, loteSci(p), p.tipo, f.confianza, f.razones.join('; '), estadoResolucion(p, ctx)];
    }
    if (f.estado === 'ambiguo') {
      const ps = f.pnps;
      return [...base, ps.map((p) => p.id).join(' / '), [...new Set(ps.map(loteSci))].join(' / '),
        [...new Set(ps.map((p) => p.tipo))].join(' / '), 'ambiguo', f.razones.join('; '), 'Ambiguo: elegir a mano'];
    }
    return [...base, '', '', '', '', '', ESTADOS_PAGO[f.estado]];
  });
}

export function tablaCruceTsv(modelo, ctx = {}) {
  const limpio = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  return [COLUMNAS_CRUCE, ...tablaCruce(modelo, ctx)].map((fila) => fila.map(limpio).join('\t')).join('\n');
}

const FRASE_MOTIVO = {
  montos: 'El monto pagado no coincide con la cuota',
  cuota_inexistente: 'El pago apunta a una cuota inexistente',
  cuotas_anteriores: 'El inscripto tiene cuotas anteriores sin abonar',
  sin_cuotas: 'El inscripto ya tiene todas las cuotas del curso abonadas',
  b3_pendiente: 'La cuota ya estaba paga',
};

function estadoParaTesoreria(p, ctx) {
  const a = p.accion;
  switch (a.tipo) {
    case 'cobro_manual':
      return `Se cobró manualmente. Recibo ${p.campos.recibo || ctx.recibo || '<NRO_RECIBO>'}.`;
    case 'irresoluble':
      return 'La cuota se eliminó antes de que llegue el pago y no se puede determinar a qué inscripción corresponde. Queda pendiente.';
    case 'registro':
      return 'El pago llegó sin código de cuota; causa desconocida. Queda pendiente.';
    case 'soporte':
      return 'Lo está revisando Soporte de Aplicaciones. Queda pendiente.';
    default: {
      const area = p.area.key ? CONFIG.areas[p.area.key] : null;
      const nro = ctx.ticketNro ? String(ctx.ticketNro).replace(/^#/, '') : '<NÚMERO>';
      let medio;
      if (!area) medio = `se informó a ${completar('área')}`;
      else if (area.canal === 'ticket') medio = `se informó a ${area.nombre} (ticket ${nro})`;
      else medio = `se informó a ${area.nombre} por mail`;
      return `${FRASE_MOTIVO[a.motivo]}; ${medio}. Queda pendiente.`;
    }
  }
}

/** Respuesta a Tesorería: una línea por pago (o por grupo de pagos que fueron a un mismo PNP). */
export function respuestaTesoreria(modelo, ctx = {}) {
  const t = modelo.tesoreria;
  if (!t) return null;
  const items = [];
  for (const f of t.filas) {
    if (f.estado === 'cruzado') {
      const previo = items.find((i) => i.fila.estado === 'cruzado' && i.fila.pnp === f.pnp);
      if (previo) { previo.pagos.push(f.pago); continue; }
    }
    items.push({ fila: f, pagos: [f.pago] });
  }

  let borrador = false;
  const lineas = items.map(({ fila: f, pagos }) => {
    const x = pagos[0];
    const montos = pagos.map((y) => y.montoBruto);
    let monto;
    if (pagos.length === 1) monto = montos[0] === null ? completar('monto') : `$${formatMonto(montos[0])}`;
    else if (montos.every((m) => m === montos[0])) monto = `${pagos.length} pagos de $${formatMonto(montos[0])}`;
    else monto = `${pagos.length} pagos (${montos.map((m) => `$${formatMonto(m)}`).join(' + ')})`;
    const fechas = [...new Set(pagos.map((y) => y.fechaPago).filter(Boolean))];
    const datos = [fechas.join(' y '), x.loteEl !== null ? `lote ${x.loteEl}` : ''].filter(Boolean).join(', ');
    const cab = `- ${x.nombre} — ${monto}${datos ? ` (${datos})` : ''}`;

    if (f.estado === 'cruzado') {
      const p = f.pnp;
      const aConfirmar = f.confianza !== 'alta';
      if (aConfirmar || p.accion.borrador) borrador = true;
      return `${cab}: PNP ${p.id}${aConfirmar ? ' (a confirmar)' : ''}. ${estadoParaTesoreria(p, ctx)}`;
    }
    if (f.estado === 'ambiguo') {
      borrador = true;
      const ids = f.pnps.map((p) => p.id);
      if (ids.length === 1) return `${cab}: puede corresponder al PNP ${ids[0]}, pero hay otro pago con los mismos datos. Lo estamos revisando.`;
      return `${cab}: puede corresponder a los PNP ${listaY(ids).replace(/ y ([^ ]+)$/, ' o $1')}. Lo estamos revisando.`;
    }
    if (f.estado === 'sin_datos') {
      borrador = true;
      return `${cab}: todavía no lo pudimos cruzar con los PNP. Lo seguimos revisando.`;
    }
    return `${cab}: no encontramos el PNP en los lotes revisados. Lo seguimos buscando.`;
  });

  const firma = ctx.firma && ctx.firma.trim() ? ctx.firma.trim() : '<FIRMA>';
  const texto = [
    `Hola ${CONFIG.tesoreria.contacto},`,
    'Te paso el estado de los pagos que nos enviaste:',
    lineas.join('\n'),
    `Saludos,\n${firma}`,
  ].join('\n\n');
  return { texto, borrador };
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

function queHacer(p) {
  const a = p.accion;
  const area = nombreArea(p.area.key);
  const canal = p.area.key === 'EL' ? 'ticket a E-Learning' : `mail a ${area}`;
  switch (a.tipo) {
    case 'cobro_manual': return 'cobrar manualmente (ver checklist de Cobro manual).';
    case 'irresoluble': return 'la cuota fue eliminada: es irresoluble. Dejar el PNP pendiente con la resolución 3c.';
    case 'registro': return 'código sin cuota (todo ceros): causa desconocida. Cerrar y dejar registro hasta que aparezca el reclamo.';
    case 'soporte': return 'no hay procedimiento documentado. Pedir el texto completo/captura y derivar a Soporte de Aplicaciones.';
    default:
      if (a.borrador && p.tipo === 'B1') return `revisar en SCI si el monto coincide con otra cuota del plan; si no, ${canal} (borrador abajo).`;
      if (a.borrador && p.tipo === 'B2') return `buscar por Cod. Barras en SCI; si no aparece, ${canal} (borrador abajo).`;
      if (a.borrador && p.tipo === 'B3') return `buscar por Cobros → nombre del alumno y contestar qué se ve en la inscripción; borrador de ${canal} abajo.`;
      return `${canal}, PNP en Pendiente = Sí.`;
  }
}

function etiquetaCaso(p) {
  if (p.tipo === 'B2' && p.sub === 'corto') return 'B2 · cuota eliminada';
  if (p.tipo === 'B2' && p.sub === 'ceros') return 'B2 · código en ceros';
  return `${p.tipo} · ${CASOS[p.tipo].toLowerCase()}`;
}

function resumenTesoreria(t) {
  const n = t.filas.length;
  const cuenta = (e) => t.filas.filter((f) => f.estado === e).length;
  const lotes = [...new Set(t.pagos.map((x) => x.loteEl).filter((v) => v !== null))].sort((a, b) => a - b);
  const partes = [`${cuenta('cruzado')} cruzado${cuenta('cruzado') === 1 ? '' : 's'}`];
  if (cuenta('ambiguo')) partes.push(`${cuenta('ambiguo')} ambiguo${cuenta('ambiguo') === 1 ? '' : 's'}`);
  if (cuenta('sin_datos')) partes.push(`${cuenta('sin_datos')} sin cruzar (falta la query)`);
  if (cuenta('sin_pnp')) partes.push(`${cuenta('sin_pnp')} sin PNP en este ticket`);
  return `Tesorería: ${n} pago${n === 1 ? '' : 's'}${lotes.length ? ` (lotes EL ${listaY(lotes.map(String))})` : ''} → ${partes.join(', ')}.`;
}

export function diagnosticoPnp(modelo) {
  const lineas = [];
  if (modelo.tipo === 'tesoreria' && !modelo.pnps.length) {
    lineas.push('Pedido de Tesorería: pagos sin número de recibo en SCI. Corré la query de abajo para encontrar sus PNP y pegá la grilla en el cuadro 2.');
  }
  for (const L of modelo.lotes) {
    const lote = L.lote ? `Lote ${L.lote.id8}` : 'Lote sin identificar';
    const n = L.pnps.length;
    lineas.push(`${lote}: ${n} PNP${n === 1 ? '' : 's'}${L.archivo ? ` (${L.archivo})` : ''}.`);
    for (const p of L.pnps) {
      const area = p.area.key ? ` → ${nombreArea(p.area.key)}` : p.accion.tipo === 'derivar' ? ' → área indeterminada' : '';
      lineas.push(`• PNP ${p.id} (${etiquetaCaso(p)})${area}: ${queHacer(p)}`);
    }
  }
  if (modelo.tesoreria) lineas.push(resumenTesoreria(modelo.tesoreria));
  return lineas.join('\n');
}

// ---------------------------------------------------------------------------
// Errores de lote
// ---------------------------------------------------------------------------

export function notaErrorLote(el, ctx = {}, duplicados = []) {
  const fecha = ctx.fecha || formatFecha(new Date());
  const id = el.lote ? el.lote.id8 : completar('ID de lote');
  const l = [
    `${id}: ${completar('Pendiente/Resuelto')}.`,
    `Entidad Recaudadora: ${valor(el.entidad, ETIQUETAS.entidad)}`,
    `Nombre Archivo: ${valor(el.archivo, ETIQUETAS.archivo)}`,
    `${fecha}: Tomé el archivo de la carpeta ${completar('RUTA')} > ${completar('AL')} > ${valor(el.archivo, 'ARCHIVO')}.`,
  ];
  if (el.caso.id === 'duplicados') {
    const cods = duplicados.length ? duplicados : el.codigoMencionado ? [el.codigoMencionado] : [completar('CODIGO1'), completar('CODIGO2')];
    l.push('Los códigos de barras que se encuentran duplicados son:', ...cods);
    l.push(`Cambiados manualmente los códigos de barras duplicados manteniendo los IDs de cuotas, subiendo el archivo modificado a ${completar('RUTA')} > ${completar('AL')} > ${valor(el.archivo, 'ARCHIVO')} para que lo tome al día siguiente hábil ${formatFecha(sumarDiasHabiles(parseFecha(fecha) || new Date(), 1))}. En todo caso se resolverán los PNPs manualmente.`);
  } else {
    l.push(`${fecha}: ${el.caso.causa} ${completar('corrección realizada')}.`);
  }
  l.push(`${completar('DD/MM/AAAA')}: Ticket con PNPs asociado: ${completar('link')}`);
  return l.join('\n');
}

// ---------------------------------------------------------------------------
// Todas las salidas de un modelo de PNP
// ---------------------------------------------------------------------------

export function salidasPnp(modelo, ctx = {}) {
  const ticketsEL = [];
  const mails = [];
  for (const L of modelo.lotes) {
    const derivados = L.pnps.filter((p) => p.accion.tipo === 'derivar');
    const el = derivados.filter((p) => p.area.key === 'EL');
    if (el.length) {
      ticketsEL.push({ lote: L, ...ticketElearning(L, el), borrador: el.some((p) => p.accion.borrador) });
    }
    const porArea = new Map();
    for (const p of derivados.filter((x) => x.area.key !== 'EL')) {
      const k = p.area.key || '';
      if (!porArea.has(k)) porArea.set(k, []);
      porArea.get(k).push(p);
    }
    for (const [k, ps] of porArea) {
      mails.push({ lote: L, area: k || null, texto: mailCoordinador(L, k || null, ps, ctx), borrador: ps.some((p) => p.accion.borrador) });
    }
  }
  const resoluciones = modelo.pnps.map((p) => ({ pnp: p, ...resolucionPnp(p, ctx), borrador: !!p.accion.borrador }));
  const hayDerivados = modelo.pnps.some((p) => p.accion.tipo === 'derivar');
  let tesoreria = null;
  if (modelo.tesoreria) {
    const t = modelo.tesoreria;
    const sinCruzar = t.filas.filter((f) => f.estado === 'sin_pnp' || f.estado === 'sin_datos').map((f) => f.pago);
    tesoreria = {
      tabla: tablaCruce(modelo, ctx),
      tsv: tablaCruceTsv(modelo, ctx),
      respuesta: modelo.pnps.length ? respuestaTesoreria(modelo, ctx) : null,
      query: sinCruzar.length ? queryTesoreria(modelo.tipo === 'tesoreria' && !modelo.pnps.length ? t.pagos : sinCruzar) : null,
    };
  }
  return {
    diagnostico: diagnosticoPnp(modelo),
    faltantes: modelo.pnps.length ? textoFaltantes(modelo) : null,
    query: queryFaltantes(modelo),
    tesoreria,
    ticketsEL,
    mails,
    resoluciones,
    nota: modelo.pnps.length ? notaInterna(modelo.pnps, ctx) : '',
    recordatorio: hayDerivados ? recordatorio(ctx) : '',
    hayCobroManual: modelo.pnps.some((p) => p.accion.tipo === 'cobro_manual'),
  };
}

export const CHECKLIST_COBRO_MANUAL = [
  'Anotar el ID de lote. En SCI (TST o PRD) buscar el lote por Id → anotar entidad recaudadora y fecha de pago.',
  'Ver los PNPs del lote (ícono $) y copiar el código de barras de la descripción del error.',
  'Nueva pestaña de SCI → buscar por Cod. Barras (si solo hay ID de cuota: Cobros → buscar por nombre → inscripción del SubConcepto → ícono de billetes; si no aparece Cobros en el menú, apretar Volver hasta que aparezca).',
  'Verificar que el monto pagado coincide con una cuota y que no hay anteriores impagas.',
  'Cargar medio de pago = el de la entidad, fecha de pago = la del PNP, tildar la cuota, tildar "Lanzar automáticamente la impresión" para obtener el nro. de recibo → Grabar. Fecha, entidad y monto deben ser IGUALES a los del PNP.',
  'Editar el PNP: ¿Pendiente? = No, Descripción Resolución = "Se cobró manualmente" + nro. de recibo → Grabar.',
];
