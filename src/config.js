// =============================================================================
// CONFIGURACIÓN — Resolver PNP
// -----------------------------------------------------------------------------
// Este es el único archivo que hace falta tocar para mantener contactos y
// palabras clave. Después de editarlo, correr `node build.mjs` para regenerar
// dist/resolver-pnp.html.
//
// Fuente: docs/SKILL.md (sección "Contactos (Anexo 2)" e "Identificar el área
// dueña"). NO poner contraseñas acá: el HTML se reparte.
// =============================================================================

export const CONFIG = {
  version: '1.1.0',

  // En TODO mail va este alias en CCO.
  cco: 'soportedeaplicaciones@frba.utn.edu.ar',

  // Link a nuestro ticket en osTicket (se le agrega el ID).
  urlTicket: 'https://atencion.frba.utn.edu.ar/scp/tickets.php?id=',

  // Días hábiles para el seguimiento cuando se deriva a un área.
  diasSeguimiento: 5,

  // ---------------------------------------------------------------------------
  // Áreas dueñas. La clave (EL, POSGRADO, …) es interna; no cambiarla.
  //   nombre:     cómo se nombra el área en los textos.
  //   canal:      'ticket' (portal) o 'mail'.
  //   para / cc:  destinatarios del mail (canal 'mail').
  //   medio:      cómo se describe el canal en la Descripción Resolución del PNP.
  // ---------------------------------------------------------------------------
  areas: {
    EL: {
      nombre: 'E-Learning',
      canal: 'ticket',
      medio: 'ticket en su portal (Jira)',
      portal: 'https://fepp.atlassian.net/servicedesk/customer/portal/1',
      camino: 'No conformidad → Informar un incidente',
      usuario: 'soportedeaplicaciones@frba.utn.edu.ar',
      notaAcceso: 'La contraseña está en la doc interna.',
    },
    POSGRADO: {
      nombre: 'Posgrado',
      canal: 'mail',
      medio: 'mail',
      para: ['pagos@posgrado.frba.utn.edu.ar'],
      alternativo: 'aregaliazummer@frba.utn.edu.ar', // "o directo a"
    },
    TSNB: {
      nombre: 'TUNB / TSNB',
      canal: 'mail',
      medio: 'mail',
      para: ['tsnbutn@yahoo.com.ar', 'tsnb@sceu.frba.utn.edu.ar'],
    },
    SCEU: {
      nombre: 'SCEU',
      canal: 'mail',
      medio: 'mail',
      // En la doc figura como "Demás / Lote SCEU: cc: …". Van los dos en Para.
      para: ['alexanderlopez@frba.utn.edu.ar', 'acecaloni@frba.utn.edu.ar'],
    },
    SEGURIDAD: {
      nombre: 'Curso de seguridad',
      canal: 'mail',
      medio: 'mail',
      para: ['gisela@frba.utn.edu.ar'],
    },
    APM: {
      nombre: 'APM',
      canal: 'mail',
      medio: 'mail',
      para: ['mrodriguezgiavarini@frba.utn.edu.ar'], // Coordinadora
      cc: ['poliveto@frba.utn.edu.ar'],               // Encargado
    },
    SAE: {
      nombre: 'SAE Deportes',
      canal: 'mail',
      medio: 'mail',
      para: ['wviscovich@frba.utn.edu.ar'],
    },
  },

  // ---------------------------------------------------------------------------
  // Detección del área, paso 1: nombre del archivo del lote (lo más confiable).
  // Se evalúan en orden; gana el primero que matchea.
  // ---------------------------------------------------------------------------
  archivos: [
    { area: 'EL', patron: /\.EL\./i },   // FP.<n>.EL.<fecha>…
    { area: 'SCEU', patron: /SCEU/i },   // MP.SCEU.<fecha>…
  ],

  // ---------------------------------------------------------------------------
  // Detección del área, paso 2: palabras clave en Concepto / SubConcepto /
  // Alumno. Sin distinguir mayúsculas ni tildes; cada palabra matchea al
  // comienzo de una palabra del texto ("Maestr" matchea "Maestría").
  // Se evalúan en orden; gana el primero que matchea.
  // ---------------------------------------------------------------------------
  palabrasClave: [
    { area: 'SAE', palabras: ['Equipo de fútbol', 'Deportes'] },
    { area: 'TSNB', palabras: ['TUNB', 'TSNB'] },
    { area: 'POSGRADO', palabras: ['Posgrado', 'Maestr', 'Especializ', 'Doctor'] },
    { area: 'APM', palabras: ['APM'] },
    { area: 'SEGURIDAD', palabras: ['seguridad'] },
  ],

  // ---------------------------------------------------------------------------
  // Mensaje de Tesorería: pagos de Mercado Pago / E-Learning sin número de
  // recibo en SCI. Si Tesorería cambia el formato, se ajusta acá.
  // ---------------------------------------------------------------------------
  tesoreria: {
    // A quién va dirigida la "Respuesta a Tesorería".
    contacto: 'Johanna',

    // "En lote nº 1895": número de lote de E-Learning (NO es el ID de lote del
    // SCI). Aplica a los pagos anteriores, hasta el "En lote" previo.
    marcaLote: /En\s+(?:el\s+)?lote\s*(?:n\s*[º°o]|nro|n[uú]m(?:ero)?|#)?\.?\s*:?\s*(\d+)/giu,

    // Un pago empieza con dos números (ID de pago, ID de orden) y un nombre
    // ("Apellido,Nombre", o seguido de un mail).
    inicioPago: /(?<![\d.,])(\d{6,8})\s+(\d{6,8})\s+(?=\p{L}[^\d@]*?(?:,|\s\S+@))/gu,

    // Saludos de cierre que no son parte del último pago.
    pie: /\s+(?:Por favor|Muchas gracias|Gracias|Saludos|Atentamente)\b.*$/iu,

    // Columnas de cada pago, en orden. Cada patrón se busca al principio de lo
    // que queda del pago (los separadores pueden ser espacios, tabs o saltos).
    //   campo: null → se lee y se descarta. opcional: puede faltar.
    //   tipo: 'fecha' → DD/MM/AAAA; 'monto' → número.
    // OJO: las fechas 7-8 se repiten igual en todos los pagos del mismo curso
    // (y a veces son anteriores a la fecha de pago), así que puede que no sean
    // la acreditación de MP. No se usan para cruzar.
    columnas: [
      { campo: 'idPago', patron: /\d{6,8}/ },
      { campo: 'idOrden', patron: /\d{6,8}/ },
      { campo: 'nombre', patron: /.+?(?=\s+(?:\S+@\S+|\d{4,8}\s))/u },
      { campo: 'email', patron: /[^\s@]+@[^\s@]+\.[^\s@]+/, opcional: true },
      { campo: 'idCurso', patron: /\d{4,8}/ },
      { campo: null, patron: /-/, opcional: true },
      { campo: 'fechaAcreditacion', patron: /\d{4}-\d{1,2}-\d{1,2}/, opcional: true, tipo: 'fecha' },
      { campo: null, patron: /\d{1,2}[-/]\d{1,2}[-/]\d{4}(?=\s+\d{1,2}[-/]\d{1,2}[-/]\d{4})/, opcional: true },
      { campo: 'fechaPago', patron: /\d{1,2}[-/]\d{1,2}[-/]\d{4}/, tipo: 'fecha' },
      { campo: 'entidad', patron: /.+?(?=\s+(?:\d+(?:\s+y\s+\d+)?\s+Cuotas\b|Pesos\b|D[oó]lares\b|USD\b|ARS\b))/iu },
      { campo: 'planMP', patron: /\d+(?:\s+y\s+\d+)?\s+Cuotas/i, opcional: true },
      { campo: 'moneda', patron: /Pesos|D[oó]lares|USD|ARS/iu },
      { campo: 'montoBruto', patron: /\d[\d.,]*/, tipo: 'monto' },
      { campo: 'montoNeto', patron: /\d[\d.,]*/, tipo: 'monto', opcional: true },
      { campo: 'montoFacultad', patron: /\d[\d.,]*/, tipo: 'monto', opcional: true },
      { campo: 'estado', patron: /.+/u, opcional: true },
    ],

    // Diferencia máxima (en pesos) para considerar que dos montos son iguales.
    toleranciaMonto: 1,
  },
};
