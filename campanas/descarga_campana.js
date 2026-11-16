// ====== DESCARGA DE DATOS DE UNA CAMPAÑA ======
// Programa compartido por las páginas de campanas/. Se carga DESPUÉS de visor_campana.js
// y usa lo que ese archivo ya define: indice, campana, cargarTabla, etiqueta, fechaChilena,
// COLUMNA_PROFUNDIDAD y VARIABLES_MOSTRADAS.
// Arma un Excel nuevo en el navegador con las estaciones y variables elegidas.
// Los archivos originales no se modifican.

// Abre la ventana y arma las casillas (lo llama visor_campana.js cuando ya cargó el índice)
function iniciarDescarga() {
  const ventana = document.getElementById("ventanaDescarga");
  const cajaEstaciones = document.getElementById("dlEstaciones");
  const cajaVariables = document.getElementById("dlVariables");

  // Una casilla por estación con datos en esta campaña (todas marcadas al inicio)
  Object.keys(campana.archivos).sort().forEach(id => {
    cajaEstaciones.insertAdjacentHTML("beforeend",
      `<label class="opcion"><input type="checkbox" name="estacion" value="${id}" checked> ${id}</label>`);
  });
  // Una casilla por variable de la lista del visor
  VARIABLES_MOSTRADAS.forEach(n => {
    cajaVariables.insertAdjacentHTML("beforeend",
      `<label class="opcion"><input type="checkbox" name="variable" value="${n}" checked> ${etiqueta(n)}</label>`);
  });

  const marcar = (nombre, valor) => {
    ventana.querySelectorAll(`input[name="${nombre}"]`).forEach(c => { c.checked = valor; });
    actualizarBotonDescarga();
  };
  document.getElementById("dlTodas").addEventListener("click", () => marcar("estacion", true));
  document.getElementById("dlNinguna").addEventListener("click", () => marcar("estacion", false));
  ventana.addEventListener("change", actualizarBotonDescarga);

  document.getElementById("btnDatos").addEventListener("click", () => {
    document.getElementById("dlEstado").textContent = "";
    ventana.showModal();
  });
  document.getElementById("dlCancelar").addEventListener("click", () => ventana.close());
  // Clic fuera de la ventana (sobre el fondo oscuro): cerrar
  ventana.addEventListener("click", e => { if (e.target === ventana) ventana.close(); });
  document.getElementById("dlDescargar").addEventListener("click", generarExcel);

  document.getElementById("btnDatos").disabled = false;
  actualizarBotonDescarga();
}

const marcadas = nombre =>
  [...document.querySelectorAll(`#ventanaDescarga input[name="${nombre}"]:checked`)].map(c => c.value);

// El botón Descargar solo se activa con al menos una estación y una variable
function actualizarBotonDescarga() {
  document.getElementById("dlDescargar").disabled =
    marcadas("estacion").length === 0 || marcadas("variable").length === 0;
}

async function generarExcel() {
  const estaciones = marcadas("estacion");
  const variables = marcadas("variable");
  const estado = document.getElementById("dlEstado");
  const boton = document.getElementById("dlDescargar");
  boton.disabled = true;

  const colProf = etiqueta(COLUMNA_PROFUNDIDAD);
  const encabezados = ["Estación", "Fecha", "Hora", colProf, ...variables.map(etiqueta)];
  const filas = [];
  const resumenEstaciones = [];

  try {
    for (let i = 0; i < estaciones.length; i++) {
      const id = estaciones[i];
      estado.textContent = `Preparando… estación ${id} (${i + 1} de ${estaciones.length})`;
      const archivo = campana.archivos[id];
      const tabla = await cargarTabla(archivo.ruta);   // usa los Excel ya leídos si están en memoria
      const prof = tabla.columnas[COLUMNA_PROFUNDIDAD];
      const fecha = fechaChilena(archivo.fecha);
      let n = 0;
      prof.forEach((d, k) => {
        if (d === null) return;
        const fila = { "Estación": id, "Fecha": fecha, "Hora": archivo.hora || "", [colProf]: d };
        variables.forEach(v => {
          const valor = tabla.columnas[v] ? tabla.columnas[v][k] : null;
          fila[etiqueta(v)] = valor === null ? "" : valor;
        });
        filas.push(fila);
        n++;
      });
      const est = indice.estaciones.find(e => e.id === id);
      resumenEstaciones.push({
        "Estación": id, "Latitud": est.lat, "Longitud": est.lon,
        "Fecha": fecha, "Hora": archivo.hora || "", "Mediciones": n
      });
    }

    estado.textContent = "Armando el archivo Excel…";
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas, { header: encabezados }), "datos");
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(resumenEstaciones), "estaciones");
    XLSX.writeFile(libro, `CTD_Puyuhuapi_${campana.id}.xlsx`);

    estado.textContent = `Listo: ${filas.length.toLocaleString("es-CL")} filas de ${estaciones.length} estaciones.`;
  } catch (e) {
    estado.textContent = "No se pudo preparar el archivo: " + e.message;
  }
  actualizarBotonDescarga();
}
