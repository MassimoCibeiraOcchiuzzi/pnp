// UI: arma la página, escucha las entradas y muestra las salidas.
// Solo corre en el navegador (en el HTML generado por build.mjs).

import { CONFIG } from './config.js';
import { formatFecha, formatMonto, parseFecha, parseNumero, desglosarCodigoBarras } from './parser.js';
import { analizar, preguntaPara, detectarDuplicados, ETIQUETAS } from './classifier.js';
import { salidasPnp, notaErrorLote, armarQuery, CHECKLIST_COBRO_MANUAL, COLUMNAS_CRUCE } from './templates.js';

// ---------------------------------------------------------------------------
// Helpers de DOM
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HUECO = /\[COMPLETAR: [^\]]*\]|<NÚMERO>|<IDTICKET>|<NRO_RECIBO>|<FIRMA>/g;

function contarHuecos(texto) {
  return (String(texto).match(HUECO) || []).length;
}

function preResaltado(texto) {
  const pre = h('pre', { class: 'salida-texto', tabindex: '0' });
  pre.innerHTML = escaparHtml(texto).replace(/\[COMPLETAR: [^\]]*\]|&lt;(?:NÚMERO|IDTICKET|NRO_RECIBO|FIRMA)&gt;/g, (m) => `<mark>${m}</mark>`);
  return pre;
}

const almacen = {
  get(k) { try { return localStorage.getItem('resolver-pnp:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('resolver-pnp:' + k, v); } catch { /* sin storage: no pasa nada */ } },
};

async function copiar(texto, boton) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      ok = true;
    }
  } catch { ok = false; }
  if (!ok) {
    const ta = h('textarea', { class: 'oculto-copia', 'aria-hidden': 'true' });
    ta.value = texto;
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (boton) {
    const original = boton.dataset.texto || boton.textContent;
    boton.dataset.texto = original;
    boton.textContent = ok ? '¡Copiado!' : 'No se pudo copiar';
    boton.classList.toggle('ok', ok);
    setTimeout(() => { boton.textContent = original; boton.classList.remove('ok'); }, 1500);
  }
}

function botonCopiar(obtenerTexto, etiqueta = 'Copiar') {
  const b = h('button', { type: 'button', class: 'btn btn-copiar' }, etiqueta);
  b.addEventListener('click', () => copiar(typeof obtenerTexto === 'function' ? obtenerTexto() : obtenerTexto, b));
  return b;
}

function badge(texto, clase) {
  return h('span', { class: `badge ${clase}` }, texto);
}

function hoy() {
  return formatFecha(new Date());
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const ui = {
  overrides: { lotes: {}, pnps: {} },
  usuario: { fecha: '', monto: '', texto: '' },
  archivoLote: '',
  estructura: '',
  todo: [], // [{ titulo, texto }] para "Copiar todo"
};

function ctx() {
  const fecha = $('#fecha').value.trim();
  return {
    firma: $('#firma').value,
    fecha: parseFecha(fecha) ? fecha : hoy(),
    ticketNro: $('#ticket-nro').value.trim(),
    ticketId: $('#ticket-id').value.trim(),
    recibo: $('#recibo').value.trim(),
  };
}

function ovPnp(idKey) {
  if (!ui.overrides.pnps[idKey]) ui.overrides.pnps[idKey] = {};
  return ui.overrides.pnps[idKey];
}

function ovLote(key) {
  if (!ui.overrides.lotes[key]) ui.overrides.lotes[key] = {};
  return ui.overrides.lotes[key];
}

let temporizador = null;
function recalcularPronto(ms = 200) {
  clearTimeout(temporizador);
  temporizador = setTimeout(recalcular, ms);
}

// ---------------------------------------------------------------------------
// Recalcular
// ---------------------------------------------------------------------------

const NOMBRES_TIPO = {
  vacio: 'Sin texto',
  notificacion: 'Notificación de lote',
  error_lote: 'Error de lote',
  pnp: 'Lote con PNP',
  usuario: 'Ticket de usuario',
  tesoreria: 'Pedido de Tesorería',
};

function firmaEstructura(m) {
  return [m.tipo, m.lotes.map((L) => L.key).join(','),
    m.pnps.map((p) => `${p.idKey}:${p.tipo}:${p.sub || ''}:${(p.completadoTesoreria || []).join('+')}`).join(','),
    m.errorLote && m.errorLote.lote ? m.errorLote.lote.num : ''].join('|');
}

function recalcular() {
  const texto = $('#texto').value;
  const query = $('#query').value;
  const tesoreria = $('#tesoreria').value;
  const modelo = analizar({ texto, query, tesoreria, overrides: ui.overrides });
  const f = firmaEstructura(modelo);
  if (f !== ui.estructura) {
    ui.estructura = f;
    const auto = analizar({ texto, query, tesoreria, overrides: { lotes: ui.overrides.lotes } });
    renderControles(modelo, auto);
  }
  renderResultados(modelo);
}

// ---------------------------------------------------------------------------
// Controles que dependen del caso (columna izquierda + tarjetas de PNP)
// ---------------------------------------------------------------------------

function campoTexto({ id, etiqueta, valorInicial = '', placeholder = '', alCambiar, tipo = 'text', ayuda }) {
  const input = h('input', { id, type: tipo, value: valorInicial, placeholder, autocomplete: 'off' });
  input.addEventListener('input', () => { alCambiar(input.value); recalcularPronto(); });
  return h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input, ayuda ? h('small', { class: 'ayuda' }, ayuda) : null);
}

function controlesLote(L, autoL) {
  const key = L.lote ? String(L.lote.num) : L.key;
  const ov = ui.overrides.lotes[key] || {};
  const titulo = L.lote ? `Lote ${L.lote.id8}` : 'Lote sin identificar';
  return h('fieldset', { class: 'lote-datos' },
    h('legend', {}, `Datos del ${titulo}`),
    campoTexto({
      id: `lote-${key}-entidad`, etiqueta: 'Entidad Recaudadora', valorInicial: ov.entidad || '',
      placeholder: (autoL && autoL.entidad) || 'Ej.: Mercado Pago', alCambiar: (v) => { ovLote(key).entidad = v; },
    }),
    campoTexto({
      id: `lote-${key}-archivo`, etiqueta: 'Nombre de archivo', valorInicial: ov.archivo || '',
      placeholder: (autoL && autoL.archivo) || 'Ej.: FP.19.EL.20260923.1881_21760.txt', alCambiar: (v) => { ovLote(key).archivo = v; },
      ayuda: 'Se ve en Cobros externos → Lotes. Define el área (.EL. = E-Learning, SCEU = SCEU).',
    }),
  );
}

function renderControles(m, auto) {
  const extra = $('#extra');
  extra.replaceChildren();
  const cont = $('#pnps');
  cont.replaceChildren();

  if (m.tipo === 'pnp' || m.tipo === 'tesoreria') {
    m.lotes.forEach((L, i) => extra.append(controlesLote(L, auto.lotes[i])));
    m.pnps.forEach((p, i) => cont.append(tarjetaPnp(p, auto.pnps[i])));
  } else if (m.tipo === 'error_lote') {
    const el = m.errorLote;
    const L = { key: el.lote ? String(el.lote.num) : 'sin-lote', lote: el.lote };
    extra.append(controlesLote(L, analizar({ texto: $('#texto').value }).errorLote));
    const ta = h('textarea', { id: 'archivo-lote', rows: '6', spellcheck: 'false', placeholder: 'Pegá acá el contenido del archivo del lote…' });
    ta.value = ui.archivoLote;
    ta.addEventListener('input', () => { ui.archivoLote = ta.value; recalcularPronto(); });
    extra.append(h('div', { class: 'campo' },
      h('label', { for: 'archivo-lote' }, 'Contenido del archivo del lote (opcional, para detectar duplicados)'),
      ta,
      h('small', { class: 'ayuda' }, 'Toma los últimos 40 caracteres de cada línea no vacía y lista los repetidos (como awk | sort | uniq -d).'),
    ));
  } else if (m.tipo === 'usuario') {
    const pistas = m.pistas || {};
    const u = ui.usuario;
    extra.append(h('fieldset', { class: 'lote-datos' },
      h('legend', {}, 'Buscar el PNP del usuario'),
      campoTexto({ id: 'u-fecha', etiqueta: 'Fecha de pago (DD/MM/AAAA)', valorInicial: u.fecha || pistas.fecha || '', alCambiar: (v) => { u.fecha = v; } }),
      campoTexto({ id: 'u-monto', etiqueta: 'Monto pagado', valorInicial: u.monto || (pistas.monto !== undefined ? String(pistas.monto) : ''), alCambiar: (v) => { u.monto = v; } }),
      campoTexto({ id: 'u-texto', etiqueta: 'Texto en el error (apellido, código…)', valorInicial: u.texto || '', alCambiar: (v) => { u.texto = v; },
        ayuda: 'Busca en la descripción del error del PNP (ahí aparece el Alumno).' }),
    ));
    if (!u.fecha && pistas.fecha) u.fecha = pistas.fecha;
    if (!u.monto && pistas.monto !== undefined) u.monto = String(pistas.monto);
  }
}

const CAMPOS_EDITABLES = [
  ['fechaPago', 'Fecha de pago (DD/MM/AAAA)'],
  ['montoPagado', 'Monto pagado'],
  ['nombre', 'Nombre inscripto'],
  ['dni', 'Número de documento'],
  ['concepto', 'Concepto Ingreso'],
  ['subconcepto', 'SubConcepto Ingreso'],
  ['planPago', 'Plan Pago'],
];
const CAMPOS_OPCIONALES = [
  ['notas', 'Notas'],
  ['motivoBeca', 'Motivo beca'],
  ['razonSocial', 'Nombre razón social (persona jurídica)'],
  ['cuit', 'CUIT'],
  ['email', 'Mail inscripto'],
];

function tarjetaPnp(p, auto) {
  const ov = ui.overrides.pnps[p.idKey] || {};
  const tarjeta = h('article', { class: 'tarjeta pnp', id: `pnp-${p.idKey}` });
  tarjeta.append(h('div', { class: 'pnp-estado' }));
  tarjeta.append(h('div', { class: 'error-textual' },
    h('span', { class: 'mini' }, 'Error (textual del SCI)'),
    h('code', {}, p.error),
  ));

  const preg = preguntaPara(p);
  if (preg) {
    const nombre = `dec-${p.idKey}`;
    const fs = h('fieldset', { class: 'pregunta' }, h('legend', {}, preg.texto));
    for (const [v, t] of preg.opciones) {
      const id = `${nombre}-${v}`;
      const r = h('input', { type: 'radio', name: nombre, id, value: v, checked: (ov.decision || 'pendiente') === v });
      r.addEventListener('change', () => { ovPnp(p.idKey).decision = v; recalcular(); });
      fs.append(h('div', { class: 'opcion' }, r, h('label', { for: id }, t)));
    }
    tarjeta.append(fs);
  }

  const selId = `area-${p.idKey}`;
  const sel = h('select', { id: selId },
    h('option', { value: '' }, 'Automático'),
    Object.entries(CONFIG.areas).map(([k, a]) => h('option', { value: k }, a.nombre)),
  );
  sel.value = ov.area || '';
  sel.addEventListener('change', () => { ovPnp(p.idKey).area = sel.value; recalcular(); });
  tarjeta.append(h('div', { class: 'campo campo-linea' }, h('label', { for: selId }, 'Área dueña'), sel));
  if (p.tipo !== 'B4' && p.sub !== 'corto' && p.sub !== 'ceros') {
    const recId = `f-${p.idKey}-recibo`;
    const rec = h('input', { id: recId, type: 'text', value: ov.recibo || '', autocomplete: 'off', placeholder: 'si se cobra a mano (si no, usa el de "Tus datos")' });
    rec.addEventListener('input', () => { ovPnp(p.idKey).recibo = rec.value; recalcularPronto(); });
    tarjeta.append(h('div', { class: 'campo campo-linea' }, h('label', { for: recId }, 'Nº de recibo'), rec));
  }

  const grilla = h('div', { class: 'grilla-campos' });
  const agregar = ([k, etiqueta]) => {
    let ph = '';
    if (auto) {
      ph = k === 'montoPagado' ? (auto.campos.montoPagado !== null ? formatMonto(auto.campos.montoPagado) : '') : (auto.campos[k] || '');
    }
    grilla.append(campoTexto({
      id: `f-${p.idKey}-${k}`, etiqueta, valorInicial: ov[k] || '', placeholder: ph || 'vacío',
      alCambiar: (v) => { ovPnp(p.idKey)[k] = v; },
    }));
  };
  CAMPOS_EDITABLES.forEach(agregar);
  const grillaOpc = h('div', { class: 'grilla-campos' });
  CAMPOS_OPCIONALES.forEach(([k, etiqueta]) => {
    const ph = auto && auto.campos[k] ? auto.campos[k] : 'solo si aparece en SCI';
    grillaOpc.append(campoTexto({ id: `f-${p.idKey}-${k}`, etiqueta, valorInicial: ov[k] || '', placeholder: ph, alCambiar: (v) => { ovPnp(p.idKey)[k] = v; } }));
  });
  const abierto = p.faltantes.length > 0 || p.faltaNombreB2;
  tarjeta.append(h('details', { class: 'editar', open: abierto },
    h('summary', {}, 'Completar / corregir datos de este PNP'),
    h('p', { class: 'ayuda' }, 'Lo que escribas acá pisa lo detectado (el gris es lo que se detectó).'),
    grilla,
    h('details', { class: 'opcionales' }, h('summary', {}, 'Opcionales (Notas, Motivo beca, CUIT / razón social, Mail)'), grillaOpc),
  ));
  return tarjeta;
}

// ---------------------------------------------------------------------------
// Estado de cada PNP (se redibuja en cada cambio)
// ---------------------------------------------------------------------------

function badgesCaso(p) {
  const b = [];
  if (p.tipo === 'B2' && p.sub === 'corto') b.push(badge('B2 · cuota eliminada', 'b-irresoluble'));
  else if (p.tipo === 'B2' && p.sub === 'ceros') b.push(badge('B2 · código en ceros', 'b-b2'));
  else b.push(badge(`${p.tipo} · ${{ B1: 'monto no coincide', B2: 'no existe la cuota', B3: 'cuota ya impactada', B4: 'sin procedimiento' }[p.tipo]}`, `b-${p.tipo.toLowerCase()}`));
  const a = p.accion;
  if (a.tipo === 'cobro_manual') b.push(badge('Cobro manual', 'b-cobro'));
  else if (a.tipo === 'irresoluble') b.push(badge('Irresoluble', 'b-irresoluble'));
  else if (a.tipo === 'registro') b.push(badge('Cerrar y dejar registro', 'b-b4'));
  else if (a.tipo === 'soporte') b.push(badge('Derivar a Soporte de Aplicaciones', 'b-b4'));
  else b.push(badge(a.borrador ? 'Derivar (borrador)' : 'Derivar', a.borrador ? 'b-borrador' : 'b-derivar'));
  if (p.area.key) b.push(badge(`Área: ${CONFIG.areas[p.area.key].nombre}`, 'b-area'));
  else if (a.tipo === 'derivar') b.push(badge('Área indeterminada', 'b-alerta'));
  return b;
}

function estadoPnp(p) {
  const d = p.datos;
  const datos = [];
  if (d.montoPagado !== undefined && d.montoPagado !== null) datos.push(['Monto pagado (error)', formatMonto(d.montoPagado)]);
  if (d.montoCuota !== undefined && d.montoCuota !== null) datos.push(['Monto cuota', formatMonto(d.montoCuota)]);
  if (d.montoProntoPago !== undefined && d.montoProntoPago !== null) datos.push(['Pronto pago', formatMonto(d.montoProntoPago)]);
  if (d.cuotaId) datos.push(['ID de cuota (no es cód. de barras)', d.cuotaId]);
  if (d.recibo) datos.push(['Recibo', `${d.recibo}${d.reciboId ? ` (Id ${d.reciboId})` : ''}`]);
  if (d.alumno) datos.push(['Alumno', d.alumno]);
  if (d.subconcepto) datos.push(['Sub Concepto Ingreso', d.subconcepto]);
  if (p.area.key) datos.push(['Área detectada por', p.area.fuente === 'manual' ? 'elección manual' : p.area.detalle]);
  const cod = p.tipo === 'B2' && p.sub === 'largo' ? desglosarCodigoBarras(p.campos.codigoBarras || p.codigo) : null;
  if (cod) datos.push(['Dentro del código (informativo)', `ID ${cod.id}${cod.fechas.length ? ` · fechas ${cod.fechas.join(' y ')}` : ''}`]);
  const r = p.tesoreria;
  if (r && r.estado === 'cruzado' && r.confianza === 'alta') {
    datos.push(['Pago de Tesorería', `${textoPagos(r.pagos)} · confianza alta${r.manual ? ' (elegido a mano)' : ''}`]);
    datos.push(['Por qué', r.razones.join('; ')]);
    if (p.completadoTesoreria.length) {
      datos.push(['Completado con Tesorería', p.completadoTesoreria.map((k) => ETIQUETAS[k] || (k === 'email' ? 'Mail inscripto' : k)).join(', ')]);
    }
  }

  const avisos = [];
  if (p.mojibake) avisos.push(['alerta', 'Nombre con caracteres rotos: avisar a Soporte de Aplicaciones para que lo corrijan ANTES de cobrar.']);
  if (p.tipo === 'B3') avisos.push(['info', `El ${d.cuotaId || 'número'} es ID de cuota, no código de barras: buscar por Cobros → nombre del alumno → inscripción con ese SubConcepto.`]);
  if (p.tipo === 'B4') avisos.push(['info', 'No hay procedimiento documentado para este error. Pedí el texto completo o una captura y derivalo a Soporte de Aplicaciones. No inventar.']);
  if (p.areaIndeterminada) avisos.push(['alerta', 'No pude determinar el área. Cargá el Nombre de archivo del lote o elegí el área a mano.']);
  if (p.faltantes.length) avisos.push(['alerta', `Faltan: ${p.faltantes.map((k) => ETIQUETAS[k]).join(', ')}.`]);
  if (p.nombreDeTesoreria) avisos.push(['info', 'Nombre tomado del mensaje de Tesorería.']);
  if (p.avisoSuma) avisos.push(['info', p.avisoSuma]);
  if (p.faltaNombreB2) avisos.push(['info', 'La cuota no existe en SCI: el nombre hay que sacarlo de SysGestión, Mercado Pago o el comprobante. Si no se consigue, la línea se omite.']);
  if (p.faltaRecibo) avisos.push(['alerta', 'Falta el Nº de recibo del cobro manual.']);
  if (p.accion.borrador) avisos.push(['info', 'Todavía no contestaste la pregunta de SCI: los textos se generan como borrador asumiendo derivación.']);

  return [
    h('header', { class: 'pnp-cabecera' },
      h('h3', {}, `PNP ${p.id}`),
      h('span', { class: 'mini' }, `Código: ${p.codigo || '—'}`),
    ),
    h('div', { class: 'badges' }, badgesCaso(p)),
    datos.length ? h('dl', { class: 'datos' }, datos.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
    avisos.map(([nivel, t]) => h('p', { class: `aviso aviso-${nivel}` }, t)),
    bloqueTesoreria(p),
  ];
}

/** "Herrera, Nicolas — pagos 1232541 + 1232542 · $92.433 + $92.433 · 29/09/2026 · lote EL 1893" */
function textoPagos(pagos) {
  const fechas = [...new Set(pagos.map((x) => x.fechaPago).filter(Boolean))].join(' y ');
  const lote = pagos[0].loteEl !== null ? `lote EL ${pagos[0].loteEl}` : '';
  return [
    `${pagos[0].nombre} — ${pagos.length === 1 ? 'pago' : 'pagos'} ${pagos.map((x) => x.idPago).join(' + ')}`,
    pagos.map((x) => (x.montoBruto === null ? '?' : `$${formatMonto(x.montoBruto)}`)).join(' + '),
    fechas, lote,
  ].filter(Boolean).join(' · ');
}

function elegirPagos(p, ids) {
  const ov = ovPnp(p.idKey);
  if (ids && ids.length) ov.pagosTesoreria = ids;
  else delete ov.pagosTesoreria;
  ui.estructura = '';
  recalcular();
}

/** Posible pago de Tesorería (confianza media/baja), empate, o deshacer una elección manual. */
function bloqueTesoreria(p) {
  const r = p.tesoreria;
  if (!r) return null;
  if (r.estado === 'cruzado' && r.manual) {
    return h('p', { class: 'aviso aviso-info tesoreria-pnp' }, 'Pago de Tesorería elegido a mano. ',
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => elegirPagos(p, null) }, 'Deshacer'));
  }
  if (r.estado === 'cruzado' && r.confianza !== 'alta') {
    return h('div', { class: 'aviso aviso-alerta tesoreria-pnp' },
      h('p', {}, h('strong', {}, 'Posible pago de Tesorería: '), textoPagos(r.pagos), ` · confianza ${r.confianza} (${r.razones.join('; ')}).`),
      h('p', {}, 'No se completó solo porque la confianza no es alta. ',
        h('button', { type: 'button', class: 'btn btn-chico', onclick: () => elegirPagos(p, r.pagos.map((x) => x.idPago)) }, 'Usar estos datos')));
  }
  if (r.estado === 'ambiguo') {
    return h('div', { class: 'aviso aviso-alerta tesoreria-pnp' },
      h('p', {}, h('strong', {}, 'Ambiguo: '), 'hay varios pagos de Tesorería con los mismos datos. No se eligió ninguno.'),
      h('ul', {}, r.candidatos.map((c) => h('li', {},
        `${textoPagos(c.pagos)} (${c.razones.join('; ')}) `,
        h('button', { type: 'button', class: 'btn btn-chico', onclick: () => elegirPagos(p, c.pagos.map((x) => x.idPago)) }, 'Usar este pago')))));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tarjetas de salida
// ---------------------------------------------------------------------------

function tarjetaSalida({ titulo, texto, nota, borrador = false, chips = [], clase = '', sinCopiar = false }) {
  const huecos = contarHuecos(texto);
  ui.todo.push({ titulo, texto });
  return h('article', { class: `tarjeta salida ${clase}` },
    h('header', { class: 'salida-cabecera' },
      h('h3', {}, titulo),
      h('div', { class: 'badges' },
        borrador ? badge('Borrador', 'b-borrador') : null,
        chips,
        huecos ? badge(`${huecos} hueco${huecos === 1 ? '' : 's'} para completar`, 'b-alerta') : null,
      ),
      sinCopiar ? null : botonCopiar(texto),
    ),
    nota ? (nota instanceof Node ? nota : h('p', { class: 'ayuda' }, nota)) : null,
    preResaltado(texto),
  );
}

function tarjetaInfo(titulo, ...contenido) {
  return h('article', { class: 'tarjeta salida info' }, h('h3', {}, titulo), contenido);
}

function tarjetaCruce(m, t) {
  // En pantalla, Razones (la columna ancha) va al final para que Estado se vea sin scroll; el TSV respeta COLUMNAS_CRUCE.
  const orden = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 9];
  const tabla = h('table', { class: 'cruce' },
    h('thead', {}, h('tr', {}, orden.map((j) => h('th', { scope: 'col' }, COLUMNAS_CRUCE[j])))),
    h('tbody', {}, t.tabla.map((fila, i) => h('tr', { class: `fila-${m.tesoreria.filas[i].estado}` },
      orden.map((j) => h('td', { class: j === 9 ? 'razones' : null }, fila[j]))))),
  );
  ui.todo.push({ titulo: 'Cruce con Tesorería (TSV)', texto: t.tsv });

  const sugerencias = m.tesoreria.sugerencias.map((sg) => h('p', { class: 'aviso aviso-info' },
    `Este lote SCI ${sg.lote ? sg.lote.id8 : '?'} parece ser el lote EL ${sg.loteEl} (el PNP ${sg.pnpId} cruzó con confianza alta por nombre). Es una sugerencia, no un dato confirmado. `,
    h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { ovLote(sg.loteKey).loteEl = String(sg.loteEl); recalcular(); } },
      `Aceptar: comparar el lote contra el lote EL ${sg.loteEl}`)));
  const aceptadas = m.lotes.filter((L) => L.fuente.loteEl === 'sugerencia').map((L) => h('p', { class: 'aviso aviso-info' },
    `Lote SCI ${L.lote ? L.lote.id8 : '?'} = lote EL ${L.loteEl} (sugerencia aceptada, no confirmada con el archivo). `,
    h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { delete ovLote(L.key).loteEl; recalcular(); } }, 'Deshacer')));

  return h('article', { class: 'tarjeta salida cruce-tesoreria' },
    h('header', { class: 'salida-cabecera' },
      h('h3', {}, 'Cruce con Tesorería'),
      h('div', { class: 'badges' }, badge(`${t.tabla.length} pago${t.tabla.length === 1 ? '' : 's'}`, 'b-neutro')),
      botonCopiar(t.tsv, 'Copiar como tabla'),
    ),
    h('p', { class: 'ayuda' }, 'El "lote nº" de Tesorería es el lote de E-Learning (el número del nombre de archivo FP.<n>.EL.<fecha>.<loteEL>_<loteSCI>.txt), no el ID de lote del SCI. "Copiar como tabla" sirve para pegar en una planilla.'),
    sugerencias, aceptadas,
    h('div', { class: 'tabla-scroll', tabindex: '0', role: 'region', 'aria-label': 'Tabla de cruce con Tesorería' }, tabla),
  );
}

function renderSalidasPnp(m, c, cont) {
  const s = salidasPnp(m, c);
  if (s.tesoreria) cont.append(tarjetaCruce(m, s.tesoreria));
  cont.append(tarjetaSalida({ titulo: '1. Diagnóstico', texto: s.diagnostico, clase: 'diagnostico' }));
  if (s.tesoreria && s.tesoreria.query) {
    cont.append(tarjetaSalida({
      titulo: 'Query para encontrar los PNP de los pagos de Tesorería (DB SysAdmin)', texto: s.tesoreria.query,
      nota: 'Filtra por los lotes EL del mensaje y por los montos (cada pago y la suma por orden). Pegá la grilla en "Resultado de la query" como siempre.',
    }));
  }

  if (s.faltantes) {
    cont.append(tarjetaSalida({ titulo: 'Datos faltantes', texto: s.faltantes, clase: 'faltantes' }));
    cont.append(tarjetaSalida({
      titulo: 'Query para traer los datos (DB SysAdmin)', texto: s.query,
      nota: 'Correla en SSMS, copiá la grilla con encabezados (clic derecho → Copy with Headers) y pegala en "Resultado de la query".',
    }));
  }

  for (const t of s.ticketsEL) {
    const lote = t.lote.lote ? t.lote.lote.id8 : '';
    const el = CONFIG.areas.EL;
    const nota = h('div', { class: 'ayuda' },
      h('p', {}, `Portal: ${el.portal} → ${el.camino}. Usuario: ${el.usuario}. ${el.notaAcceso}`),
      h('p', {}, 'Mandá los datos en texto: E-Learning usa SIGEAD, no SCI, así que las capturas de SCI no les sirven. Un ticket por lote.'),
    );
    const art = h('article', { class: 'tarjeta salida' },
      h('header', { class: 'salida-cabecera' },
        h('h3', {}, `2. Ticket a E-Learning${lote ? ` — Lote ${lote}` : ''}`),
        h('div', { class: 'badges' }, t.borrador ? badge('Borrador', 'b-borrador') : null,
          contarHuecos(t.resumen + t.descripcion) ? badge(`${contarHuecos(t.resumen + t.descripcion)} huecos para completar`, 'b-alerta') : null),
      ),
      nota,
      h('div', { class: 'sub-salida' }, h('div', { class: 'sub-cabecera' }, h('strong', {}, 'Resumen'), botonCopiar(t.resumen)), preResaltado(t.resumen)),
      h('div', { class: 'sub-salida' }, h('div', { class: 'sub-cabecera' }, h('strong', {}, 'Descripción'), botonCopiar(t.descripcion)), preResaltado(t.descripcion)),
    );
    ui.todo.push({ titulo: `Ticket a E-Learning — Resumen${lote ? ` (Lote ${lote})` : ''}`, texto: t.resumen });
    ui.todo.push({ titulo: `Ticket a E-Learning — Descripción${lote ? ` (Lote ${lote})` : ''}`, texto: t.descripcion });
    cont.append(art);
  }

  for (const mail of s.mails) {
    const area = mail.area ? CONFIG.areas[mail.area] : null;
    const lote = mail.lote.lote ? ` — Lote ${mail.lote.lote.id8}` : '';
    const notas = ['Se pueden adjuntar capturas (inscripción + plan de cuotas) cuando el área usa SCI.'];
    if (area && area.alternativo) notas.unshift(`También se puede mandar directo a ${area.alternativo}.`);
    if (!area) notas.unshift('Elegí el área dueña en la tarjeta del PNP para completar el destinatario.');
    cont.append(tarjetaSalida({
      titulo: `3. Mail al coordinador${area ? ` (${area.nombre})` : ''}${lote}`, texto: mail.texto, borrador: mail.borrador, nota: notas.join(' '),
    }));
  }

  if (s.resoluciones.length) {
    const art = h('article', { class: 'tarjeta salida' }, h('h3', {}, '4. Descripción Resolución del PNP (campo en SCI)'));
    for (const r of s.resoluciones) {
      ui.todo.push({ titulo: `Descripción Resolución — PNP ${r.pnp.id} (¿Pendiente? = ${r.pendiente})`, texto: r.texto });
      art.append(h('div', { class: 'sub-salida' },
        h('div', { class: 'sub-cabecera' },
          h('strong', {}, `PNP ${r.pnp.id}`),
          badge(`¿Pendiente? = ${r.pendiente}`, r.pendiente === 'Sí' ? 'b-pendiente-si' : 'b-cobro'),
          r.borrador ? badge('Borrador', 'b-borrador') : null,
          botonCopiar(r.texto),
        ),
        preResaltado(r.texto),
      ));
    }
    if (s.resoluciones.some((r) => /<NÚMERO>|<IDTICKET>/.test(r.texto))) {
      art.append(h('p', { class: 'aviso aviso-alerta' }, 'Falta el Nº y/o ID de nuestro ticket (columna izquierda → "Tus datos").'));
    }
    cont.append(art);
  }

  if (s.nota) cont.append(tarjetaSalida({ titulo: '5. Nota interna del ticket', texto: s.nota, borrador: m.pnps.some((p) => p.accion.borrador) }));
  if (s.recordatorio) cont.append(tarjetaSalida({ titulo: '6. Recordatorio de seguimiento', texto: s.recordatorio, clase: 'recordatorio' }));
  if (s.tesoreria && s.tesoreria.respuesta) {
    cont.append(tarjetaSalida({
      titulo: `7. Respuesta a Tesorería (${CONFIG.tesoreria.contacto})`, texto: s.tesoreria.respuesta.texto, borrador: s.tesoreria.respuesta.borrador,
      nota: s.tesoreria.respuesta.borrador ? 'Borrador: hay PNP sin revisar en SCI, cruces a confirmar o pagos sin cruzar.' : null,
    }));
  }
  if (s.hayCobroManual) {
    cont.append(tarjetaInfo('Checklist: Cobro manual', h('ol', {}, CHECKLIST_COBRO_MANUAL.map((t) => h('li', {}, t)))));
  }
}

function renderNotificacion(m, cont) {
  const info = m.infoTexto;
  const lote = m.loteTexto ? m.loteTexto.id8 : '—';
  const texto = 'Cerrar sin encuesta.';
  ui.todo.push({ titulo: 'Diagnóstico', texto: `Notificación de lote ${lote} a procesar: nada que resolver. ${texto}` });
  cont.append(tarjetaInfo('1. Diagnóstico',
    h('p', { class: 'grande' }, `Notificación de lote ${lote} a procesar: nada que resolver. `, h('strong', {}, texto)),
    h('p', {}, 'Circuito: E-Learning carga el archivo como Lote a Procesar en estado Pendiente [P] → Tesorería lo pasa a Confirmado [C] (o Rechazado [R]) → SCI procesa los lotes confirmados los días hábiles por la mañana → Procesado [X] o Error [E].'),
    h('dl', { class: 'datos' },
      [['Lote', lote], ['Entidad', info.entidad || '—'], ['Archivo', info.archivo || '—'], ['Estado', info.estado || '—']]
        .map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  ));
}

function renderErrorLote(m, c, cont) {
  const el = m.errorLote;
  const lote = el.lote ? el.lote.id8 : '—';
  cont.append(tarjetaInfo(`1. Diagnóstico — ${el.caso.titulo}`,
    h('p', { class: 'grande' }, `Error en el Lote ${lote}: no entró ningún pago del lote.`),
    h('p', {}, h('strong', {}, 'Causa: '), el.caso.causa),
    h('p', { class: 'aviso aviso-alerta' }, 'Estos tickets los maneja exclusivamente Soporte de Aplicaciones: mover el ticket a la cola "Soporte De Aplicaciones > SCI" y avisar al área.'),
    h('p', { class: 'aviso aviso-info' }, 'Si el archivo no lo cargó SCI automáticamente (ej. lo carga E-Learning), primero notificar al área con el error y la causa detectada. Se puede ofrecer corregirlo nosotros, pero hay que esperar su autorización antes de modificar/resubir.'),
    h('h4', {}, 'Pasos'),
    h('ol', {}, el.caso.pasos.map((t) => h('li', {}, t))),
    h('p', { class: 'mini' }, `Error textual: ${el.error}`),
  ));

  let duplicados = [];
  if (ui.archivoLote.trim()) {
    duplicados = detectarDuplicados(ui.archivoLote);
    cont.append(tarjetaSalida({
      titulo: `Códigos de barras duplicados (${duplicados.length})`,
      texto: duplicados.length ? duplicados.join('\n') : 'No hay códigos repetidos en los últimos 40 caracteres de cada línea.',
    }));
  } else if (el.caso.id === 'duplicados') {
    cont.append(tarjetaInfo('Detector de duplicados', h('p', { class: 'ayuda' }, 'Pegá el contenido del archivo del lote en la columna izquierda para listar los códigos repetidos. Mientras tanto, la nota usa el código que menciona el error.')));
  }
  cont.append(tarjetaSalida({ titulo: '2. Nota del ticket de error de lote', texto: notaErrorLote(el, c, duplicados) }));
  cont.append(tarjetaSalida({
    titulo: 'Para el ticket de PNPs que se genere después', texto: `Ticket con error de lote asociado: ${c.ticketId ? CONFIG.urlTicket + c.ticketId : '[COMPLETAR: link]'}`,
  }));
}

function renderUsuario(m, cont) {
  const u = ui.usuario;
  const monto = parseNumero(u.monto);
  cont.append(tarjetaInfo('1. Diagnóstico',
    h('p', { class: 'grande' }, 'Ticket de una persona (no es un mail automático del SCI).'),
    h('ol', {},
      h('li', {}, 'Buscar el PNP con los datos del inscripto: nombre, DNI, fecha de pago o monto (query de abajo, o en SCI: Cobros externos → Pagos no Procesables).'),
      h('li', {}, 'Si aparece, pegá el resultado de la query en "Resultado de la query" y resolvelo como PNP.'),
      h('li', {}, 'Si no hay PNP con esos datos, pasar la solicitud a Soporte de Aplicaciones.'),
    ),
    m.pistas && Object.keys(m.pistas).length
      ? h('p', { class: 'mini' }, `Detecté en el texto: ${[m.pistas.dni && `DNI ${m.pistas.dni}`, m.pistas.fecha && `fecha ${m.pistas.fecha}`, m.pistas.monto !== undefined && `monto ${formatMonto(m.pistas.monto)}`].filter(Boolean).join(' · ')}`)
      : null,
  ));
  const q = armarQuery({ fecha: u.fecha, monto: monto === null ? '' : monto, texto: u.texto.trim() });
  cont.append(tarjetaSalida({ titulo: 'Query de PNPs filtrando por fecha / monto', texto: q, nota: 'Completá fecha y/o monto en la columna izquierda para armar el WHERE.' }));
}

function renderResultados(m) {
  const c = ctx();
  ui.todo = [];

  // Tipo
  const tipo = $('#tipo');
  tipo.replaceChildren();
  if (m.tipo !== 'vacio') {
    const partes = [badge(NOMBRES_TIPO[m.tipo], m.tipo === 'error_lote' ? 'b-error-lote' : 'b-tipo')];
    if (m.tipo === 'pnp' || m.tipo === 'tesoreria') {
      m.lotes.forEach((L) => partes.push(badge(L.lote ? `Lote ${L.lote.id8}` : 'Lote ?', 'b-neutro')));
      if (m.pnps.length || m.tipo === 'pnp') partes.push(badge(`${m.pnps.length} PNP${m.pnps.length === 1 ? '' : 's'}`, 'b-neutro'));
      if (m.tesoreria) partes.push(badge(`${m.tesoreria.pagos.length} pago${m.tesoreria.pagos.length === 1 ? '' : 's'} de Tesorería`, 'b-neutro'));
    } else if (m.loteTexto) {
      partes.push(badge(`Lote ${m.loteTexto.id8}`, 'b-neutro'));
    }
    tipo.append(...partes);
  }

  // Avisos generales
  const av = $('#avisos');
  av.replaceChildren();
  const fechaTxt = $('#fecha').value.trim();
  if (fechaTxt && !parseFecha(fechaTxt)) av.append(h('p', { class: 'aviso aviso-alerta' }, `La fecha "${fechaTxt}" no es válida (DD/MM/AAAA). Uso la de hoy.`));
  m.avisos.filter((a) => !a.pnp).forEach((a) => av.append(h('p', { class: `aviso aviso-${a.nivel}` }, a.texto)));
  const alertasPnp = m.avisos.filter((a) => a.pnp && a.nivel === 'alerta').length;
  if (alertasPnp) av.append(h('p', { class: 'aviso aviso-alerta' }, `Hay ${alertasPnp} advertencia${alertasPnp === 1 ? '' : 's'} en las tarjetas de PNP.`));

  // Estado de cada PNP
  for (const p of m.pnps) {
    const t = document.getElementById(`pnp-${p.idKey}`);
    if (t) t.querySelector('.pnp-estado').replaceChildren(...estadoPnp(p).flat().filter(Boolean));
  }
  $('#pnps-titulo').hidden = m.pnps.length === 0;

  // Salidas
  const cont = $('#salidas');
  cont.replaceChildren();
  if (m.tipo === 'vacio') {
    cont.append(h('div', { class: 'vacio' },
      h('p', {}, 'Pegá el texto del ticket o mail del SCI a la izquierda (o el mensaje de Tesorería en el cuadro 4, o cargá un ejemplo) y acá aparecen el diagnóstico y los textos listos para copiar.'),
    ));
  } else if (m.tipo === 'notificacion') renderNotificacion(m, cont);
  else if (m.tipo === 'error_lote') renderErrorLote(m, c, cont);
  else if (m.tipo === 'usuario') renderUsuario(m, cont);
  else renderSalidasPnp(m, c, cont);

  $('#copiar-todo').disabled = ui.todo.length === 0;
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const b = $('#tema');
  b.setAttribute('aria-pressed', tema === 'dark' ? 'true' : 'false');
  b.textContent = tema === 'dark' ? '☀ Modo claro' : '☾ Modo oscuro';
}

function cargarEjemplo(id) {
  const ej = (typeof EJEMPLOS !== 'undefined' ? EJEMPLOS : []).find((e) => e.id === id);
  if (!ej) return;
  limpiar(false);
  $('#texto').value = ej.texto || '';
  $('#query').value = ej.query || '';
  $('#tesoreria').value = ej.tesoreria || '';
  ui.archivoLote = ej.archivoLote || '';
  ui.overrides = JSON.parse(JSON.stringify(ej.overrides || { lotes: {}, pnps: {} }));
  ui.overrides.lotes = ui.overrides.lotes || {};
  ui.overrides.pnps = ui.overrides.pnps || {};
  ui.estructura = '';
  recalcular();
}

function limpiar(recalc = true) {
  $('#texto').value = '';
  $('#query').value = '';
  $('#tesoreria').value = '';
  $('#ticket-nro').value = '';
  $('#ticket-id').value = '';
  $('#recibo').value = '';
  $('#fecha').value = hoy();
  ui.overrides = { lotes: {}, pnps: {} };
  ui.usuario = { fecha: '', monto: '', texto: '' };
  ui.archivoLote = '';
  ui.estructura = '';
  if (recalc) { $('#ejemplo').value = ''; recalcular(); }
}

function iniciar() {
  const ejemplos = typeof EJEMPLOS !== 'undefined' ? EJEMPLOS : [];
  const sel = $('#ejemplo');
  ejemplos.forEach((e) => sel.append(h('option', { value: e.id }, e.titulo)));
  sel.addEventListener('change', () => { if (sel.value) cargarEjemplo(sel.value); });

  $('#fecha').value = hoy();
  const firma = almacen.get('firma');
  if (firma) $('#firma').value = firma;
  $('#firma').addEventListener('input', () => { almacen.set('firma', $('#firma').value); recalcularPronto(); });
  for (const id of ['#fecha', '#ticket-nro', '#ticket-id', '#recibo']) $(id).addEventListener('input', () => recalcularPronto());
  $('#texto').addEventListener('input', () => recalcularPronto(300));
  $('#query').addEventListener('input', () => recalcularPronto(300));
  // El mensaje de Tesorería tiene datos de alumnos: no se guarda en localStorage.
  $('#tesoreria').addEventListener('input', () => recalcularPronto(300));
  $('#limpiar').addEventListener('click', () => limpiar());
  $('#copiar-todo').addEventListener('click', (ev) => {
    copiar(ui.todo.map((t) => `===== ${t.titulo} =====\n${t.texto}`).join('\n\n'), ev.currentTarget);
  });

  const guardado = almacen.get('tema');
  const sistema = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  aplicarTema(guardado === 'dark' || guardado === 'light' ? guardado : sistema);
  $('#tema').addEventListener('click', () => {
    const nuevo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    aplicarTema(nuevo);
    almacen.set('tema', nuevo);
  });

  const ayuda = $('#ayuda');
  document.querySelectorAll('.abrir-ayuda').forEach((b) => b.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (typeof ayuda.showModal === 'function') ayuda.showModal(); else ayuda.setAttribute('open', '');
  }));
  $('#cerrar-ayuda').addEventListener('click', () => { if (typeof ayuda.close === 'function') ayuda.close(); else ayuda.removeAttribute('open'); });

  const info = typeof BUILD !== 'undefined' ? BUILD : { version: CONFIG.version, fecha: '' };
  $('#version').textContent = `v${info.version}${info.fecha ? ` · build ${info.fecha}` : ''}`;

  recalcular();
}

document.addEventListener('DOMContentLoaded', iniciar);
