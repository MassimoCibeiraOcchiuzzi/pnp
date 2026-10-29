# Resolver PNP (HTML offline)

Herramienta local para resolver **Pagos No Procesables (PNP)** y **errores de lote** del SCI. Replica la skill "resolver-pnp" (`docs/SKILL.md`) **sin IA y sin conexión**.

## Cómo abrirlo

Descargá `dist/resolver-pnp.html` y abrilo con doble clic (Chrome o Edge). No hay que instalar nada y funciona sin internet.

## Flujo de uso

1. **Pegar** el ticket o mail del SCI en el cuadro 1 (asunto + cuerpo). Sirve copiado de osTicket, OTRS o del cliente de mail, con tabs, espacios o todo en una línea. La herramienta detecta sola el tipo de ticket:
   - notificación de lote
   - error de lote
   - lote con PNP
   - ticket de una persona
2. **Revisar el diagnóstico** y la tarjeta de cada PNP: caso (B1/B2/B3/B4), área dueña y advertencias (nombre con caracteres rotos, área indeterminada, datos faltantes).
3. **Contestar las preguntas de SCI** de cada PNP, mirando SCI:
   - ¿el monto coincide con otra cuota?
   - ¿aparece la cuota por Cod. Barras?
   - ¿qué ves en la inscripción?

   Mientras diga "Todavía no lo revisé", los textos salen como **borrador** asumiendo derivación.
4. **Completar lo que falta**: correr la query (ver abajo) y pegar la grilla en el cuadro 2, o escribir los datos a mano en "Completar / corregir datos". Lo resaltado en amarillo es un hueco `[COMPLETAR: …]`.
5. **Mensaje de Tesorería** (opcional, cuadro 4): pegar el mail de Tesorería con los pagos sin número de recibo, tal como llega (con mails en formato `[x](mailto:x)` o planos, o copiado de una planilla con tabs). La herramienta:
   - cruza cada pago con los PNP por lote EL, monto (o suma de pagos de la misma orden), fecha de pago y nombre, y muestra la confianza y el porqué
   - en "No existe una Cuota" completa nombre, mail y fecha con fuente Tesorería (solo con confianza alta; si es media o baja aparece "Posible pago de Tesorería" con el botón **Usar estos datos**; si hay empate, queda **ambiguo** y se elige a mano)
   - agrega la tabla de cruce (con "Copiar como tabla" para planilla), la **Respuesta a Tesorería** y una línea por PNP cruzado en la nota interna

   Si el cuadro 1 está vacío y solo se pega el mensaje de Tesorería, el tipo es **Pedido de Tesorería** y sale la query para encontrar los PNP de esos pagos. El mensaje de Tesorería no se guarda en el navegador.
6. **Copiar** cada texto, o todo junto con "Copiar todo":
   - ticket a E-Learning (Resumen + Descripción)
   - mail al coordinador
   - Descripción Resolución del PNP, con el valor de "¿Pendiente?"
   - nota interna
   - recordatorio de seguimiento a 5 días hábiles
   - respuesta a Tesorería (si se pegó su mensaje)

El botón **Cargar ejemplo** trae casos reales de la documentación para practicar.

## La query de datos faltantes

El mail del SCI no trae entidad, archivo, fecha de pago, concepto ni plan de pago. Cuando faltan, la herramienta muestra la query con el `WHERE` ya completado (`pnp.LoteId = …` o `pnp.Id IN (…)`):

1. Copiarla y correrla en SSMS, en la DB de **SysAdmin**.
2. En la grilla: clic derecho → **Copy with Headers**.
3. Pegar en el cuadro 2. Se aceptan tabs, `;` o `,`.

Para "No existe una Cuota" la query no trae nombre ni concepto, porque la cuota no está en SCI. El nombre hay que sacarlo de SysGestión, Mercado Pago o el comprobante. Si no se consigue, esa línea se omite.

### Lote EL vs. lote SCI

El "En lote nº 1893" del mail de Tesorería **no es el ID de lote del SCI**. Es el número de lote de E-Learning que aparece en el nombre de archivo: `FP.<n>.EL.<AAAAMMDD>.<loteEL>[_<loteSCI>].txt` (ej. `FP.19.EL.20260923.1881_21760.txt` → lote EL 1881, lote SCI 21760). El puente es el **Nombre de archivo** del lote (sale de la query o se carga a mano). Si el lote SCI no tiene archivo pero un PNP cruza con confianza alta por nombre, la herramienta **sugiere** el lote EL. No lo da por confirmado: hay que aceptarlo con el botón.

### Query para encontrar los PNP de los pagos de Tesorería

Con los pagos que quedaron sin cruzar se arma una query con las mismas columnas que la de datos faltantes, filtrada por los lotes EL (`l.NombreArchivo LIKE '%.EL.%.1893[_.]%'`) y por los montos (cada pago y la suma de los pagos de una misma orden o mail). Se corre igual (SSMS, DB SysAdmin) y la grilla se pega en el cuadro 2.

## Actualizar contactos o palabras clave

Todo está en `src/config.js`: contactos por área, reglas por nombre de archivo, palabras clave por concepto y, en la sección `tesoreria`, el nombre de contacto de Tesorería, las columnas de su mensaje y la expresión de "En lote nº". Después de editarlo hay que regenerar el HTML:

```
node build.mjs
```

y repartir de nuevo `dist/resolver-pnp.html`. Hace falta Node 18 o superior, sin dependencias.

Tests: `node --test` (parser, clasificador y plantillas, con un snapshot del ticket de ejemplo de SKILL.md).

## Límites

- **No tiene acceso a SCI ni a la base de datos.** Las verificaciones de SCI las hacés vos y las contestás en las preguntas de cada PNP.
- **Nunca inventa** fechas, montos, nombres ni números de ticket: lo que no sabe queda como `[COMPLETAR: …]`, `<NÚMERO>` o `<IDTICKET>`.
- Los errores sin procedimiento documentado (B4 o error de lote desconocido) solo se describen y se sugiere derivarlos a Soporte de Aplicaciones.
- No guarda datos de alumnos. Solo recuerda tu **firma** y el **tema** claro/oscuro en este navegador.
- No incluye contraseñas: la del portal de E-Learning está en la doc interna.
- Las reglas salen de `docs/SKILL.md`. Si cambia el procedimiento, hay que actualizar el código y correr los tests.

## Estructura

```
src/config.js       contactos y palabras clave (lo único que se mantiene a mano)
src/parser.js       lectura del texto del SCI y de la grilla de la query
src/classifier.js   tipo de ticket, casos B1-B4, área dueña, decisiones, faltantes
src/templates.js    textos exactos de SKILL.md
src/ui.js           interfaz
src/index.html, src/styles.css
build.mjs           arma dist/resolver-pnp.html (todo inline)
docs/SKILL.md       reglas de la skill "resolver-pnp" (fuente de verdad)
tests/              node --test + fixtures (tesoreria.test.mjs: cruce con Tesorería)
tools/e2e.mjs       verificación en Chrome headless (solo desarrollo; npm install en tools/)
dist/               el HTML listo para repartir (se regenera con node build.mjs)
interno/            material interno, NO se sube (está en .gitignore)
```
