// ====== SECCIÓN VERTICAL DE UNA CAMPAÑA ======
// Programa compartido por las páginas de campanas/. Se carga DESPUÉS de visor_campana.js
// y usa lo que ese archivo ya define: indice, campana, cargarTabla (con su memoria de Excel ya leídos),
// etiqueta, COLUMNA_PROFUNDIDAD y COLUMNAS_EXCLUIDAS.
// Es la misma sección de transecto_ctd.html, con la campaña fija y recorte por profundidad.

// ====== AJUSTES (puedes cambiarlos) ======
// Estaciones del transecto, en orden desde la boca (E01) hacia la cabeza del fiordo
// (sin E09/E10 del seno Magdalena ni E13/E14 del canal Jacaf)
const ESTACIONES_TRANSECTO = ["E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08",
                              "E11", "E12", "E15", "E16", "E17"];
const PASO_VERTICAL_M = 1;          // tamaño del promedio vertical (bin) en metros
const COLUMNAS_HORIZONTALES = 300;  // resolución horizontal de la grilla interpolada
const COLOR_FONDO = "#bdbab3";      // zona bajo la profundidad máxima medida

// Paletas cmocean (aproximadas con 8 colores), aptas para daltonismo
const CMOCEAN = {
  thermal: ["#042333", "#2c3172", "#5b3f95", "#89508f", "#b8617d", "#e2765f", "#f8a043", "#e8fa5b"],
  haline:  ["#2a186c", "#16409b", "#11668d", "#2f8a87", "#4dad7b", "#82cb63", "#c6e46a", "#fdef9a"],
  dense:   ["#e6f1f1", "#b3d0e2", "#8daede", "#7d86d9", "#7a5fc0", "#723c96", "#5d2167", "#360e24"],
  algae:   ["#d7f9d0", "#a5d9a0", "#6fbd72", "#3ea04c", "#20803a", "#13613a", "#11402c", "#122414"],
  oxy:     ["#400505", "#850a0b", "#6e6e6d", "#8f8f8e", "#b2b1b0", "#d6d5d4", "#ebf34b", "#ddaf19"],
  speed:   ["#fffdcd", "#e1cd73", "#aaac20", "#5f920c", "#187a2f", "#0f5d3e", "#1a3d30", "#172313"]
};
const PALETA_POR_VARIABLE = {
  "Temperature": "thermal",
  "Temperature (2)": "thermal",
  "Salinity": "haline",
  "Conductivity": "haline",
  "Specific conductivity": "haline",
  "Density anomaly": "dense",
  "Chlorophyll a": "algae",
  "Dissolved O₂ concentration": "oxy",
  "Dissolved O₂ saturation": "oxy",
  "Speed of sound": "speed"
};
function escalaColor(variable) {
  const colores = CMOCEAN[PALETA_POR_VARIABLE[variable]];
  if (!colores) return "Viridis";
  return colores.map((c, i) => [i / (colores.length - 1), c]);
}

// Sección ya calculada (se reutiliza al cambiar la profundidad, sin recalcular)
let seccion = null;   // { variable, grilla, estaciones, sinDatos, distancias }

// ====== DISTANCIA ======
// Distancia en km entre dos puntos sobre la Tierra (fórmula del haversine)
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = g => g * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Distancia acumulada desde E01, siguiendo el orden del transecto
function distanciasAcumuladas() {
  const coords = ESTACIONES_TRANSECTO.map(id => indice.estaciones.find(e => e.id === id));
  const distancias = [0];
  for (let i = 1; i < coords.length; i++) {
    distancias.push(distancias[i - 1] +
      distanciaKm(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon));
  }
  return distancias;
}

// ====== PROCESAMIENTO PARA LA SECCIÓN (igual que transecto_ctd.html) ======
// Promedia el perfil cada PASO_VERTICAL_M metros. El índice k corresponde a la profundidad k·PASO_VERTICAL_M;
// los huecos internos se rellenan por interpolación lineal.
function promediarPerfil(profundidades, valores) {
  const suma = [], cuenta = [];
  profundidades.forEach((d, i) => {
    const v = valores[i];
    if (d === null || v === null || d < 0) return;
    const k = Math.round(d / PASO_VERTICAL_M);
    suma[k] = (suma[k] || 0) + v;
    cuenta[k] = (cuenta[k] || 0) + 1;
  });

  const perfil = [];
  for (let k = 0; k < suma.length; k++) perfil[k] = cuenta[k] ? suma[k] / cuenta[k] : null;

  const conDatos = perfil.map((v, k) => v !== null ? k : -1).filter(k => k >= 0);
  if (conDatos.length === 0) return null;

  // Sobre el primer dato (cerca de la superficie) se repite el primer valor medido
  for (let k = 0; k < conDatos[0]; k++) perfil[k] = perfil[conDatos[0]];
  // Huecos entre datos: interpolación lineal
  for (let j = 1; j < conDatos.length; j++) {
    const k0 = conDatos[j - 1], k1 = conDatos[j];
    for (let k = k0 + 1; k < k1; k++) {
      perfil[k] = perfil[k0] + (perfil[k1] - perfil[k0]) * (k - k0) / (k1 - k0);
    }
  }
  return perfil;
}

// Valor del perfil en el nivel k; bajo el último dato se repite el valor más profundo
// (solo para interpolar: esa zona luego queda tapada por el fondo gris)
const valorEn = (perfil, k) => perfil[Math.min(k, perfil.length - 1)];

// Grilla (distancia × profundidad) interpolando linealmente entre estaciones vecinas
function construirGrilla(estaciones) {
  // La grilla va de la primera a la última estación CON datos (nunca se extrapola)
  const distMin = estaciones[0].dist;
  const distMax = estaciones[estaciones.length - 1].dist;
  const nivelMax = Math.max(...estaciones.map(e => e.perfil.length - 1));

  // Columnas regulares más la posición exacta de cada estación
  const xs = [];
  for (let i = 0; i <= COLUMNAS_HORIZONTALES; i++) xs.push(distMin + (distMax - distMin) * i / COLUMNAS_HORIZONTALES);
  estaciones.forEach(e => xs.push(e.dist));
  xs.sort((a, b) => a - b);
  const x = xs.filter((v, i) => i === 0 || v - xs[i - 1] > 1e-9);

  const y = [];
  for (let k = 0; k <= nivelMax; k++) y.push(k * PASO_VERTICAL_M);

  const z = y.map(() => new Array(x.length).fill(null));
  const fondo = [];

  let s = 0;   // índice de la estación a la izquierda
  x.forEach((xi, j) => {
    while (s < estaciones.length - 2 && xi > estaciones[s + 1].dist) s++;
    const a = estaciones[s], b = estaciones[s + 1];
    const t = (xi - a.dist) / (b.dist - a.dist);

    // El "fondo" (profundidad máxima medida) también se interpola entre estaciones
    const nivelFondo = Math.round((a.perfil.length - 1) + t * ((b.perfil.length - 1) - (a.perfil.length - 1)));
    fondo.push(nivelFondo * PASO_VERTICAL_M);

    for (let k = 0; k <= nivelFondo; k++) {
      z[k][j] = valorEn(a.perfil, k) + t * (valorEn(b.perfil, k) - valorEn(a.perfil, k));
    }
  });

  return { x, y, z, fondo, profMax: nivelMax * PASO_VERTICAL_M };
}

// ====== CÁLCULO (cuando cambia la variable) ======
async function calcularSeccion() {
  const estado = document.getElementById("secEstado");
  const mensaje = document.getElementById("secMensaje");
  mensaje.textContent = "";
  document.getElementById("secResumen").textContent = "";

  const variable = document.getElementById("secVariable").value;
  const distancias = distanciasAcumuladas();

  // Carga de los Excel del transecto (los ya leídos por el perfil no se descargan de nuevo)
  const tablas = [];
  for (let i = 0; i < ESTACIONES_TRANSECTO.length; i++) {
    const id = ESTACIONES_TRANSECTO[i];
    estado.textContent = `Cargando datos… estación ${id} (${i + 1} de ${ESTACIONES_TRANSECTO.length})`;
    const archivo = campana.archivos[id];
    try {
      tablas.push(archivo ? await cargarTabla(archivo.ruta) : null);
    } catch (e) {
      tablas.push(null);
    }
  }
  estado.textContent = "";

  // Si la variable cambió mientras cargaba, no dibujar una sección vieja
  if (variable !== document.getElementById("secVariable").value) return;

  // Perfil promediado de cada estación con datos de esta variable
  const estaciones = [], sinDatos = [];
  ESTACIONES_TRANSECTO.forEach((id, i) => {
    const tabla = tablas[i];
    const perfil = tabla && tabla.columnas[variable]
      ? promediarPerfil(tabla.columnas[COLUMNA_PROFUNDIDAD], tabla.columnas[variable])
      : null;
    if (perfil) estaciones.push({ id, dist: distancias[i], perfil });
    else sinDatos.push(id);
  });

  if (estaciones.length < 2) {
    seccion = null;
    Plotly.purge("secGrafico");
    mensaje.textContent = "No hay suficientes estaciones con datos de esta variable para dibujar la sección.";
    return;
  }

  seccion = { variable, grilla: construirGrilla(estaciones), estaciones, sinDatos, distancias };
  dibujarSeccion();
}

// Lee las casillas de profundidad de la sección. Devuelve null en el lado que esté vacío.
function leerRangoSeccion() {
  const leer = id => {
    const texto = document.getElementById(id).value.trim();
    const numero = parseFloat(texto.replace(",", "."));
    return texto === "" || !isFinite(numero) ? null : numero;
  };
  let desde = leer("secDesde"), hasta = leer("secHasta");
  if (desde !== null && hasta !== null && desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}

// ====== DIBUJO (cuando cambia la variable o la profundidad) ======
function dibujarSeccion() {
  if (!seccion) return;
  const { variable, grilla, estaciones, sinDatos, distancias } = seccion;
  const mensaje = document.getElementById("secMensaje");
  mensaje.textContent = "";

  // Recorte por profundidad: solo las filas de la grilla dentro del rango,
  // así los colores y las isolíneas se ajustan al tramo que se ve
  const { desde, hasta } = leerRangoSeccion();
  const hayRango = desde !== null || hasta !== null;
  const yMin = desde !== null ? Math.max(0, desde) : 0;
  const yMax = hasta !== null ? Math.min(hasta, grilla.profMax) : grilla.profMax;
  const filas = [];
  grilla.y.forEach((yk, k) => { if (yk >= yMin && yk <= yMax) filas.push(k); });

  if (filas.length < 2 || !filas.some(k => grilla.z[k].some(v => v !== null))) {
    Plotly.purge("secGrafico");
    document.getElementById("secResumen").textContent = "";
    mensaje.textContent = "No hay datos en ese rango de profundidad.";
    return;
  }
  const yRec = filas.map(k => grilla.y[k]);
  const zRec = filas.map(k => grilla.z[k]);

  // Límites del eje vertical (la profundidad aumenta hacia abajo)
  const ejeArriba = yMin;
  const ejeAbajo = hayRango && hasta !== null && hasta < grilla.profMax ? yMax : grilla.profMax + 5;

  const nombreVar = etiqueta(variable);
  const trazos = [
    // Sección coloreada con líneas de contorno
    {
      type: "contour",
      x: grilla.x, y: yRec, z: zRec,
      colorscale: escalaColor(variable),
      ncontours: 20,
      contours: {
        coloring: "heatmap", showlabels: true,
        labelfont: { family: LETRA_GRAFICO.family, size: 11, color: "#ffffff" }
      },
      line: { width: 0.5, color: "rgba(0,0,0,0.35)" },
      connectgaps: false,
      colorbar: {
        title: { text: nombreVar, side: "right", font: LETRA_EJE },
        tickfont: LETRA_NUMEROS,
        thickness: 16, outlinewidth: 0
      },
      hovertemplate: `Distancia: %{x:.1f} km<br>Profundidad: %{y:.0f} m<br>${nombreVar}: %{z:.3f}<extra></extra>`
    },
    // Zona bajo la profundidad máxima medida
    {
      type: "scatter",
      x: [...grilla.x, grilla.x[grilla.x.length - 1], grilla.x[0]],
      y: [...grilla.fondo, grilla.profMax + 5, grilla.profMax + 5],
      fill: "toself",
      fillcolor: COLOR_FONDO,
      line: { color: "#7d7a73", width: 1 },
      hoverinfo: "skip",
      showlegend: false
    },
    // Línea punteada de cada estación (desde la superficie hasta su último dato)
    ...estaciones.map(e => ({
      type: "scatter",
      mode: "lines",
      x: [e.dist, e.dist],
      y: [0, (e.perfil.length - 1) * PASO_VERTICAL_M],
      line: { color: "rgba(0,0,0,0.55)", width: 1, dash: "dot" },
      hovertemplate: `${e.id} · ${e.dist.toFixed(1)} km · ${((e.perfil.length - 1) * PASO_VERTICAL_M).toFixed(0)} m<extra></extra>`,
      showlegend: false
    }))
  ];

  // Nombre de cada estación sobre la sección
  const nombresEstaciones = estaciones.map(e => ({
    x: e.dist, y: 1, xref: "x", yref: "paper", yanchor: "bottom",
    text: e.id, showarrow: false, textangle: -90,
    font: { family: LETRA_GRAFICO.family, size: 12, color: "#0e3b52" }
  }));

  const sufijo = hayRango ? `_${desde !== null ? desde : 0}-${hasta !== null ? hasta : "fondo"}m` : "";

  Plotly.react("secGrafico", trazos, {
    title: {
      text: `${nombreVar} · ${campana.nombre}`,
      font: LETRA_TITULO,
      y: 0.98, yanchor: "top"
    },
    margin: { l: 72, r: 20, t: 95, b: 62 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    xaxis: {
      title: { text: "Distancia desde E01 [km]", font: LETRA_EJE },
      tickfont: LETRA_NUMEROS,
      range: [0, distancias[distancias.length - 1]],   // siempre E01 a E17
      zeroline: false, showgrid: false, ticks: "outside", ticklen: 4
    },
    yaxis: {
      title: { text: "Profundidad [m]", font: LETRA_EJE },
      tickfont: LETRA_NUMEROS,
      range: [ejeAbajo, ejeArriba],   // invertido: la profundidad aumenta hacia abajo
      zeroline: false, showgrid: false, ticks: "outside", ticklen: 4
    },
    annotations: nombresEstaciones,
    hoverlabel: { font: { family: LETRA_GRAFICO.family, size: 13 } },
    font: LETRA_GRAFICO
  }, {
    responsive: true,
    displaylogo: false,
    locale: "es",
    toImageButtonOptions: {
      format: "png",
      filename: `seccion_${campana.id}_${variable.replace(/[^A-Za-z0-9]+/g, "_")}${sufijo}`,
      scale: 3
    }
  });

  const textoRango = hayRango
    ? ` · entre ${desde !== null ? desde : "superficie"} y ${hasta !== null ? hasta + " m" : "fondo"}` : "";
  document.getElementById("secResumen").textContent =
    `${estaciones.length} estaciones · ${(grilla.x[grilla.x.length - 1] - grilla.x[0]).toFixed(1)} km de transecto · ` +
    `profundidad máxima ${grilla.profMax.toFixed(0)} m${textoRango}` +
    (sinDatos.length ? ` · Sin datos de esta variable: ${sinDatos.join(", ")}` : "");
}

// ====== INICIO (lo llama visor_campana.js cuando ya cargó el índice) ======
async function iniciarSeccion() {
  // Variables del menú: las de VARIABLES_MOSTRADAS (definidas en visor_campana.js), en el mismo orden,
  // revisadas en un Excel del transecto (todos tienen las mismas columnas)
  const primera = ESTACIONES_TRANSECTO.find(id => campana.archivos[id]);
  const tabla = await cargarTabla(campana.archivos[primera].ruta);
  const selVariable = document.getElementById("secVariable");
  variablesDisponibles(tabla).forEach(n => selVariable.add(new Option(etiqueta(n), n)));
  selVariable.value = VARIABLES_MOSTRADAS[0];

  selVariable.addEventListener("change", calcularSeccion);
  document.getElementById("secDesde").addEventListener("input", dibujarSeccion);
  document.getElementById("secHasta").addEventListener("input", dibujarSeccion);
  document.getElementById("secTodo").addEventListener("click", () => {
    document.getElementById("secDesde").value = "";
    document.getElementById("secHasta").value = "";
    dibujarSeccion();
  });

  calcularSeccion();
}
