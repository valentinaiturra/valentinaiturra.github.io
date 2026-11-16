// ====== VISOR CTD DE UNA CAMPAÑA ======
// Programa compartido por las páginas de campanas/. Cada página define antes:
//   const CAMPANA_ID = "1_septiembre_2023";   (el id de la campaña en datos/indice.json)
// Es el mismo visor de visor_ctd.html, pero con la campaña fija: solo se eligen estación, variable y profundidad.

// ====== AJUSTES (puedes cambiarlos) ======
const RAIZ = "../";                                   // las páginas están en campanas/, los datos en la raíz
const ARCHIVO_INDICE = RAIZ + "datos/indice.json";
const COLUMNA_PROFUNDIDAD = "Depth";
const COLUMNAS_EXCLUIDAS = ["Time", COLUMNA_PROFUNDIDAD];   // no aparecen en el menú de variables

// Variables que aparecen en los menús del perfil y de la sección, en este orden.
// Para agregar o quitar una, edita solo esta lista (usa el nombre de la columna del Excel).
// "Temperature" es la primera columna de temperatura (no la del sensor de oxígeno).
const VARIABLES_MOSTRADAS = [
  "Temperature",
  "Chlorophyll a",
  "Dissolved O₂ concentration",
  "Salinity",
  "Dissolved O₂ saturation"
];
// Variables de la lista que tienen al menos un dato en una tabla
const variablesDisponibles = tabla =>
  VARIABLES_MOSTRADAS.filter(n => tabla.columnas[n] && tabla.columnas[n].some(v => v !== null));
const COLOR_PERFIL = "#1b6ca8";

// Letras de los gráficos (perfil y sección), coherentes con la línea de tiempo.
// Nota: al descargar el PNG, si el navegador no incluye la fuente Fraunces, el título sale en Georgia.
const LETRA_TITULO = { family: "Fraunces, Georgia, serif", size: 19, color: "#0e3b52" };
const LETRA_GRAFICO = { family: "'Segoe UI', Roboto, Arial, Helvetica, sans-serif", size: 13, color: "#22262b" };
const LETRA_EJE = { size: 14, color: "#22262b" };      // nombre de cada eje
const LETRA_NUMEROS = { size: 12, color: "#4a5158" };  // números de los ejes

// Nombres en español con unidades para cada columna del Excel (iguales a visor_ctd.html).
// "Temperature (2)" es la segunda columna llamada "Temperature" del Excel (sensor de oxígeno).
const NOMBRES = {
  "Conductivity": "Conductividad [mS/cm]",
  "Temperature": "Temperatura [°C]",
  "Temperature (2)": "Temperatura del sensor de oxígeno [°C]",
  "Pressure": "Presión [dbar]",
  "Chlorophyll a": "Clorofila a [µg/L]",
  "Dissolved O₂ concentration": "Oxígeno disuelto [µmol/L]",
  "Dissolved O₂ saturation": "Saturación de oxígeno [%]",
  "Sea pressure": "Presión del mar [dbar]",
  "Depth": "Profundidad [m]",
  "Salinity": "Salinidad [PSU]",
  "Speed of sound": "Velocidad del sonido [m/s]",
  "Specific conductivity": "Conductividad específica [µS/cm]",
  "Density anomaly": "Anomalía de densidad [kg/m³]"
};
const etiqueta = nombre => NOMBRES[nombre] || nombre;

let indice = null;            // contenido de indice.json
let campana = null;           // la campaña de esta página
let estacionActual = null;    // ej. "E05"
const marcadores = {};        // marcador del mapa por estación
const cacheTablas = {};       // Excel ya leídos, para no descargarlos de nuevo

// ====== MAPA ======
const mapa = L.map("mapa");

// Imagen satelital de fondo (Esri World Imagery)
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 18,
  attribution: "Imágenes: Esri"
}).addTo(mapa);
L.control.scale({ imperial: false }).addTo(mapa);

// Celeste brillante: resalta sobre el verde del bosque y el azul oscuro del agua (y se distingue del naranjo elegido)
const estiloNormal = { radius: 7, color: "#ffffff", weight: 2, fillColor: "#19b5ff", fillOpacity: 1 };
const estiloElegido = { radius: 10, color: "#ffffff", weight: 3, fillColor: "#e0a526", fillOpacity: 1 };
// Estación sin lance en esta campaña: gris y sin clic
const estiloSinDatos = { radius: 6, color: "#ffffff", weight: 1, fillColor: "#9aa0a6", fillOpacity: 0.8 };

function dibujarEstaciones() {
  const limites = [];
  indice.estaciones.forEach(est => {
    const tieneDatos = Boolean(campana.archivos[est.id]);
    const marcador = L.circleMarker([est.lat, est.lon], tieneDatos ? estiloNormal : estiloSinDatos)
      .addTo(mapa)
      .bindTooltip(est.id, { permanent: true, direction: "right", offset: [8, 0], className: "etiqueta-estacion" });
    if (tieneDatos) marcador.on("click", () => elegirEstacion(est.id));
    marcadores[est.id] = marcador;
    limites.push([est.lat, est.lon]);
  });
  mapa.fitBounds(limites, { padding: [30, 30] });
}

// ====== LECTURA DEL EXCEL ======
// Convierte la primera hoja en columnas numéricas.
// Si hay nombres repetidos (dos "Temperature"), al segundo le agrega " (2)".
function tablaDesdeExcel(buffer) {
  const libro = XLSX.read(buffer, { type: "array" });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true });

  const vistos = {};
  const nombres = filas[0].map(c => {
    const n = String(c === undefined || c === null ? "" : c).trim();
    vistos[n] = (vistos[n] || 0) + 1;
    return vistos[n] === 1 ? n : `${n} (${vistos[n]})`;
  });

  const columnas = {};
  nombres.forEach((n, i) => {
    columnas[n] = filas.slice(1).map(fila => {
      const v = fila[i];
      return typeof v === "number" && isFinite(v) ? v : null;
    });
  });
  return { nombres, columnas };
}

async function cargarTabla(ruta) {
  if (!cacheTablas[ruta]) {
    const respuesta = await fetch(encodeURI(RAIZ + ruta));
    if (!respuesta.ok) throw new Error("No se encontró el archivo " + ruta);
    cacheTablas[ruta] = tablaDesdeExcel(await respuesta.arrayBuffer());
  }
  return cacheTablas[ruta];
}

// ====== ESTACIÓN DEL AÑO (hemisferio sur, estaciones meteorológicas) ======
// Verano: dic–feb · Otoño: mar–may · Invierno: jun–ago · Primavera: sep–nov
function temporadaAustral(mes) {
  if (mes === 12 || mes <= 2) return { clase: "verano", texto: "Verano austral" };
  if (mes <= 5) return { clase: "otono", texto: "Otoño austral" };
  if (mes <= 8) return { clase: "invierno", texto: "Invierno austral" };
  return { clase: "primavera", texto: "Primavera austral" };
}

function mostrarTemporada() {
  const etiquetaTemporada = document.getElementById("temporada");
  if (!etiquetaTemporada) return;
  // Mes de la campaña, tomado de la fecha del primer lance (ej. "2023-09-12" → 9)
  const fecha = Object.values(campana.archivos).map(a => a.fecha).find(Boolean);
  if (!fecha) return;
  const t = temporadaAustral(Number(fecha.split("-")[1]));
  etiquetaTemporada.textContent = t.texto;
  etiquetaTemporada.classList.add(t.clase);
  etiquetaTemporada.hidden = false;
}

// ====== PANEL ======
// Fecha del índice (2023-09-12) en formato chileno (12-09-2023)
const fechaChilena = f => f ? f.split("-").reverse().join("-") : "";

function elegirEstacion(id) {
  if (estacionActual) marcadores[estacionActual].setStyle(estiloNormal);
  estacionActual = id;
  marcadores[id].setStyle(estiloElegido).bringToFront();

  const est = indice.estaciones.find(e => e.id === id);
  const archivo = campana.archivos[id];
  document.getElementById("sinEstacion").hidden = true;
  document.getElementById("conEstacion").hidden = false;
  document.getElementById("tituloEstacion").textContent = "Estación " + id;
  document.getElementById("infoEstacion").innerHTML =
    `${Math.abs(est.lat).toFixed(4)}° S, ${Math.abs(est.lon).toFixed(4)}° O` +
    (archivo.fecha ? `<br>Lance: ${fechaChilena(archivo.fecha)}${archivo.hora ? " · " + archivo.hora : ""}` : "");

  actualizarPerfil();
}

async function actualizarPerfil() {
  const mensaje = document.getElementById("mensaje");
  const resumen = document.getElementById("resumen");
  mensaje.textContent = "";
  resumen.textContent = "Cargando datos…";

  const archivo = campana.archivos[estacionActual];
  const estacionPedida = estacionActual;

  let tabla;
  try {
    tabla = await cargarTabla(archivo.ruta);
  } catch (e) {
    resumen.textContent = "";
    mensaje.textContent = e.message;
    return;
  }
  // Si mientras cargaba se eligió otra estación, no dibujar esta
  if (estacionPedida !== estacionActual) return;

  // Menú de variables: solo las de VARIABLES_MOSTRADAS con datos, conservando la elección anterior
  const selVariable = document.getElementById("selVariable");
  const variablePrevia = selVariable.value || VARIABLES_MOSTRADAS[0];
  selVariable.innerHTML = "";
  variablesDisponibles(tabla).forEach(n => selVariable.add(new Option(etiqueta(n), n)));
  if ([...selVariable.options].some(o => o.value === variablePrevia)) selVariable.value = variablePrevia;

  dibujarPerfil(tabla, archivo);
}

// Lee las casillas de profundidad. Devuelve null en el lado que esté vacío.
function leerRango() {
  const leer = id => {
    const texto = document.getElementById(id).value.trim();
    const numero = parseFloat(texto.replace(",", "."));
    return texto === "" || !isFinite(numero) ? null : numero;
  };
  let desde = leer("profDesde"), hasta = leer("profHasta");
  // Si se escribieron al revés (desde 30, hasta 5), se ordenan solos
  if (desde !== null && hasta !== null && desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}

function dibujarPerfil(tabla, archivo) {
  const variable = document.getElementById("selVariable").value;
  const profundidades = tabla.columnas[COLUMNA_PROFUNDIDAD];
  const valores = tabla.columnas[variable];
  const { desde, hasta } = leerRango();
  const hayRango = desde !== null || hasta !== null;

  // Solo los pares con valor y profundidad dentro del rango elegido
  // (los datos no se modifican: solo se elige qué parte se dibuja)
  const x = [], y = [];
  valores.forEach((v, i) => {
    const p = profundidades[i];
    if (v === null || p === null) return;
    if (desde !== null && p < desde) return;
    if (hasta !== null && p > hasta) return;
    x.push(v); y.push(p);
  });

  const textoRango = `${desde !== null ? desde : "superficie"} a ${hasta !== null ? hasta + " m" : "fondo"}`;
  const titulo = `Estación ${estacionActual} · ${campana.nombre}`;
  const nombreArchivo = `perfil_${estacionActual}_${campana.id}_${variable.replace(/[^A-Za-z0-9]+/g, "_")}` +
    (hayRango ? `_${desde !== null ? desde : 0}-${hasta !== null ? hasta : "fondo"}m` : "");

  // Sin título en la página (la estación ya aparece en la columna derecha);
  // el título solo se agrega a la imagen descargada (ver descargarPerfil)
  Plotly.react("grafico", [{
    x, y,
    type: "scatter",
    mode: "lines",
    line: { color: COLOR_PERFIL, width: 1.5 },
    hovertemplate: `${etiqueta(variable)}: %{x:.3f}<br>Profundidad: %{y:.2f} m<extra></extra>`
  }], {
    margin: { l: 72, r: 20, t: 62, b: 24 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    xaxis: {
      title: { text: etiqueta(variable), font: LETRA_EJE },
      tickfont: LETRA_NUMEROS,
      side: "top",                 // la variable arriba, como en los perfiles oceanográficos
      gridcolor: "#e6e3db",
      zeroline: false,
      fixedrange: true             // sin zoom con el mouse
    },
    yaxis: {
      title: { text: etiqueta(COLUMNA_PROFUNDIDAD), font: LETRA_EJE },
      tickfont: LETRA_NUMEROS,
      autorange: "reversed",       // la profundidad aumenta hacia abajo
      gridcolor: "#e6e3db",
      zeroline: false,
      fixedrange: true
    },
    hoverlabel: { font: { family: LETRA_GRAFICO.family, size: 13 } },
    font: LETRA_GRAFICO
  }, {
    responsive: true,
    displayModeBar: false,         // sin barra de herramientas (zoom, casita, etc.)
    locale: "es"
  });
  perfilActual = { titulo, nombreArchivo };

  // Resumen centrado, un dato por línea
  const resumen = document.getElementById("resumen");
  if (x.length === 0) {
    resumen.textContent = "";
    perfilActual = null;
    document.getElementById("mensaje").textContent = hayRango
      ? `No hay datos de esta variable entre ${textoRango}.`
      : "Esta variable no tiene datos en este archivo.";
    return;
  }
  const minimo = x.reduce((a, b) => Math.min(a, b));
  const maximo = x.reduce((a, b) => Math.max(a, b));
  const profMax = y.reduce((a, b) => Math.max(a, b));
  resumen.textContent = [
    `${x.length.toLocaleString("es-CL")} mediciones`,
    hayRango ? `entre ${textoRango}` : null,
    `rango ${minimo.toFixed(3)} a ${maximo.toFixed(3)}`,
    `profundidad máxima ${profMax.toFixed(1)} m`,
    archivo.nota ? `Nota del archivo: ${archivo.nota}` : null
  ].filter(Boolean).join("\n");
}

// ====== DESCARGA DEL PERFIL EN PNG ======
// Se exporta el gráfico tal como se ve, más un título con la estación y la campaña
let perfilActual = null;   // { titulo, nombreArchivo } del perfil dibujado

async function descargarPerfil() {
  const grafico = document.getElementById("grafico");
  if (!perfilActual || !grafico.data) return;   // sin gráfico dibujado
  const ancho = grafico._fullLayout.width, alto = grafico._fullLayout.height;
  const url = await Plotly.toImage({
    data: grafico.data,
    layout: {
      ...grafico.layout,
      title: { text: perfilActual.titulo, font: LETRA_TITULO, y: 0.985, yanchor: "top" },
      margin: { ...grafico.layout.margin, t: 110 }
    }
  }, { format: "png", width: ancho, height: alto + 48, scale: 3 });
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = perfilActual.nombreArchivo + ".png";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
}

// ====== INICIO ======
document.getElementById("selVariable").addEventListener("change", actualizarPerfil);
// El perfil se redibuja mientras escribes (el Excel ya está guardado en memoria, no se descarga de nuevo)
document.getElementById("profDesde").addEventListener("input", actualizarPerfil);
document.getElementById("profHasta").addEventListener("input", actualizarPerfil);
document.getElementById("btnDescargar").addEventListener("click", descargarPerfil);
document.getElementById("btnTodo").addEventListener("click", () => {
  document.getElementById("profDesde").value = "";
  document.getElementById("profHasta").value = "";
  actualizarPerfil();
});

if (typeof L === "undefined" || typeof XLSX === "undefined" || typeof Plotly === "undefined") {
  document.getElementById("sinEstacion").textContent =
    "No se pudieron cargar las librerías. Revisa tu conexión a internet.";
} else {
  fetch(ARCHIVO_INDICE)
    .then(r => {
      if (!r.ok) throw new Error("No se encontró " + ARCHIVO_INDICE);
      return r.json();
    })
    .then(datos => {
      indice = datos;
      campana = indice.campanas.find(c => c.id === CAMPANA_ID);
      if (!campana) throw new Error(`La campaña "${CAMPANA_ID}" no está en el índice`);
      const n = Object.keys(campana.archivos).length;
      document.getElementById("nEstaciones").textContent = `${n} estaciones`;
      mostrarTemporada();
      dibujarEstaciones();
      // Si la página también tiene sección vertical (seccion_campana.js), se inicia aquí
      if (typeof iniciarSeccion === "function") {
        iniciarSeccion().catch(err => {
          document.getElementById("secMensaje").textContent = "No se pudo cargar la sección: " + err.message;
        });
      }
    })
    .catch(e => {
      document.getElementById("sinEstacion").textContent =
        e.message + ". Esta página debe abrirse desde GitHub Pages o un servidor local, no con doble clic.";
    });
}
