---
name: "resolver-pnp"
description: "Clasifica y resuelve Pagos No Procesables (PNP) y errores de lotes del SCI de UTN.BA; genera el ticket para E-Learning, mails a coordinadores, la resolución del PNP y la nota interna."
---

# Resolver PNP (Pagos No Procesables) del SCI

Contexto: todos los días hábiles entran al SCI los pagos de las entidades recaudadoras (Mercado Pago, Rapipago, Pago Fácil, VISA Home, Banelco…) agrupados en **lotes**. Los pagos que no se pueden asociar a una cuota quedan como **PNP**. SCI manda un mail/ticket automático y Soporte de Aplicaciones lo resuelve: lo cobra a mano, lo deriva al área dueña de la inscripción, o lo deja pendiente/irresoluble.

En SCI: *Cobros externos → Lotes → Ver pagos no procesables* (o *Cobros externos → Pagos no Procesables*).

## Flujo

```
- [ ] 1. Identificar el tipo de ticket (tabla A)
- [ ] 2. Por cada PNP: clasificar el error (tabla B) e identificar el área dueña (origen)
- [ ] 3. Verificar que estén todos los datos necesarios; si faltan, pedirlos (sección "Datos faltantes")
- [ ] 4. Generar las salidas del caso (plantillas) o explicar los pasos de resolución
```

Responder en español rioplatense, tono de trabajo. Primero un diagnóstico corto (1-3 líneas: qué caso es cada PNP y qué hay que hacer), después los textos listos para copiar, cada uno en su propio bloque de código para que se copie fácil.

## A. Tipo de ticket

| Asunto / texto | Caso | Qué hacer |
|---|---|---|
| "Se ha generado un nuevo Lote Nro: XXXX" + "el Centro de e-Learning cargó…" + Estado PENDIENTE | Notificación de lote a procesar | Nada que resolver: **cerrar sin encuesta**. (Tesorería pasa el lote a Confirmado; SCI lo procesa a la mañana siguiente → Procesado o Error.) |
| "Se produjo un error al generar el Lote XXXX con el siguiente error …" | Error de lote (no entra ningún pago) | Ver sección **Errores de lote**. |
| "Se ha generado un nuevo Lote XXXX / Se procesaron N Recibos correctamente / Pagos no procesables" + tabla Nº / Código de Barras / Error | **PNP** | Clasificar cada fila con la tabla B. |
| Mail/ticket de una persona con un comprobante ("les dejo el comprobante de X DNI Y…") | Ticket de usuario | Buscar el PNP por nombre/DNI/fecha de pago/monto (query de PNPs filtrando por fecha o monto). Si aparece, resolverlo como PNP. Si no hay PNP con esos datos, pasar a Soporte de Aplicaciones. |

En el texto del PNP: el número después de "Lote" es el **ID de lote** (`SciLotePagoNoProcesable.LoteId`) y la columna **Nº** es el **ID de PNP**.

## B. Clasificación de cada PNP

Leer la columna *Error* de cada fila:

### B1. "El monto pagado (X) no coincide con el monto de la Cuota (Y) ni el monto de pronto pago (Z) Alumno: … Sub Concepto Ingreso: …"

Causas típicas: le cobraron otro mes, pagó con interés/descuento fuera de fecha, o el arancel cambió.

1. Si el nombre del alumno aparece con caracteres rotos (ej. `MuÃ±oz`) → avisar a Soporte de Aplicaciones para que corrijan el nombre (si no, el sistema rompe al cobrar).
2. Revisar la inscripción en SCI (buscar por código de barras o por *Cobros* → nombre → inscripción con ese SubConcepto). Si el monto pagado **coincide con alguna otra cuota** del plan → se puede **cobrar manualmente** (Anexo: Cobro manual).
3. Si no coincide con ninguna cuota → **no se puede impactar**. Derivar al área dueña:
   - Archivo `*.EL.*` / curso de E-Learning → **ticket a E-Learning** (plantilla 1). Motivo: "el valor abonado no coincide con el valor de la cuota".
   - Otra área → **mail al coordinador** (plantilla 2).
   - Luego: PNP en Pendiente = **Sí** + Descripción Resolución (plantilla 3).

### B2. "No existe una Cuota para el Código X"

- **X es corto (ID de cuota, ~6-7 dígitos, ej. `518985`)** → la cuota fue eliminada antes de que llegue el pago ("caso triste"). Es **irresoluble**: no se puede saber a qué inscripción/curso corresponde. Plantilla 3c.
- **X es un código de barras completo (40 dígitos, empieza con `0937022…`)**:
  - Buscarlo en SCI por *Cod. Barras*. Si aparece la cuota → cobrar manualmente.
  - Si es de E-Learning (archivo `*.EL.*`) y la cuota no existe en SCI → **ticket a E-Learning** informando que "el pago apunta a un número de cuota inexistente" (plantilla 1).
  - Si es de otra área → mail al coordinador (plantilla 2).
- Código `0000000…` (sin cuota) → causa desconocida: cerrar el ticket y dejar registro hasta que aparezca el reclamo.

### B3. "La Cuota (N) ya se encuentra asociada al Recibo XXXX/AAAA (Id = …) Alumno: … Sub Concepto Ingreso: …"

La cuota ya estaba paga (pagó dos veces, o pagó con un cupón/cuponera vieja, o le cobraron un mes ya pago). Aquí N es el **ID de cuota**, no el código de barras → buscar por *Cobros* → nombre del alumno → inscripción con ese SubConcepto (Anexo: Cobro manual, variante por nombre).

- Hay una cuota impaga siguiente **con el mismo monto** y sin anteriores impagas → **cobrar manualmente** esa cuota.
- Hay cuotas anteriores sin pagar que impiden cobrar ("No se puede cobrar una cuota si no está paga la anterior") → avisar al coordinador (plantilla 2, motivo: cuotas anteriores sin impactar).
- **No quedan cuotas disponibles** (todo pago) → avisar al coordinador para reembolso o para ver si está en otro curso (plantilla 2, motivo: no hay cuotas disponibles).
- El monto no coincide con ninguna cuota → igual que B1.
- Equipos de fútbol / Deportes ("Equipo de fútbol - …") → el área es **SAE Deportes**.

### B4. Cualquier otro error

Explicar qué se sabe, pedir el texto completo/captura y sugerir derivar a Soporte de Aplicaciones. No inventar procedimientos.

## Identificar el área dueña (origen)

En orden de confiabilidad:
1. **Nombre del archivo del lote**: `FP.<n>.EL.<fecha>…` → **E-Learning (EL)**; `MP.SCEU.<fecha>…` → **SCEU**.
2. Concepto/SubConcepto/Grupo de la inscripción en SCI (ej. `TUNB`, `TSNB`, Posgrado, "Equipo de fútbol").
3. Buscar el nombre del curso en Google y ver a qué área pertenece.

Si con el texto pegado no se puede saber el origen, **pedir el Nombre de Archivo del lote** (se ve en *Cobros externos → Lotes*) o la salida de la query de datos.

## Contactos (Anexo 2)

En **todo** mail poner en **CCO: soportedeaplicaciones@frba.utn.edu.ar**.

| Área | Contacto |
|---|---|
| E-Learning (EL) | Ticket en https://fepp.atlassian.net/servicedesk/customer/portal/1 → *No conformidad* → *Informar un incidente* (usuario soportedeaplicaciones@frba.utn.edu.ar; la contraseña está en la doc interna) |
| Posgrado | pagos@posgrado.frba.utn.edu.ar (o directo: aregaliazummer@frba.utn.edu.ar) |
| TUNB / TSNB | tsnbutn@yahoo.com.ar, tsnb@sceu.frba.utn.edu.ar |
| Demás / Lote SCEU | cc: alexanderlopez@frba.utn.edu.ar; acecaloni@frba.utn.edu.ar |
| Curso de seguridad | gisela@frba.utn.edu.ar |
| APM | Coordinadora: mrodriguezgiavarini@frba.utn.edu.ar · Encargado: poliveto@frba.utn.edu.ar |
| Equipos de fútbol / Deportes SAE | wviscovich@frba.utn.edu.ar |

A otras áreas no les sirven capturas de SCI si no usan SCI (E-Learning usa SIGEAD): mandar los datos en texto.

## Datos faltantes

El mail de PNP **no trae** varios datos que el ticket necesita (nombre de archivo, entidad, fecha de pago, concepto, plan de pago). Antes de generar el texto final, armar la lista de qué falta por PNP y pedirlo así:

> Para armar el ticket me faltan estos datos:
> - PNP 00010102: Fecha de pago, Concepto Ingreso, Plan Pago
> - Lote 00016079: Nombre de archivo y Entidad Recaudadora
>
> Lo más rápido es correr esta consulta en la DB de SysAdmin y pegarme el resultado: (query de abajo)

Igual generar un **borrador** con `[COMPLETAR: campo]` en los huecos, así el usuario ve cómo queda. Nunca inventar fechas, montos, nombres ni números de ticket.

Query para traer todo lo necesario (DB SysAdmin, adaptada de "Pnp a Enviar a Elearning"):

```sql
SELECT
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
LEFT JOIN SciPlanPago pp                   ON pp.id = scp.PlanPagoId
WHERE pnp.LoteId = /*ID de lote*/;   -- o: WHERE pnp.Id IN (/*IDs de PNP*/)
```

Para "No existe una Cuota" la cuota no está en SCI, así que nombre/concepto vienen vacíos: el nombre del inscripto hay que sacarlo de otra fuente (SysGestión, Mercado Pago, comprobante). Si no se consigue, omitir la línea.

## Plantillas

Formato de valores: fechas `DD/MM/AAAA`; montos pagados con separador de miles y sin decimales si son enteros (`166.500`; con decimales `1.234,50`); el **Error se copia textual** tal como viene del SCI.

### 1. Ticket a E-Learning

**Resumen** (título): `Pago no procesable en SCI - <motivo corto> - <NombreArchivo>`
Ej.: `Pago no procesable en SCI - Monto no coincide con la cuota - FP.19.EL.20260923.1881_21760.txt`. Si hay varios tipos: `Pagos no procesables en SCI - Montos no coinciden y cuotas inexistentes - <archivo>`.

**Descripción** — respetar exactamente este estilo (es el que usa el equipo):

```
Buenas tardes,

Me comunico desde el área de Soporte de Aplicaciones ya que tenemos un pago el cual no se pudo procesar en el Sistema de Control de Ingresos (SCI) debido a que el valor abonado no coincide con el valor de la cuota. Por lo tanto tampoco lo podemos impactar manualmente.

A continuación le incluyo más datos:

Entidad Recaudadora: Mercado Pago
Nombre Archivo/Lote: FP.19.EL.20260923.1881_21760.txt

Error: El monto pagado (166500) no coincide con el monto de la Cuota (129550,0000) ni el monto de pronto pago (129550,0000)
Código de barras: 0937022999990026253000935644999900262465
Fecha de pago: 21/07/2026
Monto pagado: 166.500
Nombre inscripto: Fernandez Aguirre, Bruno Ignacio
Concepto Ingreso: Diplomatura en Relaciones Internacionales
SubConcepto Ingreso: 2538
Plan Pago: $222000 en un pago completo en pesos

Ademas, en el mismo lote, algunos pagos apuntan a un numero de cuota inexistente.

Error: No existe una Cuota para el Código 0937022999990026222000949154999900262371
Código de barras: 0937022999990026222000949154999900262371
Fecha de pago: 22/07/2026
Monto pagado: 262.682
Nombre inscripto: Ruiz Ortega, Micaela Belen

Quedamos al pendiente acerca de cómo proceder en este caso.

Saludos cordiales.
```

Reglas:
- La frase "debido a que …" describe el tipo de error **principal** (el primero / el más frecuente). Motivos: montos → "el valor abonado no coincide con el valor de la cuota"; cuota inexistente → "el pago apunta a un número de cuota inexistente".
- Si son varios pagos: "tenemos pagos los cuales no se pudieron procesar … Por lo tanto tampoco los podemos impactar manualmente."
- Agrupar los PNP por tipo de error. El segundo grupo se introduce con "Ademas, en el mismo lote, algunos pagos …" (o "otro pago …" si es uno).
- Para "No existe una Cuota": solo Error, Código de barras, Fecha de pago, Monto pagado, Nombre inscripto.
- Opcionales (solo si están): DNI, Notas, Motivo beca, CUIT / razón social (persona jurídica).
- Un ticket por lote. Si hay PNPs de lotes distintos, un ticket por lote.

### 2. Mail al coordinador del área (no E-Learning)

```
Asunto: Pago no Procesable en SCI
CCO: soportedeaplicaciones@frba.utn.edu.ar

Buenas tardes,

Me comunico desde el área de Soporte de Aplicaciones ya que tenemos un pago el cual no se pudo procesar en el Sistema de Control de Ingresos (SCI) debido a que <motivo>. Por lo tanto tampoco lo podemos impactar manualmente.

A continuación le incluyo más datos:

Entidad Recaudadora:
Nombre Archivo/Lote:

Error:
Código de barras:
Fecha de pago:
Monto pagado:
Nombre inscripto:
Número de documento:
Concepto Ingreso:
SubConcepto Ingreso:
Plan Pago:

Quedamos al pendiente acerca de cómo proceder en este caso.

Saludos cordiales,
<FIRMA>
```

Motivos según caso: montos → "el monto abonado no coincide con ninguna de las cuotas del curso"; cuotas anteriores → "el inscripto tiene una o más cuotas anteriores sin abonar, lo que impide imputar el pago"; sin cuotas → "el inscripto ya tiene todas las cuotas del curso abonadas (por lo que correspondería evaluar un reembolso o si se encuentra cursando otro curso)". Poner el destinatario según la tabla de contactos. Se pueden adjuntar capturas (inscripción + plan de cuotas) cuando el área usa SCI.

### 3. Descripción Resolución del PNP (campo en SCI)

a) Derivado / no se puede cobrar → **¿Pendiente? = Sí**:
```
No se puede cobrar manualmente (<RESUMEN>). Se comunicó con <ÁREA> vía <MEDIO>. Ticket #<NÚMERO> donde se trabaja el PNP: https://atencion.frba.utn.edu.ar/scp/tickets.php?id=<IDTICKET>
```
Ej. RESUMEN: "monto pagado no coincide con la cuota"; ÁREA/MEDIO: "E-Learning vía ticket en su portal (Jira)", "Posgrado vía mail".

b) Cobrado a mano → **¿Pendiente? = No**: `Se cobró manualmente. Recibo <NRO_RECIBO>`

c) Irresoluble (cuota eliminada) → queda **Pendiente = Sí**:
```
<ID_PNP>: Irresoluble.
<DD/MM/AAAA>: No existe ninguna cuota asociada con el código de barras. Por lo tanto tampoco se puede determinar a qué inscripción, curso y/o área correspondería el pago.
```

Si falta el número/ID de nuestro ticket, dejar `<NÚMERO>`/`<IDTICKET>` y avisarlo.

### 4. Nota interna del ticket (osTicket/OTRS)

Una línea por PNP, formato `ID: Estado. Fecha: acción.` Ej.:
```
PNP 00010102: Pendiente.
21/10/2026: Monto pagado no coincide con la cuota. Se abrió ticket a E-Learning (portal Jira) con los datos del pago. Se marcó el PNP como pendiente.
PNP 00010703: Resuelto.
21/10/2026: Cuota ya impactada; se cobró manualmente la cuota siguiente (Recibo <NRO>).
```
Usar la fecha de hoy salvo que el usuario indique otra.

**Seguimiento (5 días hábiles)**: si el área no responde en 5 días, revisar si hicieron el cambio. Si no, cerrar el ticket sin éxito y actualizar la resolución del PNP (queda pendiente). Recordárselo al usuario al final cuando se derive a un área.

## Anexo: Cobro manual (cuando el monto coincide)

1. Anotar ID de lote. En SCI (TST o PRD) buscar el lote por Id → anotar **entidad recaudadora** y **fecha de pago**.
2. Ver PNPs del lote (ícono $), copiar el código de barras de la descripción del error.
3. Nueva pestaña de SCI → buscar por *Cod. Barras* (o, si solo hay ID de cuota: *Cobros* → buscar por nombre → inscripción del SubConcepto → ícono de billetes; si no aparece *Cobros* en el menú, apretar *Volver* hasta que aparezca).
4. Verificar que el monto pagado coincide con una cuota y que no hay anteriores impagas.
5. Cargar **medio de pago** = el de la entidad, **fecha de pago** = la del PNP, tildar la cuota, tildar "Lanzar automáticamente la impresión" para obtener el nro. de recibo → Grabar. Fecha, entidad y monto deben ser **iguales** a los del PNP.
6. Editar el PNP: ¿Pendiente? = No, Descripción Resolución = "Se cobró manualmente" + nro. de recibo → Grabar.

## Errores de lote ("Se produjo un error al generar el Lote")

Ningún pago del lote entró. Estos tickets los maneja **exclusivamente Soporte de Aplicaciones**: mover a la cola **"Soporte De Aplicaciones > SCI"** y avisar al área. Si el archivo no lo cargó SCI automáticamente (ej. lo carga E-Learning), primero notificar al área con el error y la causa detectada; ofrecer corregirlo nosotros pero esperar su autorización antes de modificar/resubir.

| Error | Causa / solución |
|---|---|
| "Hay más de un registro con el mismo id/codigo de barras en el archivo" | Pagaron la misma cuota 2 veces. Descargar el archivo (*Cobros externos → Carpetas*, o SysGestión si es SCEU), detectar duplicados: `awk '{print substr($0, length($0)-39)}' entrada.txt \| sort \| uniq -d` (o en Notepad++ regex `^(.*?)$\s+?^(?=.*^\1$)`). Pocos registros: cobrar todos a mano. Muchos: quitar/corregir el duplicado, ajustar total y cantidad en la última línea, subir a *Entrada* con el **mismo nombre** que en SCI-Lotes; se procesa al día siguiente hábil (en TST: *Forzar proceso*). Los duplicados se resuelven como PNP. |
| "Object reference not set to an instance of an object" | Casi siempre formato del archivo. Descargarlo, compararlo con el formato de la entidad y con otros lotes OK de la misma entidad (ojo con caracteres invisibles \n, \r), corregir y resubir. |
| "La cantidad de comprobantes procesados no coincide… ó los importes del lote difieren…" | Revisar cantidad/importe de la línea de totales vs. el detalle; corregir y resubir. |
| "La fecha pertenece a un período cerrado" | Abrir el período en SysAdmin (*Archivo → Tablas generales → Períodos*), **hablar antes con Presupuesto**; mover el archivo de *Error* a *Entrada* renombrado. |
| "Existen cuotas pagas" / "La inscripción no presenta deuda" | Choque "Pago completo" vs "Cuota": cambiar a Ajuste el tipo de la cuota paga, renombrar y resubir el archivo. |
| "Archivo sin contenido. Ver comprobante linea: 0" | Problema de la entidad: contactarla. |

Nota para el ticket de error de lote:
```
<IDLOTE>: Pendiente/Resuelto.
Entidad Recaudadora: <...>
Nombre Archivo: <...>
<DD/MM/AAAA>: Tomé el archivo de la carpeta <RUTA> > <AL> > <ARCHIVO>.
Los códigos de barras que se encuentran duplicados son:
<CODIGO1>
<CODIGO2>
Cambiados manualmente los códigos de barras duplicados manteniendo los IDs de cuotas, subiendo el archivo modificado a <RUTA> > <AL> > <ARCHIVO> para que lo tome al día siguiente hábil <DD/MM/AAAA>. En todo caso se resolverán los PNPs manualmente.
<DD/MM/AAAA>: Ticket con PNPs asociado: <link>
```
Y en el ticket de PNPs que se genere después: `Ticket con error de lote asociado: <link>`.