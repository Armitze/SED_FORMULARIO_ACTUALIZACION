# Prueba de humo de la interfaz (src/index.html + src/js/app.js)

Servidor de desarrollo: `py -m http.server 8765 --bind 127.0.0.1` desde la raíz del repo y abrir
<http://127.0.0.1:8765/src/index.html>. Repetir lo esencial con el archivo construido
(`node tools/build.mjs`, abrir `formulario-13-IF-016.html` con doble clic, sin red).

Desde la consola del navegador, `App` expone: `obtenerEstado()`, `establecer(valores, origen?)`,
`irA(paso)`, `procesarArchivos(files, 'RUT'|'RIT')`, `recibirResultado(tipo, resultado, archivo?)`,
`validar()`, `derivar()`, `estadoLimpio()`, `reiniciar()`.

## General
- [ ] La consola no muestra errores al cargar ni al recorrer los 8 pasos.
- [ ] A 375 px de ancho no hay desplazamiento horizontal (`document.documentElement.scrollWidth === innerWidth`).
- [ ] En escritorio el contenido es una sola columna centrada (máx. ~760 px) y los campos van en 2 columnas.
- [ ] Con "reducir movimiento" activo en el sistema no hay animaciones.
- [ ] Todo se puede hacer con teclado (Tab, flechas en Sí/No, Enter/Escape en las listas con búsqueda) y el
      foco se ve (anillo azul) en botones, enlaces, Sí/No, casillas y barra de pasos.
- [ ] A 375 px los elementos que se tocan miden al menos 44 px de alto (Sí/No, "Agregar otro CRP", enlaces de
      navegación, renglones de pendientes, "¿Cómo diligenciar…?").
- [ ] Solo hay un aviso flotante a la vez; en el teléfono sale arriba y en escritorio abajo a la derecha (no tapa
      "Borrar mis datos" del pie).

## Pasos y navegación
- [ ] "Siguiente" nunca se bloquea. "Falta este dato." solo aparece en campos que estaban a la vista cuando se
      dejó el paso (no al abrir un bloque nuevo, p. ej. al marcar "Por dependientes").
- [ ] El resumen del paso separa "Hay N datos por corregir" (rojo) de "Faltan N datos en esta sección".
- [ ] La barra de pasos muestra ✓ en pasos completos y un punto ámbar (y barra ámbar) en pasos visitados con
      pendientes; los 8 segmentos miden lo mismo; cada etiqueta lleva a su paso.
- [ ] Al cambiar de paso el foco queda en el título del paso.

## Campos
- [ ] NIT: escribir `80.123-456` deja `80123456`; Número de identificación se copia solo; el DV sugiere `Usar 4`.
- [ ] NIT: pegar `1.023.456.789` deja `1023456789`; pegar `52.123.456-7` deja `52123456` y DV `7`.
- [ ] Teléfono 2: pegar `+57 300 123 4567` deja `3001234567`. Número de cuenta: pegar 16 dígitos con espacios
      los conserva todos.
- [ ] Dinero: `60000000` se ve `$ 60.000.000` y el estado guarda `60000000`; pegar `4.500.000,00` guarda
      `4500000` (nunca 450000000); Supr/Retroceso junto a un punto borra el dígito vecino.
- [ ] Apellidos/nombres se convierten a mayúsculas mientras se escribe; aparece "Nombre completo".
- [ ] País ≠ COLOMBIA oculta Departamento y Municipio; Municipio solo lista los del departamento elegido; al
      cambiar el departamento a mano el municipio se vacía (aunque exista uno con el mismo nombre).
- [ ] Listas con búsqueda (país, municipio, banco, CIIU, RIT, ARL, área): buscar sin tildes ("bogota"),
      por código ("6201"), flechas + Enter para elegir, Escape para cerrar. Escribir una descripción que se repite
      (ARL, RIT) no elige ninguna sola.
- [ ] Código ARL fuera de la lista desplegable del Excel (p. ej. 4241201): nota para confirmarlo con el certificado.
- [ ] Tipo de cuenta Daviplata muestra la ayuda del celular y el botón "Usar <celular>".
- [ ] "+ Agregar otro CRP" muestra CRP 2 y luego CRP 3.
- [ ] Contrato: el bloque Duración / Valor sin IVA / IVA va debajo de las fechas; con fechas o valores con error,
      la duración muestra "—". Número de contrato con letras: aviso suave en el paso.
- [ ] Retención: las preguntas C1–C4 van sin tarjetas (separadas por una línea); deducciones y AFC / pensiones
      voluntarias muestran sus campos solo al marcarlas; motivos del dependiente cortos con el texto legal debajo
      al elegir; parentesco acepta texto libre con sugerencias; nota del año de los certificados.

## Documentos
- [ ] En un teléfono la zona dice "Elegir el PDF" (sin "Arrastra…"); la línea de privacidad dice "dispositivo".
- [ ] Soltar un PDF de RUT en la zona del RIT (o al revés) lo ubica en su lugar con un aviso.
- [ ] PDF escaneado, con contraseña, formulario de solicitud del RIT o archivo que no es PDF: mensaje en tono
      neutro (solo el ícono en rojo) y "Intentar con otro archivo". Si había un documento usado antes, dice
      "Seguimos usando los datos de tu RIT anterior".
- [ ] "Esto encontramos en tu RUT": todo marcado salvo lo que difiere de lo ya escrito ("Ahora tienes: …").
      Con lista larga hay subtítulos (Identificación, Ubicación y contacto, Información tributaria); NIT y DV van
      en un renglón (con el número de identificación si es igual) y los nombres en "Nombre completo".
- [ ] Un solo botón principal: "Usar N datos y continuar" (N cambia al marcar/desmarcar). Al pulsarlo (o al ir a
      otro paso) se llenan los campos con la marca RUT / RIT y sale un solo aviso "Listo: usamos N datos…".
      "Prefiero llenarlo manualmente" desaparece cuando ya hay un documento.
- [ ] Al volver a Documentos: la zona dice "Usamos N datos en el formulario" y debajo "Deshacer", que deja el
      formulario exactamente como estaba (incluidos número de identificación y municipio) sin tocar lo que se
      editó después, y vuelve a mostrar la lista con el foco en su título.
- [ ] Salir de Documentos con la lista desmarcada y volver: la lista sigue ahí (no se pierde lo leído).
- [ ] "Descartar lo leído del RUT" quita la lista y deja el foco en la zona de carga.
- [ ] Sin RIT, se propone la actividad RIT del mismo código CIIU como "Sugerido" (sin marcar).
- [ ] RUT y RIT de documentos distintos: aviso de que no coinciden (una sola vez, arriba de las listas).
- [ ] RUT y RIT con direcciones distintas: la nota va en el renglón "Dirección" y se repite bajo el campo
      Dirección del paso Contacto (mientras siga la del RUT).
- [ ] Datos de confianza baja empiezan sin marcar; los de confianza media llevan la marca "Verifica".
- [ ] Teléfono 1 = 0 se explica en su renglón (sin repetir la nota arriba); la columna de origen dice solo
      "Casilla N".
- [ ] RUT de persona jurídica o plantilla en blanco: la zona muestra el aviso del parser (no "no encontramos datos").
- [ ] RIT cuya actividad 1 es un código antiguo sin equivalente directo: lista "Elige una actividad…" solo con
      códigos de la tabla del formulario.

## Revisión y descargas
- [ ] Medidor de avance; pendientes por paso en lenguaje sencillo (sin "Responde la pregunta C1"); cada
      renglón se pulsa entero y lleva al campo.
- [ ] "Para revisar" usa textos amables (IVA con su explicación) y nunca muestra avisos internos
      (simular 2027-05-01: no aparece "'Validador- Datos'!BI13:BJ17").
- [ ] "Ver un resumen de tus datos" va antes de Descargas (abierto si el formulario está completo en ≥960 px).
- [ ] La codificación tributaria solo aparece con el formulario completo.
- [ ] El nombre del archivo solo se muestra cuando hay nombre, número y año de contrato.
- [ ] Descargar PDF / Excel con datos pendientes abre un diálogo cuyo botón principal es "Volver y completar"
      (lleva al primer pendiente); "Descargar de todas formas" es el secundario; Esc no descarga.
- [ ] El Excel se descarga como `NOMBRE_CONTRATO_AÑO.xlsx`; el PDF abre la ventana de impresión. Ctrl+P sin
      pasar por el botón imprime el formulario con los datos actuales (nunca una hoja en blanco ni datos viejos).
- [ ] Guardar borrador (.json) y Cargar borrador restauran todo (incluidas las marcas RUT/RIT). Un .json sin
      valores utilizables o de más de 1 MB se rechaza sin borrar lo que hay.
- [ ] Recargar la página muestra "Recuperamos tu avance"; "Empezar de nuevo" pide confirmación y borra todo.
- [ ] Con dos pestañas abiertas, guardar en una avisa en la otra ("Traer esos cambios").
- [ ] Si el navegador no deja guardar (cuota llena / modo privado), el indicador "Guardado" se oculta y un aviso
      ofrece "Guardar borrador".
