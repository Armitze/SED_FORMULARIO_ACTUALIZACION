# Formulario 13-IF-016 — Actualización de datos de contratistas (versión web)

Versión web del formato **13-IF-016 "Formulario de actualización de datos para personas naturales — honorarios y servicios personales (art. 103 ET)"** de la Secretaría de Educación de Bogotá, Oficina de Tesorería y Contabilidad.

El contratista carga su **RUT** (DIAN) y su **RIT** (Secretaría Distrital de Hacienda) en PDF, los datos del contrato se toman de **SECOP II**, el formulario se llena casi solo y al final descarga:

1. **El PDF para firmar**, con la misma información y estructura del formato oficial (y la hoja de deducciones cuando aplica).
2. **El Excel original diligenciado** (`13-IF-016…xlsx`), con sus fórmulas, validaciones, hoja oculta y protección intactas, para que el proceso de Tesorería no cambie.

Los documentos se leen en el navegador y **no se envían a ningún servidor**. Lo único que sale del equipo es la consulta del contrato a Datos Abiertos Colombia (SECOP II), con el número de identificación. Sin internet, todo lo demás funciona y el contrato se llena a mano.

**Como un Excel:** cada contratista usa una copia en limpio del archivo y sus datos quedan guardados **dentro de ese mismo archivo HTML**. Al cerrarlo y volverlo a abrir, sus datos siguen ahí.

## Para el contratista

1. Abre `formulario-13-IF-016.html` (doble clic; Chrome o Edge).
2. En **Documentos** arrastra tu RUT y tu RIT. Deben ser los PDF descargados de los portales, no escaneados:
   - RUT: DIAN → MUISCA → *Copia del RUT*.
   - RIT: Oficina Virtual de Hacienda → *Mi RIT → Certificado RIT*.
3. Pulsa **Continuar**. Lo leído ya está en el formulario: revísalo y corrígelo en cada paso. Si habías escrito algo antes, se conserva y debajo del campo aparece "Tu RUT dice: X · Usar este".
4. La primera vez que avanzas, el navegador pregunta dónde guardar tu formulario (nombre sugerido `13-IF-016_APELLIDOS_NOMBRES.html`). Desde ahí se guarda solo en ese archivo; arriba se ve "Guardado".
5. En **Contrato** se buscan tus contratos con la SED en SECOP II: si hay uno vigente se llenan sus datos; si hay varios, eliges cuál es. El número de contrato de la SED y los CRP se escriben a mano.
6. Completa lo que falte (cuenta bancaria, CRP, ARL, supervisión, preguntas de retención, deducciones).
7. En **Revisión** descarga el PDF, fírmalo y envíalo con la certificación bancaria y los soportes de deducciones a tu operativo o jefe de área, quien lo remite a `actualizarterceros@educacionbogota.gov.co`. El archivo se nombra solo como `NOMBRE_CONTRATO_AÑO`.

### Guardado

- **Chrome y Edge:** la primera vez se elige dónde guardar; después cada cambio se guarda solo en ese archivo. Al reabrirlo, el navegador puede pedir una vez permiso para seguir guardando ("Reanudar").
- **Firefox y Safari:** no permiten escribir archivos; el botón **Descargar copia** baja el formulario con los datos.
- Si se cierra antes de guardar, al volver a abrir se ofrece **recuperar** el avance (queda en la memoria del navegador solo como red de seguridad).
- Al abrir un archivo con datos aparece "Formulario de NOMBRE · guardado el …". Si otra persona recibe un archivo ya usado, **Empezar de nuevo** lo deja en limpio y su siguiente guardado pide un archivo nuevo (el anterior no se modifica).

### Qué se toma de cada documento

| Documento | Datos |
|---|---|
| RUT | NIT y DV (verificado con el algoritmo de la DIAN), tipo y número de documento, apellidos y nombres, dirección, país, departamento, municipio, correo, teléfonos (fijo → Teléfono 1, celular → Teléfono 2), actividad CIIU principal, régimen de IVA (responsabilidades 48/49) y la pregunta C3 (Régimen Simple, responsabilidad 47). |
| RIT | Actividad económica principal de ICA en Bogotá (código, descripción y tarifa por mil del catálogo); si trae varias, las demás se ofrecen en el paso Tributario. Además verifica que el RIT sea de la misma persona. |
| SECOP II | Año del contrato (firma), valor total, fechas de inicio y terminación, cesión (estado "cedido"), valor mensual (calculado con la duración) y, si aparecen, supervisor y área funcional (del objeto del contrato). Consulta: conjunto `jbjy-vk9h`, entidad `701321135` (Secretaría de Educación del Distrito), sin contratos en borrador, cancelados, cerrados, terminados o vencidos. |

Si solo se carga el RUT, el formulario sugiere las actividades RIT compatibles con el código CIIU (por ejemplo 6920 → 69201 / 69202).

## Para la SED: mantenimiento

Requisitos para compilar: Node 20+ y, para regenerar catálogos, Python con `openpyxl`.

```bash
npm install
```

### Cada año

Edita `src/js/config.js`:

- `uvt` y `uvtAnio`: UVT vigente (celda `'Validador- Datos'!BJ2` del Excel).
- `anioGravable`: año de las preguntas C1 y C2.
- `anioContratoMin` / `anioContratoMax`: rango permitido del año del contrato (validación de la celda F46).
- Topes de deducciones si cambia la norma.
- `secop`: dirección de la consulta, código de la entidad y estados de contrato que se descartan.

Luego compila el archivo único:

```bash
npm run build
```

### Si cambia el Excel oficial

Reemplaza el `.xlsx` en la raíz (mismo prefijo `13-IF-016`) y regenera los catálogos (países, municipios, bancos, CIIU, RIT, ARL, áreas…):

```bash
npm run catalogos
```

Si se movieron celdas editables, actualiza el mapeo `excel:` de cada campo en `src/js/schema.js`; las pruebas verifican que cubra exactamente las celdas desbloqueadas del formato. Después ejecuta `npm run build`.

### Pruebas

```bash
npm test
```

- Las pruebas de paridad abren el Excel real por COM (Windows con Excel instalado) y comparan cada valor calculado (nombre completo, códigos, IVA, duración, codificación tributaria, deducciones, mensajes) con la versión web.
- Para omitirlas: `SIN_EXCEL=1 npm test`.
- Las pruebas de lectura de PDF usan muestras anonimizadas en `tests/fixtures/`. Si existe una carpeta de muestras reales (variable `SAMPLES_DIR`), también se ejecutan contra ellas, verificando solo invariantes.

## Estructura

```
src/index.html, styles.css, print.css   interfaz y diseño de impresión
src/js/schema.js        pasos, campos, reglas y celda del Excel de cada campo
src/js/config.js        parámetros anuales
src/js/catalogos.js     listas extraídas del Excel (generado)
src/js/calc.js          fórmulas del Excel (paridad exacta) y validaciones
src/js/pdftext.js       lectura de PDF con pdf.js y detección del tipo de documento
src/js/parser-rut.js    lectura del RUT (formatos DIAN 2013 a 2026)
src/js/parser-rit.js    lectura del certificado RIT (formato SHD v2.02)
src/js/export-excel.js  llena el Excel original editando solo las celdas de entrada
src/js/print.js         documento para imprimir / guardar como PDF
src/js/secop.js         consulta del contrato en SECOP II (Datos Abiertos Colombia)
src/js/guardado.js      guardado de los datos dentro del propio archivo HTML
src/js/app.js           asistente por pasos, carga de documentos, contrato SECOP, guardado
tools/build.mjs         genera formulario-13-IF-016.html (todo incluido, sin red)
tools/extract_catalogos.py
tests/                  pruebas (node --test)
```

## Diferencias deliberadas con el Excel

La versión web **calcula igual que el Excel** y el Excel exportado recalcula con sus propias fórmulas. En las **validaciones** la versión web es más útil en algunos casos:

- Una dirección en el exterior puede quedar completa. El validador del Excel revisa por error el código de departamento en la casilla "País".
- Se verifica el DV contra el NIT y que el municipio pertenezca al departamento.
- Teléfono 1 admite `0` (como indica el instructivo) además de 10 dígitos.
- Si se marca una deducción, se exigen todos sus datos y soportes, no solo el nombre de la entidad.
- La lista de bancos oculta 4 entradas internas o de prueba de la lista del Excel (`BANCO GENERAL TRANSITORIAS TRM`, `DUMY1`, `BANCO DUMMY MULTAS SED`, `DUMMY SSF`).
- El parentesco del dependiente es texto libre, como en el Excel (`'FORMATO DEDUCCIONES'!W22` no tiene lista); la web solo sugiere opciones.
- Código ARL: se aceptan los 1.670 códigos de la tabla del Excel; si se elige uno de los 562 que no están en su lista desplegable (AX50), se muestra una nota para confirmarlo con el certificado de la ARL.
- El número de contrato se escribe en el Excel como número (`0123` → 123, igual que al teclearlo). Si lleva letras o guiones, la web avisa: con texto, la celda S13 de la hoja de deducciones del Excel original da `#VALUE!`.
- Las advertencias internas de mantenimiento (por ejemplo, la tabla de años de certificados vencida) no se muestran a la persona; van a la consola del navegador.

## Limitaciones conocidas

- Los PDF escaneados o "impresos a PDF" no tienen texto legible; el formulario lo detecta y pide el PDF original o el llenado manual.
- El formato del certificado RIT de persona natural se validó con un solo ejemplo real (2026); los de persona jurídica con 13.
- La tabla del Excel que calcula el año de los certificados (`'Validador- Datos'!BI13:BJ17`) llega hasta el 1 de abril de 2027; conviene extenderla en el Excel oficial. La versión web ya usa la regla general.
- La fecha dentro del mensaje "Información completa…" del Excel depende de la configuración regional del equipo que lo abre.
