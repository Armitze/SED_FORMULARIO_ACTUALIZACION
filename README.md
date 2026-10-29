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
7. En **Revisión** descarga el PDF, fírmalo y envíalo a tu operativo o jefe de área, quien lo remite a `actualizarterceros@educacionbogota.gov.co`. Es un solo PDF: el formato en la primera hoja y, en las siguientes, la certificación bancaria y los soportes de deducciones que adjuntaste (los PDF tal cual; cada foto JPG/PNG en una hoja carta). El archivo se nombra solo como `NOMBRE_APELLIDO_CONTRATO_AÑO` (primer nombre y primer apellido, por ejemplo `ANA_PÉREZ_1234_2026.pdf`).

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

## Para Tesorería: consolidar los formularios recibidos

`consolidador-13-IF-016.html` mantiene un consolidado con una fila por contratista dentro de una **carpeta raíz** (por ejemplo, una carpeta compartida de Tesorería):

```
Carpeta raíz/
  Consolidado_13-IF-016.xlsx
  Consolidado_13-IF-016 (anterior).xlsx      respaldo de la versión antes del último guardado
  Contratistas/
    2026/
      PEREZ_GOMEZ_ANA/                       Certificacion_bancaria.pdf, Soporte_dependiente_1.pdf, …, Formulario.html
      PEREZ_GOMEZ_ANA_1234/                  el mismo nombre con otro contrato del mismo año
```

1. Ábrelo con doble clic en **Chrome o Edge** y elige la carpeta raíz (la próxima vez ofrece usar la misma; el navegador pide permiso de nuevo).
2. Arrastra los `.html` que enviaron los contratistas, o elige la carpeta donde los guardaste.
3. Revisa la lista: estado de cada formulario (completo o cuántos pendientes) y qué pasará en el consolidado: **Nuevo**, **Se actualiza** (el formulario es más reciente que la fila) o **Ya está** (sin cambios). Del mismo contratista y contrato se usa el guardado más reciente.
4. Pulsa **Agregar al consolidado**: se guardan los archivos en `Contratistas/AÑO/NOMBRE/` y se reescribe el Excel con las filas nuevas y actualizadas. Al actualizar, los soportes anteriores de ese contratista se reemplazan por los del formulario nuevo.

En el Excel se puede filtrar, ordenar y agregar columnas propias (observaciones…): se conservan, también en las filas que se actualizan. Las columnas de soportes y «Carpeta del contratista» enlazan a los archivos. Si el Excel está abierto, ciérralo antes de agregar formularios (Windows no deja reemplazarlo). Firefox y Safari no permiten trabajar sobre una carpeta: ahí se descarga un ZIP o solo el Excel.

El Excel tiene los campos del formulario en el orden de los pasos, más los valores calculados (nombre completo, titular de la cuenta, descripciones de actividad y ARL, tarifa ICA, duración, valor sin IVA e IVA, valores mensuales a deducir y la codificación tributaria cuando el formulario está completo). Todo se lee en el equipo: nada se envía a un servidor.

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
- `secop`: dirección de la consulta, código de la entidad y estados de contrato que se descartan. Desde octubre de 2026 la API v3 de Datos Abiertos exige un token de aplicación: si se pone uno en `appToken` (gratuito, en datos.gov.co → Perfil → Configuración del desarrollador), la cédula viaja en el cuerpo de la petición; sin token se usa la API abierta (`urlAbierta`), donde la cédula va en la URL (cifrada por HTTPS, pero queda en los registros del servidor).

Luego compila el archivo único y el consolidador:

```bash
npm run build
npm run build:consolidador
```

### Publicar una versión nueva

Los formularios ya entregados consultan al abrir `version.json` en GitHub (`actualizaciones` en `src/js/config.js`). Si allá hay una versión mayor, muestran «Hay una nueva versión» con el botón **Actualizar**, que descarga el formulario nuevo y le pasa los datos del contratista. En Chrome/Edge, si el formulario ya se guarda en su archivo, lo reemplaza y recarga; si no, descarga la versión nueva con los datos.

1. Sube `version` en `package.json` (se compara parte por parte como número: `1.02` > `1.01`, `1.10` > `1.9`).
2. Opcional: escribe en `"notas"` de `version.json` una frase corta para el contratista.
3. `npm run build` (actualiza `formulario-13-IF-016.html` y `version.json`) y sube ambos archivos a `main`.

El repositorio debe ser público: sin eso GitHub responde 404 y el aviso nunca aparece (el formulario sigue funcionando igual).

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
src/js/soportes.js      soportes adjuntos (certificación bancaria y deducciones) dentro del HTML
src/js/app.js           asistente por pasos, carga de documentos, contrato SECOP, guardado
src/consolidador.html   consolidador para Tesorería (js/consolidador.js: lectura y Excel; js/consolidador-ui.js: interfaz)
tools/build.mjs         genera formulario-13-IF-016.html y consolidador-13-IF-016.html (todo incluido, sin red)
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
