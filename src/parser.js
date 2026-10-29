// Parser: lee el texto pegado del ticket/mail del SCI y la grilla de la query.
// Todo es tolerante a tabs, espacios, saltos de línea y tildes.

import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

/** Minúsculas y sin tildes, para comparar. */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Colapsa cualquier espacio (tabs, saltos, nbsp) a un espacio simple. */
export function squash(s) {
  return String(s ?? '').replace(/[   ​]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Saca los ceros a la izquierda (para comparar IDs). */
export function sinCeros(s) {
  const t = String(s ?? '').trim().replace(/^0+(?=\d)/, '');
  return t;
}

/** Caracteres típicos de un nombre con encoding roto (UTF-8 leído como Latin-1). */
export function tieneMojibake(s) {
  return /Ã|Â|�|â€|Ã³|Ã±|Ã©|Ã¡|Ã­|Ãº/.test(String(s ?? ''));
}

// ---------------------------------------------------------------------------
// Números, montos y fechas
// ---------------------------------------------------------------------------

/**
 * Convierte "166500", "129550,0000", "166500.00", "166.500", "1.234,50" a número.
 * Devuelve null si no se puede.
 */
export function parseNumero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[$\s]/g, '');
  if (!s || /^null$/i.test(s)) return null;
  const tienePunto = s.includes('.');
  const tieneComa = s.includes(',');
  if (tienePunto && tieneComa) {
    // El último separador es el decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (tieneComa) {
    const partes = s.split(',');
    // "1,234,567" → miles; "129550,0000" → decimal
    if (partes.length > 2) s = partes.join('');
    else s = s.replace(',', '.');
  } else if (tienePunto) {
    const partes = s.split('.');
    // "166.500" o "1.234.567" → miles; "166500.00" / "166500.0000" → decimal
    const esMiles = partes.length > 2 || (partes[1].length === 3 && partes[0].length <= 3);
    if (esMiles) s = partes.join('');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 166500 → "166.500"; 1234.5 → "1.234,50". */
export function formatMonto(v) {
  const n = typeof v === 'number' ? v : parseNumero(v);
  if (n === null) return '';
  const entero = Math.round(n * 100) % 100 === 0;
  const [ent, dec] = (entero ? Math.round(n).toString() : n.toFixed(2)).split('.');
  const neg = ent.startsWith('-');
  const digitos = neg ? ent.slice(1) : ent;
  const conMiles = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + conMiles + (dec ? ',' + dec : '');
}

/** Normaliza una fecha a DD/MM/AAAA. Acepta DD/MM/AAAA, D/M/AA, AAAA-MM-DD (con hora o no). */
export function formatFecha(v) {
  if (v instanceof Date) {
    return `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`;
  }
  const s = String(v ?? '').trim();
  if (!s || /^null$/i.test(s)) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const anio = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${anio}`;
  }
  return s;
}

/** "21/10/2026" → Date (local). null si no es válida. */
export function parseFecha(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

/** Suma días hábiles salteando sábados y domingos. */
export function sumarDiasHabiles(fecha, dias) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  let restantes = dias;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Tipo de ticket (tabla A)
// ---------------------------------------------------------------------------

/**
 * 'notificacion' | 'error_lote' | 'pnp' | 'usuario' | 'vacio'
 */
export function detectarTipo(texto) {
  const t = fold(squash(texto));
  if (!t) return 'vacio';
  if (/se produjo un error al (generar|procesar) el lote/.test(t) ||
      /\blote\s*(?:nro\.?\s*:?\s*)?\d+\s+con el siguiente error/.test(t)) {
    return 'error_lote';
  }
  if (/se ha generado un nuevo lote nro/.test(t) && /e-?\s?learning\s+carg/.test(t) && /pendiente/.test(t)) {
    return 'notificacion';
  }
  if (parsearFilasPnp(texto).length > 0 || /pagos? no procesables?/.test(t) ||
      (/se ha generado un nuevo lote/.test(t) && /codigo de barras/.test(t))) {
    return 'pnp';
  }
  return 'usuario';
}

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

/** { raw: '00020457', num: 20457, id8: '00020457' } o null. */
export function extraerLote(texto) {
  const s = squash(texto);
  let m = s.match(/\bLote\b\s*(?:Nro\.?|N[º°o]\.?)?\s*:?\s*(\d{2,})/i);
  if (!m) m = s.match(/Filter_Id=(\d+)/i);
  if (!m) return null;
  return loteDesde(m[1]);
}

export function loteDesde(v) {
  const raw = String(v ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const num = Number(raw);
  return { raw, num, id8: String(num).padStart(8, '0') };
}

/**
 * Lote de E-Learning a partir del nombre de archivo del lote:
 * FP.<n>.EL.<AAAAMMDD>.<loteEL>[_<loteSCI>].txt → loteEL (número). null si no es de E-Learning.
 */
export function loteElDesdeArchivo(nombre) {
  const base = String(nombre ?? '').split(/[\\/]+/).pop();
  const m = base.match(/\.EL\.\d{8}\.(\d+)(?:_\d+)?(?:\.|$)/i);
  return m ? Number(m[1]) : null;
}

/** Entidad, archivo y estado si el texto los trae (notificaciones). */
export function extraerInfoLote(texto) {
  const s = squash(texto);
  const info = {};
  let m = s.match(/Entidad Recaudadora\s*:\s*(.+?)(?=\s+(?:Monto Bruto|Comisi|Observaciones|Archivo|Nombre Archivo|Estado|Fecha)\b|$)/i);
  if (m) info.entidad = m[1].trim();
  m = s.match(/(?:Nombre Archivo(?:\/Lote)?|Archivo)\s*:\s*(\S+)/i);
  if (m) {
    const partes = m[1].split(/[\\/]+/);
    info.archivo = partes[partes.length - 1];
    info.rutaArchivo = m[1];
  }
  m = s.match(/Estado\s*:\s*([A-Za-zÁÉÍÓÚáéíóú]+)/);
  if (m) info.estado = m[1].toUpperCase();
  m = s.match(/Monto Bruto\s*:\s*([\d.,]+)/i);
  if (m) info.montoBruto = m[1];
  return info;
}

/** Texto del error de lote y, si viene, el código de cuota mencionado. */
export function extraerErrorLote(texto) {
  const s = squash(texto);
  const m = s.match(/con el siguiente error\s*:?\s*(.*?)(?:\s*Para m[aá]s informaci[oó]n.*)?$/i);
  const error = m ? m[1].trim() : '';
  const c = error.match(/Cuota\s*:\s*(\d{6,40})/i);
  return { error, codigoMencionado: c ? c[1] : '' };
}

// ---------------------------------------------------------------------------
// Filas de PNP: Nº / Código de Barras / Error
// ---------------------------------------------------------------------------

const PREFIJOS_ERROR = /(El monto pagado|No existe una Cuota|La Cuota\s*\()/gi;
const FILA_GENERICA = /(?<!\d)(\d{8})\s+(\d{6,40})\s+(?=[^\d\s])/g;
const PIE = /\s+(?:Para m[aá]s informaci[oó]n|Saludos|Atentamente|Este (?:es un )?(?:mensaje|correo))\b.*$/i;

/**
 * Devuelve [{ nro, codigo, error }]. Estrategia: ubicar cada error conocido y
 * retroceder para tomar Nº y código; para errores desconocidos, usar el patrón
 * "8 dígitos + 6-40 dígitos + texto" como separador de filas.
 */
export function parsearFilasPnp(texto) {
  const s = squash(texto);
  const inicios = new Map(); // posición del Nº → { nro, codigo, inicioError }

  for (const m of s.matchAll(PREFIJOS_ERROR)) {
    const antes = s.slice(0, m.index);
    const mm = antes.match(/(?<!\d)(\d{1,12})\s+(\d{1,40})\s*$/);
    if (mm) inicios.set(mm.index, { nro: mm[1], codigo: mm[2], inicioError: m.index });
  }
  for (const m of s.matchAll(FILA_GENERICA)) {
    if (!inicios.has(m.index)) {
      inicios.set(m.index, { nro: m[1], codigo: m[2], inicioError: m.index + m[0].length });
    }
  }

  const posiciones = [...inicios.keys()].sort((a, b) => a - b);
  const filas = [];
  posiciones.forEach((pos, i) => {
    const f = inicios.get(pos);
    const fin = i + 1 < posiciones.length ? posiciones[i + 1] : s.length;
    if (f.inicioError >= fin) return;
    let error = s.slice(f.inicioError, fin).trim();
    if (i === posiciones.length - 1) error = error.replace(PIE, '').trim();
    filas.push({ nro: f.nro, codigo: f.codigo, error });
  });
  return filas;
}

/** Datos que se pueden sacar del texto del error. */
export function extraerDatosError(error) {
  const e = String(error ?? '');
  const d = { tipo: 'B4' };
  let m;
  if ((m = e.match(/El monto pagado\s*\(\s*([\d.,]+)\s*\)\s*no coincide con el monto de la Cuota\s*\(\s*([\d.,]+)\s*\)(?:\s*ni el monto de pronto pago\s*\(\s*([\d.,]+)\s*\))?/i))) {
    d.tipo = 'B1';
    d.montoPagado = parseNumero(m[1]);
    d.montoCuota = parseNumero(m[2]);
    d.montoProntoPago = m[3] ? parseNumero(m[3]) : null;
  } else if ((m = e.match(/No existe una Cuota para el C\S{0,3}digo\s*:?\s*(\d+)/i))) {
    d.tipo = 'B2';
    d.codigoError = m[1];
  } else if ((m = e.match(/La Cuota\s*\(\s*(\d+)\s*\)\s*ya se encuentra asociada al Recibo\s*(\d+\/\d{4})(?:\s*\(\s*Id\s*=\s*(\d+)\s*\))?/i))) {
    d.tipo = 'B3';
    d.cuotaId = m[1];
    d.recibo = m[2];
    d.reciboId = m[3] || '';
  }
  m = e.match(/Alumno\s*:\s*(.*?)\s*(?=Sub Concepto Ingreso\s*:|$)/i);
  if (m && m[1]) d.alumno = m[1].replace(/\s+,/g, ',').trim();
  m = e.match(/Sub Concepto Ingreso\s*:\s*(.*?)\s*$/i);
  if (m && m[1]) d.subconcepto = m[1].trim();
  // Lo que va en la línea "Error:" del ticket: sin la cola " Alumno: … Sub Concepto Ingreso: …".
  d.errorCorto = e.replace(/\s+Alumno\s*:.*$/i, '').trim();
  return d;
}

/** 26283 (AADDD) → "10/10/2026"; null si no es una fecha juliana válida. */
function fechaJuliana(aaddd) {
  const anio = 2000 + Number(aaddd.slice(0, 2));
  const dia = Number(aaddd.slice(2));
  if (dia < 1 || dia > 366) return null;
  const d = new Date(anio, 0, dia);
  return d.getFullYear() === anio ? formatFecha(d) : null;
}

/**
 * Lo que trae adentro un código de barras de 40 dígitos (0937022…): un ID y
 * dos fechas julianas AADDD. Es informativo: no se sabe con certeza qué es el ID.
 * { id, fechas: ['DD/MM/AAAA', …] } o null.
 */
export function desglosarCodigoBarras(codigo) {
  const c = String(codigo ?? '').trim();
  if (!/^0937022\d{33}$/.test(c)) return null;
  const fechas = [fechaJuliana(c.slice(14, 19)), fechaJuliana(c.slice(34, 39))].filter(Boolean);
  return { id: sinCeros(c.slice(19, 28)), fechas };
}

// ---------------------------------------------------------------------------
// Resultado de la query (grilla de SSMS)
// ---------------------------------------------------------------------------

export const COLUMNAS_QUERY = [
  'PNP_Id', 'Lote_Id', 'EntidadRecaudadora', 'NombreArchivo', 'Error', 'CodigoBarras',
  'FechaPago', 'MontoPagado', 'MontoCuota', 'NombreInscripto', 'DNI', 'ConceptoIngreso',
  'SubConceptoIngreso', 'PlanPago',
];

function partirLinea(linea, sep) {
  if (sep === '\t') return linea.split('\t');
  const campos = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (c === '"') comillas = false;
      else actual += c;
    } else if (c === '"' && actual.trim() === '') {
      comillas = true; actual = '';
    } else if (c === sep) {
      campos.push(actual); actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

/** Devuelve filas con las claves de COLUMNAS_QUERY. NULL → ''. */
export function parsearQuery(texto) {
  // Las líneas que empiezan con "--" son comentarios (como en SQL).
  const lineas = String(texto ?? '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*--/.test(l));
  if (!lineas.length) return [];
  const primera = lineas[0];
  const sep = primera.includes('\t') ? '\t' : primera.includes(';') ? ';' : ',';

  const porNombre = new Map(COLUMNAS_QUERY.map((c) => [fold(c).replace(/[^a-z]/g, ''), c]));
  const cab = partirLinea(primera, sep).map((c) => fold(c).replace(/[^a-z]/g, ''));
  let columnas;
  let datos = lineas;
  if (cab.some((c) => porNombre.has(c))) {
    columnas = cab.map((c) => porNombre.get(c) || null);
    datos = lineas.slice(1);
  } else {
    columnas = COLUMNAS_QUERY;
  }

  return datos.map((l) => {
    const valores = partirLinea(l, sep);
    const fila = {};
    COLUMNAS_QUERY.forEach((c) => { fila[c] = ''; });
    columnas.forEach((c, i) => {
      if (!c) return;
      const v = (valores[i] ?? '').trim();
      fila[c] = /^null$/i.test(v) ? '' : v;
    });
    return fila;
  }).filter((f) => f.PNP_Id || f.CodigoBarras || f.Error);
}

// ---------------------------------------------------------------------------
// Ticket de usuario: pistas para la búsqueda
// ---------------------------------------------------------------------------

export function extraerPistasUsuario(texto) {
  const s = squash(texto);
  const pistas = {};
  let m = s.match(/\bDNI\s*:?\s*(\d{1,2}\.?\d{3}\.?\d{3})\b/i) || s.match(/(?<![\d.])(\d{7,8})(?![\d.])/);
  if (m) pistas.dni = m[1].replace(/\./g, '');
  m = s.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  if (m) pistas.fecha = formatFecha(m[1]);
  m = s.match(/\$\s*([\d.,]+)/);
  if (m) {
    const n = parseNumero(m[1]);
    if (n !== null) pistas.monto = n;
  }
  return pistas;
}

// ---------------------------------------------------------------------------
// Mensaje de Tesorería (pagos sin número de recibo)
// ---------------------------------------------------------------------------

/** Sin tildes, minúsculas y tokens ordenados: "Lucia,Benitez" = "Benitez, Lucia". */
export function normalizarNombre(nombre) {
  return fold(nombre).split(/[^a-z0-9ñ]+/).filter(Boolean).sort().join(' ');
}

/** "Herrera,Nicolas" → "Herrera, Nicolas" (no cambia el orden ni las mayúsculas). */
export function formatNombreTesoreria(nombre) {
  return squash(nombre).replace(/\s*,\s*/g, ', ');
}

/** Quita el formato de mail de markdown u Outlook: [x](mailto:x), x<mailto:x>, mailto:x. */
function limpiarMails(texto) {
  return String(texto ?? '')
    .replace(/\[([^\]\s]+@[^\]\s]+)\]\(mailto:[^)]*\)/gi, '$1')
    .replace(/\s*<mailto:[^>]*>/gi, '')
    .replace(/mailto:/gi, '');
}

const conFlags = (re, flags) => new RegExp(re.source, flags);

/**
 * Lee el mail de Tesorería. Devuelve un pago por registro:
 * { idPago, idOrden, nombre, nombreNormalizado, email, idCurso, fechaAcreditacion,
 *   fechaPago, entidad, planMP, moneda, montoBruto, montoNeto, montoFacultad,
 *   estado, loteEl, crudo, aviso? }
 * Si un pago no se puede leer completo se devuelve igual, con `aviso`.
 */
export function parsearTesoreria(texto) {
  const cfg = CONFIG.tesoreria;
  const s = squash(limpiarMails(texto));
  if (!s) return [];

  const marcas = [...s.matchAll(conFlags(cfg.marcaLote, 'giu'))]
    .map((m) => ({ inicio: m.index, fin: m.index + m[0].length, lote: Number(m[1]) }));
  const dentroDeMarca = (i) => marcas.some((m) => i >= m.inicio && i < m.fin);
  const inicios = [...s.matchAll(conFlags(cfg.inicioPago, 'gu'))]
    .map((m) => m.index)
    .filter((i) => !dentroDeMarca(i));

  return inicios.map((inicio, k) => {
    const sigPago = k + 1 < inicios.length ? inicios[k + 1] : s.length;
    const marca = marcas.find((m) => m.inicio > inicio);
    const fin = Math.min(sigPago, marca ? marca.inicio : s.length);
    let crudo = s.slice(inicio, fin).trim();
    if (!marca || marca.inicio > sigPago || fin === s.length) crudo = crudo.replace(cfg.pie, '').trim();

    const pago = {
      idPago: '', idOrden: '', nombre: '', nombreNormalizado: '', email: '', idCurso: '',
      fechaAcreditacion: '', fechaPago: '', entidad: '', planMP: '', moneda: '',
      montoBruto: null, montoNeto: null, montoFacultad: null, estado: '',
      loteEl: marca && marca.inicio >= fin ? marca.lote : null,
      crudo,
    };
    const faltan = [];
    let resto = crudo;
    for (const col of cfg.columnas) {
      const m = resto.match(new RegExp(`^\\s*(?:${col.patron.source})`, col.patron.flags.replace(/[gy]/g, '')));
      if (!m) {
        if (col.opcional) continue;
        faltan.push(col.campo);
        break;
      }
      resto = resto.slice(m[0].length);
      if (!col.campo) continue;
      const v = m[0].trim();
      if (col.tipo === 'fecha') pago[col.campo] = formatFecha(v);
      else if (col.tipo === 'monto') pago[col.campo] = parseNumero(v);
      else pago[col.campo] = v;
    }
    pago.nombre = formatNombreTesoreria(pago.nombre);
    pago.nombreNormalizado = normalizarNombre(pago.nombre);
    if (/^mercado\s*pago$/i.test(pago.entidad)) pago.entidad = 'Mercado Pago';
    const avisos = [];
    if (faltan.length) avisos.push(`no pude leer ${faltan.join(', ')} (ni lo que sigue)`);
    if (pago.loteEl === null) avisos.push('no tiene "En lote nº" después');
    if (avisos.length) pago.aviso = `Pago ${pago.idPago || '?'}: ${avisos.join('; ')}.`;
    return pago;
  });
}
