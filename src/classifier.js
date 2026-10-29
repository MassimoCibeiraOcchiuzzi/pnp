// Clasificador: arma el modelo completo a partir de las entradas.
// Tabla A (tipo de ticket), tabla B (error de cada PNP), área dueña,
// decisiones de SCI que responde el humano y datos faltantes.

import { CONFIG } from './config.js';
import {
  fold, sinCeros, tieneMojibake, parseNumero, formatFecha, formatMonto, parseFecha, detectarTipo,
  extraerLote, loteDesde, extraerInfoLote, extraerErrorLote, parsearFilasPnp, extraerDatosError,
  parsearQuery, extraerPistasUsuario, loteElDesdeArchivo, desglosarCodigoBarras, normalizarNombre,
  parsearTesoreria,
} from './parser.js';

// ---------------------------------------------------------------------------
// Tabla B
// ---------------------------------------------------------------------------

export const CASOS = {
  B1: 'Monto no coincide',
  B2: 'No existe la cuota',
  B3: 'Cuota ya impactada',
  B4: 'Error sin procedimiento',
};

/** { tipo: 'B1'|'B2'|'B3'|'B4', sub?: 'corto'|'largo'|'ceros', datos } */
export function clasificarError(error, codigo = '') {
  const datos = extraerDatosError(error);
  const r = { tipo: datos.tipo, datos };
  if (datos.tipo === 'B2') {
    const x = datos.codigoError || String(codigo ?? '');
    if (/^0+$/.test(x)) r.sub = 'ceros';
    else if (x.length <= 10) r.sub = 'corto';
    else r.sub = 'largo';
  }
  return r;
}

// ---------------------------------------------------------------------------
// Área dueña
// ---------------------------------------------------------------------------

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** { key, fuente: 'manual'|'archivo'|'palabras'|null, detalle } — key null = indeterminado. */
export function detectarArea({ archivo = '', concepto = '', subconcepto = '', alumno = '' } = {}) {
  for (const regla of CONFIG.archivos) {
    if (archivo && regla.patron.test(archivo)) {
      return { key: regla.area, fuente: 'archivo', detalle: `archivo ${archivo}` };
    }
  }
  const texto = fold([concepto, subconcepto, alumno].filter(Boolean).join(' | '));
  for (const regla of CONFIG.palabrasClave) {
    for (const p of regla.palabras) {
      if (new RegExp('(^|[^a-z0-9])' + escaparRegex(fold(p))).test(texto)) {
        return { key: regla.area, fuente: 'palabras', detalle: `"${p}" en concepto/alumno` };
      }
    }
  }
  return { key: null, fuente: null, detalle: '' };
}

// ---------------------------------------------------------------------------
// Decisiones de SCI (las contesta el humano)
// ---------------------------------------------------------------------------

export const PREGUNTAS = {
  B1: {
    texto: '¿El monto pagado coincide con alguna otra cuota del plan?',
    opciones: [
      ['pendiente', 'Todavía no lo revisé'],
      ['si', 'Sí → cobro manual'],
      ['no', 'No → derivar al área'],
    ],
  },
  B2: {
    texto: '¿Aparece la cuota buscando por Cod. Barras en SCI?',
    opciones: [
      ['pendiente', 'Todavía no lo revisé'],
      ['si', 'Sí → cobro manual'],
      ['no', 'No → derivar al área'],
    ],
  },
  B3: {
    texto: '¿Qué ves en la inscripción? (buscar por Cobros → nombre del alumno → inscripción con ese SubConcepto)',
    opciones: [
      ['pendiente', 'Todavía no lo revisé'],
      ['a', 'Hay cuota impaga siguiente con el mismo monto y sin anteriores impagas → cobro manual'],
      ['b', 'Hay cuotas anteriores sin pagar → mail al coordinador'],
      ['c', 'No quedan cuotas disponibles → mail al coordinador (reembolso / otro curso)'],
      ['d', 'El monto no coincide con ninguna cuota → igual que B1'],
    ],
  },
};

/** La pregunta que corresponde a este PNP, o null. */
export function preguntaPara(pnp) {
  if (pnp.tipo === 'B1') return PREGUNTAS.B1;
  if (pnp.tipo === 'B2' && pnp.sub === 'largo') return PREGUNTAS.B2;
  if (pnp.tipo === 'B3') return PREGUNTAS.B3;
  return null;
}

/**
 * Acción resultante:
 *   { tipo: 'cobro_manual' }
 *   { tipo: 'derivar', motivo: 'montos'|'cuota_inexistente'|'cuotas_anteriores'|'sin_cuotas'|'b3_pendiente', borrador }
 *   { tipo: 'irresoluble' } | { tipo: 'registro' } | { tipo: 'soporte' }
 */
export function resolverAccion(pnp, decision = 'pendiente') {
  const borrador = decision === 'pendiente';
  switch (pnp.tipo) {
    case 'B1':
      if (decision === 'si') return { tipo: 'cobro_manual' };
      return { tipo: 'derivar', motivo: 'montos', borrador };
    case 'B2':
      if (pnp.sub === 'ceros') return { tipo: 'registro' };
      if (pnp.sub === 'corto') return { tipo: 'irresoluble' };
      if (decision === 'si') return { tipo: 'cobro_manual' };
      return { tipo: 'derivar', motivo: 'cuota_inexistente', borrador };
    case 'B3':
      if (decision === 'a') return { tipo: 'cobro_manual' };
      if (decision === 'b') return { tipo: 'derivar', motivo: 'cuotas_anteriores', borrador: false };
      if (decision === 'c') return { tipo: 'derivar', motivo: 'sin_cuotas', borrador: false };
      if (decision === 'd') return { tipo: 'derivar', motivo: 'montos', borrador: false };
      return { tipo: 'derivar', motivo: 'b3_pendiente', borrador: true };
    default:
      return { tipo: 'soporte' };
  }
}

// ---------------------------------------------------------------------------
// Errores de lote
// ---------------------------------------------------------------------------

export const ERRORES_LOTE = [
  {
    id: 'duplicados',
    patron: /mas de un registro con el mismo/,
    titulo: 'Registros duplicados (mismo id/código de barras)',
    causa: 'Pagaron la misma cuota 2 veces.',
    pasos: [
      'Descargar el archivo (Cobros externos → Carpetas, o SysGestión si es SCEU).',
      'Detectar los duplicados (pegá el contenido del archivo abajo, o: awk \'{print substr($0, length($0)-39)}\' entrada.txt | sort | uniq -d).',
      'Pocos registros: cobrar todos a mano.',
      'Muchos: quitar/corregir el duplicado, ajustar total y cantidad en la última línea y subirlo a Entrada con el MISMO nombre que en SCI-Lotes. Se procesa al día siguiente hábil (en TST: Forzar proceso).',
      'Los duplicados se resuelven después como PNP.',
    ],
  },
  {
    id: 'object_reference',
    patron: /object reference not set/,
    titulo: 'Object reference not set to an instance of an object',
    causa: 'Casi siempre es el formato del archivo.',
    pasos: [
      'Descargar el archivo del lote.',
      'Compararlo con el formato de la entidad y con otros lotes OK de la misma entidad (ojo con caracteres invisibles \\n, \\r).',
      'Corregirlo y resubirlo.',
    ],
  },
  {
    id: 'cantidad_importes',
    patron: /cantidad de comprobantes procesados no coincide|importes del lote difieren/,
    titulo: 'No coinciden la cantidad de comprobantes o los importes',
    causa: 'La línea de totales no coincide con el detalle.',
    pasos: [
      'Revisar cantidad e importe de la línea de totales contra el detalle.',
      'Corregir y resubir.',
    ],
  },
  {
    id: 'periodo_cerrado',
    patron: /periodo cerrado/,
    titulo: 'La fecha pertenece a un período cerrado',
    causa: 'El período contable de la fecha de pago está cerrado.',
    pasos: [
      'Hablar ANTES con Presupuesto.',
      'Abrir el período en SysAdmin (Archivo → Tablas generales → Períodos).',
      'Mover el archivo de Error a Entrada, renombrado.',
    ],
  },
  {
    id: 'cuotas_pagas',
    patron: /existen cuotas pagas|no presenta deuda/,
    titulo: 'Existen cuotas pagas / La inscripción no presenta deuda',
    causa: 'Choque "Pago completo" vs "Cuota".',
    pasos: [
      'Cambiar a Ajuste el tipo de la cuota paga.',
      'Renombrar y resubir el archivo.',
    ],
  },
  {
    id: 'sin_contenido',
    patron: /archivo sin contenido/,
    titulo: 'Archivo sin contenido',
    causa: 'Problema de la entidad recaudadora.',
    pasos: ['Contactar a la entidad recaudadora.'],
  },
];

export function clasificarErrorLote(error) {
  const t = fold(error);
  return ERRORES_LOTE.find((e) => e.patron.test(t)) || {
    id: 'otro',
    titulo: 'Error de lote sin procedimiento documentado',
    causa: 'No hay procedimiento documentado para este error.',
    pasos: ['Revisar el archivo del lote y consultarlo con el resto de Soporte de Aplicaciones. No inventar procedimientos.'],
  };
}

/** Equivalente a: awk '{print substr($0, length($0)-39)}' | sort | uniq -d */
export function detectarDuplicados(contenido) {
  const cuenta = new Map();
  String(contenido ?? '').split(/\r?\n/).forEach((l) => {
    const linea = l.replace(/\r/g, '');
    if (!linea.trim()) return;
    const cod = linea.length > 40 ? linea.slice(-40) : linea;
    cuenta.set(cod, (cuenta.get(cod) || 0) + 1);
  });
  return [...cuenta.entries()].filter(([, n]) => n > 1).map(([c]) => c).sort();
}

// ---------------------------------------------------------------------------
// Datos faltantes
// ---------------------------------------------------------------------------

export const ETIQUETAS = {
  fechaPago: 'Fecha de pago',
  montoPagado: 'Monto pagado',
  nombre: 'Nombre inscripto',
  dni: 'Número de documento',
  concepto: 'Concepto Ingreso',
  subconcepto: 'SubConcepto Ingreso',
  planPago: 'Plan Pago',
  archivo: 'Nombre de archivo',
  entidad: 'Entidad Recaudadora',
};

function camposNecesarios(pnp) {
  const a = pnp.accion;
  if (a.tipo === 'cobro_manual') return ['fechaPago', 'montoPagado'];
  if (a.tipo !== 'derivar') return [];
  if (a.motivo === 'cuota_inexistente') return ['fechaPago', 'montoPagado'];
  const c = ['fechaPago', 'montoPagado', 'nombre'];
  if (pnp.area.key && pnp.area.key !== 'EL') c.push('dni');
  c.push('concepto', 'subconcepto', 'planPago');
  return c;
}

function vacio(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// ---------------------------------------------------------------------------
// Cruce con el mensaje de Tesorería
// ---------------------------------------------------------------------------

// Puntaje de cada señal. Confianza: alta ≥ 6, media ≥ 4, baja ≥ 3.
const PESOS = {
  lote: 3, monto: 3, suma: 3, fecha: 2, fechaCerca: 1, nombre: 3, nombreParecido: 2,
  cuota: 1, idCodigo: 4, fechaDistinta: -2, nombreDistinto: -3,
};
const UMBRAL = { alta: 6, media: 4, baja: 3 };

const CONFIANZA_ORDEN = { alta: 3, media: 2, baja: 1 };

function montosIguales(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined &&
    Math.abs(a - b) <= CONFIG.tesoreria.toleranciaMonto;
}

function redondear(n) {
  return Math.round(n * 100) / 100;
}

function diasEntre(a, b) {
  const da = parseFecha(a);
  const db = parseFecha(b);
  if (!da || !db) return null;
  return Math.round(Math.abs(da - db) / 86400000);
}

/** 'igual' | 'parecido' | 'distinto' | null (sin datos o sin señal clara). Recibe nombres normalizados. */
export function compararNombres(a, b) {
  if (!a || !b) return null;
  if (a === b) return 'igual';
  const ta = new Set(a.split(' '));
  const tb = b.split(' ');
  const comunes = tb.filter((t) => ta.has(t)).length;
  if (comunes >= 2 && comunes === Math.min(ta.size, tb.length)) return 'parecido';
  if (comunes === 0) return 'distinto';
  return null;
}

/**
 * Pagos de una misma orden (o mismo mail) dentro del mismo lote EL, que en el
 * SCI pueden haber llegado como un único pago por la suma.
 * [{ pagos, monto, loteEl, por: 'orden 2122945' | 'mail x@y' }]
 */
export function gruposSuma(pagos) {
  const grupos = new Map();
  const agregar = (clave, por, p) => {
    if (!grupos.has(clave)) grupos.set(clave, { pagos: [], por, loteEl: p.loteEl });
    grupos.get(clave).pagos.push(p);
  };
  for (const p of pagos) {
    if (p.montoBruto === null) continue;
    const lote = p.loteEl ?? 'sin-lote';
    if (p.idOrden) agregar(`${lote}|orden|${p.idOrden}`, `orden ${p.idOrden}`, p);
    if (p.email) agregar(`${lote}|mail|${p.email.toLowerCase()}`, `mail ${p.email}`, p);
  }
  const vistos = new Set();
  const res = [];
  for (const g of grupos.values()) {
    if (g.pagos.length < 2) continue;
    const firma = g.pagos.map((p) => p.idPago).sort().join(',');
    if (vistos.has(firma)) continue;
    vistos.add(firma);
    res.push({ ...g, monto: redondear(g.pagos.reduce((t, p) => t + p.montoBruto, 0)) });
  }
  return res;
}

/** "184.866 = 2 × 92.433" o "150.000 = 100.000 + 50.000". */
function textoSuma(monto, pagos) {
  const iguales = pagos.every((p) => montosIguales(p.montoBruto, pagos[0].montoBruto));
  const detalle = iguales
    ? `${pagos.length} × ${formatMonto(pagos[0].montoBruto)}`
    : pagos.map((p) => formatMonto(p.montoBruto)).join(' + ');
  return `${formatMonto(monto)} = ${detalle}`;
}

function nombresPnp(p) {
  const n = [];
  if (p.fuentes.nombre && p.fuentes.nombre !== 'tesoreria' && p.campos.nombre) n.push(p.campos.nombre);
  if (p.datos.alumno) n.push(p.datos.alumno);
  return n;
}

/** Puntaje de un PNP contra una opción (un pago o una suma de pagos). null = no es candidato. */
function puntuar(p, L, op) {
  const razones = [];
  let puntaje = 0;
  let evidencia = false;
  const sumar = (k, texto) => { puntaje += PESOS[k]; if (texto) razones.push(texto); };

  const loteP = L && L.loteEl !== null && L.loteEl !== undefined ? L.loteEl : null;
  if (loteP !== null && op.loteEl !== null) {
    if (loteP !== op.loteEl) return null;
    sumar('lote', `mismo lote EL ${op.loteEl}`);
  }

  const monto = p.campos.montoPagado;
  if (op.suma) {
    if (!montosIguales(monto, op.monto)) return null;
    sumar('suma', `monto ${textoSuma(op.monto, op.pagos)} (${op.por})`);
    evidencia = true;
  } else if (montosIguales(monto, op.monto)) {
    sumar('monto', `monto ${formatMonto(op.monto)} coincide`);
    evidencia = true;
  }

  const cuota = p.campos.montoCuota;
  if (cuota !== null && cuota !== undefined && op.pagos.every((x) => montosIguales(x.montoBruto, cuota))) {
    sumar('cuota', `monto de la cuota (${formatMonto(cuota)}) = monto del pago`);
  }

  const fechas = [...new Set(op.pagos.map((x) => x.fechaPago).filter(Boolean))];
  if (p.campos.fechaPago && fechas.length === 1) {
    const d = diasEntre(p.campos.fechaPago, fechas[0]);
    if (d === 0) sumar('fecha', `misma fecha de pago (${fechas[0]})`);
    else if (d === 1) sumar('fechaCerca', `fecha de pago a 1 día (${p.campos.fechaPago} / ${fechas[0]})`);
    else if (d !== null) sumar('fechaDistinta', `fecha de pago distinta (${p.campos.fechaPago} / ${fechas[0]})`);
  }

  let mejor = null;
  for (const n of nombresPnp(p)) {
    const r = compararNombres(normalizarNombre(n), op.pagos[0].nombreNormalizado);
    if (r === 'igual' || (r === 'parecido' && mejor !== 'igual') || (r === 'distinto' && !mejor)) mejor = r;
  }
  if (mejor === 'igual') { sumar('nombre', 'nombre coincide'); evidencia = true; }
  else if (mejor === 'parecido') { sumar('nombreParecido', 'nombre parecido'); evidencia = true; }
  else if (mejor === 'distinto') sumar('nombreDistinto', `nombre distinto (SCI: ${nombresPnp(p)[0]})`);

  const cod = desglosarCodigoBarras(p.campos.codigoBarras || p.codigo);
  if (cod && op.pagos.some((x) => x.idPago === cod.id || x.idOrden === cod.id)) {
    sumar('idCodigo', `el ID del código de barras (${cod.id}) es el del pago`);
    evidencia = true;
  }

  if (!evidencia || puntaje < UMBRAL.baja) return null;
  const confianza = puntaje >= UMBRAL.alta ? 'alta' : puntaje >= UMBRAL.media ? 'media' : 'baja';
  return { pnp: p, pagos: op.pagos, suma: !!op.suma, monto: op.monto, loteEl: op.loteEl, por: op.por || '', puntaje, confianza, razones };
}

/**
 * Cruza los PNP con los pagos del mensaje de Tesorería.
 *   pnps: modelo.pnps (con campos), pagos: parsearTesoreria(), lotes: modelo.lotes (con loteEl).
 * Devuelve {
 *   porPnp: { [idKey]: { estado: 'cruzado', pagos, confianza, razones, suma, … } | { estado: 'ambiguo', candidatos } },
 *   filas: [{ pago, estado: 'cruzado'|'ambiguo'|'sin_pnp'|'sin_datos', pnp?, pnps?, confianza?, razones? }],
 *   sugerencias: [{ loteKey, lote, loteEl, pnpId }], sinDatos: [PNP] }
 * Asignación uno a uno (salvo sumas); si hay empate no se elige: queda ambiguo.
 */
export function cruzarTesoreria(pnps, pagos, lotes = []) {
  const loteDe = (p) => lotes.find((L) => L.key === p.loteKey) || null;
  const opciones = [
    ...pagos.filter((x) => x.montoBruto !== null || x.nombreNormalizado)
      .map((x) => ({ pagos: [x], monto: x.montoBruto, loteEl: x.loteEl })),
    ...gruposSuma(pagos).map((g) => ({ ...g, suma: true })),
  ];

  const usados = new Map(); // pago → 'cruzado' | 'ambiguo'
  const porPnp = {};

  // 1. Los que el usuario eligió a mano ("Usar estos datos").
  for (const p of pnps) {
    const ids = p.pagosElegidos || [];
    if (!ids.length) continue;
    const elegidos = ids.map((id) => pagos.find((x) => x.idPago === id)).filter(Boolean);
    if (elegidos.length !== ids.length || elegidos.some((x) => usados.has(x))) continue;
    const loteEl = elegidos.every((x) => x.loteEl === elegidos[0].loteEl) ? elegidos[0].loteEl : null;
    const monto = redondear(elegidos.reduce((t, x) => t + (x.montoBruto || 0), 0));
    const calc = puntuar(p, loteDe(p), { pagos: elegidos, monto, loteEl, suma: elegidos.length > 1, por: 'elegidos a mano' });
    porPnp[p.idKey] = {
      estado: 'cruzado', pnp: p, pagos: elegidos, suma: elegidos.length > 1, monto, loteEl,
      confianza: 'alta', manual: true, razones: ['elegido a mano', ...(calc ? calc.razones : [])],
    };
    elegidos.forEach((x) => usados.set(x, 'cruzado'));
  }

  // 2. Puntaje de todos los pares y asignación de mayor a menor.
  const pares = [];
  for (const p of pnps) {
    if (porPnp[p.idKey]) continue;
    for (const op of opciones) {
      const r = puntuar(p, loteDe(p), op);
      if (r) pares.push(r);
    }
  }
  pares.sort((a, b) => b.puntaje - a.puntaje);
  const libre = (par) => !par.pagos.some((x) => usados.has(x));
  const mismosPagos = (a, b) => a.pagos.length === b.pagos.length && a.pagos.every((x) => b.pagos.includes(x));

  for (const par of pares) {
    if (porPnp[par.pnp.idKey] || !libre(par)) continue;
    const rivales = pares.filter((o) => o !== par && o.puntaje === par.puntaje && libre(o) && !porPnp[o.pnp.idKey] && (
      (o.pnp === par.pnp && !mismosPagos(o, par)) ||
      (o.pnp !== par.pnp && o.pagos.some((x) => par.pagos.includes(x)))));
    if (!rivales.length) {
      porPnp[par.pnp.idKey] = { estado: 'cruzado', ...par };
      par.pagos.forEach((x) => usados.set(x, 'cruzado'));
      continue;
    }
    const empate = [par, ...rivales];
    for (const p of new Set(empate.map((e) => e.pnp))) {
      porPnp[p.idKey] = { estado: 'ambiguo', pnp: p, candidatos: empate.filter((e) => e.pnp === p) };
    }
    empate.forEach((e) => e.pagos.forEach((x) => usados.set(x, 'ambiguo')));
  }

  // 3. Lotes SCI sin archivo: sugerir el lote EL si un PNP cruzó alto por nombre.
  const sugerencias = [];
  for (const L of lotes) {
    if (L.loteEl !== null && L.loteEl !== undefined) continue;
    const candidatos = new Map();
    for (const p of L.pnps || pnps.filter((x) => x.loteKey === L.key)) {
      const r = porPnp[p.idKey];
      if (!r || r.estado !== 'cruzado' || r.confianza !== 'alta' || r.loteEl === null) continue;
      if (!r.razones.includes('nombre coincide')) continue;
      if (!candidatos.has(r.loteEl)) candidatos.set(r.loteEl, p);
    }
    if (candidatos.size === 1) {
      const [[loteEl, p]] = [...candidatos];
      sugerencias.push({ loteKey: L.key, lote: L.lote, loteEl, pnpId: p.id });
    }
  }

  // 4. PNP que no se pueden cruzar porque no tienen monto (B2 sin la query).
  const sinDatos = pnps.filter((p) => !porPnp[p.idKey] && p.campos.montoPagado === null);

  const filas = pagos.map((x) => {
    const estado = usados.get(x);
    if (estado === 'cruzado') {
      const r = Object.values(porPnp).find((v) => v.estado === 'cruzado' && v.pagos.includes(x));
      return { pago: x, estado, pnp: r.pnp, confianza: r.confianza, razones: r.razones, cruce: r };
    }
    if (estado === 'ambiguo') {
      const ps = Object.values(porPnp)
        .filter((v) => v.estado === 'ambiguo' && v.candidatos.some((c) => c.pagos.includes(x)))
        .map((v) => v.pnp);
      const razones = Object.values(porPnp)
        .filter((v) => v.estado === 'ambiguo')
        .flatMap((v) => v.candidatos.filter((c) => c.pagos.includes(x)))[0]?.razones || [];
      return { pago: x, estado, pnps: ps, razones };
    }
    const compatible = sinDatos.some((p) => {
      const L = loteDe(p);
      return !L || L.loteEl === null || L.loteEl === undefined || x.loteEl === null || L.loteEl === x.loteEl;
    });
    return { pago: x, estado: !pnps.length || compatible ? 'sin_datos' : 'sin_pnp' };
  });

  return { porPnp, filas, sugerencias, sinDatos };
}

// ---------------------------------------------------------------------------
// Modelo completo
// ---------------------------------------------------------------------------

/**
 * Entrada:
 *   texto, query: strings pegados
 *   overrides: { lotes: { [num]: { entidad, archivo } },
 *                pnps: { [idSinCeros]: { area, decision, recibo, fechaPago, montoPagado,
 *                         nombre, dni, concepto, subconcepto, planPago, notas, motivoBeca,
 *                         cuit, razonSocial } } }
 */
export function analizar({ texto = '', query = '', tesoreria = '', overrides = {} } = {}) {
  const ovLotes = overrides.lotes || {};
  const ovPnps = overrides.pnps || {};
  const filasQuery = parsearQuery(query);
  let pagosTes = parsearTesoreria(tesoreria);
  let tipo = detectarTipo(texto);
  let tesoreriaEnTexto = false;
  // Si en el cuadro 1 pegaron el mail de Tesorería, se toma como tal.
  if (tipo === 'usuario' && !pagosTes.length) {
    const t = parsearTesoreria(texto);
    if (t.length) { pagosTes = t; tesoreriaEnTexto = true; texto = ''; tipo = 'vacio'; }
  }
  if (tipo === 'vacio' && pagosTes.length) tipo = 'tesoreria';
  else if (tipo === 'vacio' && filasQuery.length) tipo = 'pnp';

  const loteTexto = extraerLote(texto);
  const infoTexto = extraerInfoLote(texto);
  const modelo = { tipo, loteTexto, infoTexto, lotes: [], pnps: [], avisos: [] };
  if (tesoreriaEnTexto) {
    modelo.avisos.push({ nivel: 'info', texto: 'El cuadro 1 parece el mensaje de Tesorería: lo tomé como tal (su lugar es el cuadro 4).' });
  }

  if (tipo === 'notificacion') return modelo;

  if (tipo === 'error_lote') {
    const el = extraerErrorLote(texto);
    const ov = (loteTexto && ovLotes[loteTexto.num]) || {};
    modelo.errorLote = {
      ...el,
      caso: clasificarErrorLote(el.error),
      lote: loteTexto,
      entidad: ov.entidad || infoTexto.entidad || '',
      archivo: ov.archivo || infoTexto.archivo || '',
    };
    if (!loteTexto) modelo.avisos.push({ nivel: 'alerta', texto: 'No encontré el número de lote en el texto.' });
    return modelo;
  }

  if (tipo === 'usuario') {
    modelo.pistas = extraerPistasUsuario(texto);
    return modelo;
  }

  if (tipo !== 'pnp' && tipo !== 'tesoreria') return modelo;

  // --- Filas del texto + filas de la query -----------------------------------
  const filas = parsearFilasPnp(texto);
  const usadas = new Set();
  const buscarFilaQuery = (nro, codigo) => {
    let i = filasQuery.findIndex((q, k) => !usadas.has(k) && q.PNP_Id && sinCeros(q.PNP_Id) === sinCeros(nro));
    if (i < 0 && codigo && codigo.length > 10) {
      i = filasQuery.findIndex((q, k) => !usadas.has(k) && q.CodigoBarras && q.CodigoBarras === codigo);
    }
    if (i < 0) return null;
    usadas.add(i);
    return filasQuery[i];
  };

  const crudos = filas.map((f) => ({ ...f, q: buscarFilaQuery(f.nro, f.codigo), origen: 'texto' }));
  filasQuery.forEach((q, k) => {
    if (usadas.has(k)) return;
    crudos.push({ nro: q.PNP_Id, codigo: q.CodigoBarras, error: q.Error, q, origen: 'query' });
  });

  // --- Lotes ------------------------------------------------------------------
  const lotes = new Map();
  const obtenerLote = (lote) => {
    const key = lote ? String(lote.num) : 'sin-lote';
    if (!lotes.has(key)) {
      lotes.set(key, { key, lote, entidad: '', archivo: '', fuente: {}, pnps: [] });
    }
    return lotes.get(key);
  };

  for (const c of crudos) {
    const loteFila = (c.q && loteDesde(c.q.Lote_Id)) || loteTexto;
    const L = obtenerLote(loteFila);
    if (c.q) {
      if (!L.entidad && c.q.EntidadRecaudadora) { L.entidad = c.q.EntidadRecaudadora; L.fuente.entidad = 'query'; }
      if (!L.archivo && c.q.NombreArchivo) { L.archivo = c.q.NombreArchivo; L.fuente.archivo = 'query'; }
    }
    c.L = L;
  }
  for (const L of lotes.values()) {
    if (!L.entidad && infoTexto.entidad) { L.entidad = infoTexto.entidad; L.fuente.entidad = 'texto'; }
    if (!L.archivo && infoTexto.archivo) { L.archivo = infoTexto.archivo; L.fuente.archivo = 'texto'; }
    const ov = (L.lote && ovLotes[L.lote.num]) || ovLotes[L.key] || {};
    if (!vacio(ov.entidad)) { L.entidad = ov.entidad.trim(); L.fuente.entidad = 'manual'; }
    if (!vacio(ov.archivo)) { L.archivo = ov.archivo.trim(); L.fuente.archivo = 'manual'; }
    // Lote de E-Learning: del nombre de archivo, o de la sugerencia del cruce con Tesorería si se aceptó.
    L.loteEl = loteElDesdeArchivo(L.archivo);
    if (L.loteEl !== null) L.fuente.loteEl = 'archivo';
    else if (!vacio(ov.loteEl) && Number.isFinite(Number(ov.loteEl))) { L.loteEl = Number(ov.loteEl); L.fuente.loteEl = 'sugerencia'; }
  }

  // --- PNPs -------------------------------------------------------------------
  for (const c of crudos) {
    const L = c.L;
    const idKey = sinCeros(c.nro);
    const ov = ovPnps[idKey] || {};
    const cl = clasificarError(c.error, c.codigo);
    const d = cl.datos;
    const q = c.q || {};

    const tomar = (campo, ...candidatos) => {
      if (!vacio(ov[campo])) return { v: String(ov[campo]).trim(), f: 'manual' };
      for (const [v, f] of candidatos) if (!vacio(v)) return { v, f };
      return { v: '', f: null };
    };

    const campos = {};
    const fuentes = {};
    const set = (campo, r) => { campos[campo] = r.v; fuentes[campo] = r.f; };
    set('fechaPago', tomar('fechaPago', [formatFecha(q.FechaPago), 'query']));
    const monto = tomar('montoPagado', [parseNumero(q.MontoPagado), 'query'], [d.montoPagado, 'error']);
    campos.montoPagado = monto.v === '' ? null : parseNumero(monto.v);
    fuentes.montoPagado = monto.f;
    set('nombre', tomar('nombre', [q.NombreInscripto, 'query'], [d.alumno, 'error']));
    set('dni', tomar('dni', [q.DNI, 'query']));
    set('concepto', tomar('concepto', [q.ConceptoIngreso, 'query']));
    set('subconcepto', tomar('subconcepto', [q.SubConceptoIngreso, 'query'], [d.subconcepto, 'error']));
    set('planPago', tomar('planPago', [q.PlanPago, 'query']));
    for (const opc of ['notas', 'motivoBeca', 'cuit', 'razonSocial', 'recibo', 'email']) {
      campos[opc] = vacio(ov[opc]) ? '' : String(ov[opc]).trim();
      if (campos[opc]) fuentes[opc] = 'manual';
    }
    campos.codigoBarras = q.CodigoBarras || c.codigo || '';
    campos.montoCuota = parseNumero(q.MontoCuota) ?? d.montoCuota ?? null;

    const pnp = {
      id: c.nro,
      idKey,
      origen: c.origen,
      codigo: c.codigo,
      error: c.error,
      errorCorto: d.errorCorto,
      tipo: cl.tipo,
      sub: cl.sub,
      datos: d,
      campos,
      fuentes,
      loteKey: L.key,
      mojibake: tieneMojibake(d.alumno) || tieneMojibake(q.NombreInscripto) || tieneMojibake(ov.nombre),
      decision: ov.decision || 'pendiente',
      pagosElegidos: Array.isArray(ov.pagosTesoreria) ? ov.pagosTesoreria.map(String) : [],
    };

    const auto = detectarArea({
      archivo: L.archivo,
      concepto: campos.concepto,
      subconcepto: [campos.subconcepto, d.subconcepto].filter(Boolean).join(' '),
      alumno: [d.alumno, campos.nombre].filter(Boolean).join(' '),
    });
    pnp.areaDetectada = auto;
    pnp.area = ov.area && CONFIG.areas[ov.area]
      ? { key: ov.area, fuente: 'manual', detalle: 'elegida a mano' }
      : auto;

    pnp.accion = resolverAccion(pnp, pnp.decision);
    L.pnps.push(pnp);
    modelo.pnps.push(pnp);
  }

  // --- Cruce con Tesorería ----------------------------------------------------
  if (pagosTes.length) {
    const cruce = cruzarTesoreria(modelo.pnps, pagosTes, [...lotes.values()]);
    modelo.tesoreria = { pagos: pagosTes, ...cruce };
    for (const p of modelo.pnps) {
      const r = cruce.porPnp[p.idKey] || null;
      p.tesoreria = r;
      p.completadoTesoreria = [];
      if (!r || r.estado !== 'cruzado' || r.confianza !== 'alta') continue;
      // Solo se completan huecos: nunca se pisa un dato de la query, del error o manual.
      const llenar = (campo, v) => {
        if (vacio(v) || !vacio(p.campos[campo])) return;
        p.campos[campo] = v;
        p.fuentes[campo] = 'tesoreria';
        p.completadoTesoreria.push(campo);
      };
      const uno = (f) => { const vs = [...new Set(r.pagos.map(f).filter((v) => !vacio(v)))]; return vs.length === 1 ? vs[0] : ''; };
      if (new Set(r.pagos.map((x) => x.nombreNormalizado)).size === 1) llenar('nombre', r.pagos[0].nombre);
      llenar('fechaPago', uno((x) => x.fechaPago));
      llenar('email', uno((x) => x.email.toLowerCase()));
      if (p.campos.montoPagado === null && r.pagos.every((x) => x.montoBruto !== null)) {
        p.campos.montoPagado = redondear(r.pagos.reduce((t, x) => t + x.montoBruto, 0));
        p.fuentes.montoPagado = 'tesoreria';
        p.completadoTesoreria.push('montoPagado');
      }
      const L = lotes.get(p.loteKey);
      if (L && vacio(L.entidad) && r.pagos.every((x) => x.entidad === 'Mercado Pago')) {
        L.entidad = 'Mercado Pago';
        L.fuente.entidad = 'tesoreria';
      }
    }
  }

  for (const pnp of modelo.pnps) {
    const campos = pnp.campos;
    pnp.faltantes = camposNecesarios(pnp).filter((k) => (k === 'montoPagado' ? campos.montoPagado === null : vacio(campos[k])));

    // B2: el nombre no viene de la query; se recomienda conseguirlo de otra fuente.
    pnp.faltaNombreB2 = pnp.accion.tipo === 'derivar' && pnp.accion.motivo === 'cuota_inexistente' && vacio(campos.nombre);
    pnp.nombreDeTesoreria = pnp.fuentes.nombre === 'tesoreria';
    pnp.faltaRecibo = pnp.accion.tipo === 'cobro_manual' && vacio(campos.recibo);
    pnp.areaIndeterminada = pnp.accion.tipo === 'derivar' && !pnp.area.key;
    const r = pnp.tesoreria;
    if (r && r.estado === 'cruzado' && r.suma) {
      const iguales = r.pagos.every((x) => montosIguales(x.montoBruto, r.pagos[0].montoBruto));
      const n = r.pagos.length;
      const cuantas = { 2: 'dos', 3: 'tres', 4: 'cuatro' }[n] || String(n);
      const de = r.por.startsWith('mail') ? 'del mismo mail' : 'de la misma orden';
      const detalle = iguales ? `${n} pagos de ${formatMonto(r.pagos[0].montoBruto)}` : `${n} pagos (${r.pagos.map((x) => formatMonto(x.montoBruto)).join(' + ')})`;
      pnp.avisoSuma = `El monto pagado (${formatMonto(r.monto)}) es la suma de ${detalle} ${de}: pagó ${cuantas} cuotas en un mismo pago.`;
    }
  }

  for (const L of lotes.values()) {
    const necesita = new Set();
    for (const p of L.pnps) {
      if (p.accion.tipo === 'derivar') { necesita.add('archivo'); necesita.add('entidad'); }
      if (p.accion.tipo === 'cobro_manual') necesita.add('entidad');
      if (p.areaIndeterminada) necesita.add('archivo');
    }
    L.faltantes = ['archivo', 'entidad'].filter((k) => necesita.has(k) && vacio(L[k]));
    modelo.lotes.push(L);
  }

  // --- Avisos -----------------------------------------------------------------
  if (tipo === 'pnp' && !filas.length && !filasQuery.length) {
    modelo.avisos.push({ nivel: 'alerta', texto: 'Parece un lote con PNP pero no pude leer ninguna fila Nº / Código de Barras / Error. Revisá el texto pegado.' });
  }
  if (tipo === 'pnp' && !loteTexto && !filasQuery.some((q) => q.Lote_Id)) {
    modelo.avisos.push({ nivel: 'alerta', texto: 'No encontré el número de lote en el texto.' });
  }
  for (const p of modelo.pnps) {
    if (p.mojibake) {
      modelo.avisos.push({ nivel: 'alerta', pnp: p.id, texto: `PNP ${p.id}: el nombre tiene caracteres rotos (${p.datos.alumno || p.campos.nombre}). Avisar a Soporte de Aplicaciones para que corrijan el nombre ANTES de cobrar (si no, el sistema rompe).` });
    }
    if (p.areaIndeterminada) {
      modelo.avisos.push({ nivel: 'alerta', pnp: p.id, texto: `PNP ${p.id}: área dueña indeterminada. Necesito el Nombre de Archivo del lote (Cobros externos → Lotes) o elegí el área a mano.` });
    }
    if (p.nombreDeTesoreria) {
      const r = p.tesoreria;
      modelo.avisos.push({ nivel: 'info', pnp: p.id, texto: `PNP ${p.id}: nombre tomado del mensaje de Tesorería (pago ${r.pagos.map((x) => x.idPago).join(' + ')}${r.loteEl !== null ? `, lote EL ${r.loteEl}` : ''}).` });
    }
    if (p.avisoSuma) modelo.avisos.push({ nivel: 'info', pnp: p.id, texto: `PNP ${p.id}: ${p.avisoSuma}` });
    if (p.faltaNombreB2) {
      modelo.avisos.push({ nivel: 'info', pnp: p.id, texto: `PNP ${p.id}: la cuota no existe en SCI, así que la query no trae nombre ni concepto. Sacá el nombre del inscripto de otra fuente (SysGestión, Mercado Pago, comprobante); si no se consigue, la línea se omite.` });
    }
    if (p.faltaRecibo) {
      modelo.avisos.push({ nivel: 'info', pnp: p.id, texto: `PNP ${p.id}: cargá el Nº de recibo del cobro manual.` });
    }
    if (p.origen === 'query') {
      modelo.avisos.push({ nivel: 'info', pnp: p.id, texto: `PNP ${p.id}: vino solo en la query (no estaba en el texto del ticket).` });
    }
  }
  if (modelo.tesoreria) avisosTesoreria(modelo);
  return modelo;
}

function listaIds(pnps) {
  const ids = pnps.map((p) => p.id);
  return ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} y ${ids[ids.length - 1]}`;
}

function avisosTesoreria(modelo) {
  const t = modelo.tesoreria;
  for (const x of t.pagos) if (x.aviso) modelo.avisos.push({ nivel: 'alerta', texto: `Tesorería: ${x.aviso}` });
  if (t.sinDatos.length) {
    const todosB2 = t.sinDatos.every((p) => p.tipo === 'B2');
    const n = t.sinDatos.length;
    modelo.avisos.push({
      nivel: 'alerta',
      texto: `${n === 1 ? 'El PNP' : 'Los PNP'} ${listaIds(t.sinDatos)}${todosB2 ? ' (no existe la cuota)' : ''} no ${n === 1 ? 'trae' : 'traen'} monto ni fecha de pago: hace falta la query para cruzarlos con Tesorería. Corré la query de "Datos faltantes" y pegá la grilla en el cuadro 2.`,
    });
  }
  for (const s of t.sugerencias) {
    modelo.avisos.push({
      nivel: 'info',
      texto: `Sugerencia: el lote SCI ${s.lote ? s.lote.id8 : '?'} parece ser el lote EL ${s.loteEl} (el PNP ${s.pnpId} cruzó con confianza alta por nombre). No está confirmado: confirmalo con el Nombre de archivo del lote.`,
    });
  }
}
