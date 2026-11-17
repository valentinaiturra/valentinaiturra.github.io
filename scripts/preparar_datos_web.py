"""
Prepara los datos CTD del Fondecyt 1262020 para el visor web (visor_ctd.html).

Qué hace:
  1. Copia (sin modificar) los Excel CTD_PUYUHUAPI_E##_*.xlsx de todas las campañas (1, 2, 3, ...)
     a la carpeta datos/ctd/<campaña>/ del repositorio web.
  2. Copia estaciones_fondecyt_2022.csv a datos/.
  3. Genera datos/indice.json: qué archivo corresponde a cada estación y campaña.
     (El navegador no puede listar carpetas, por eso necesita este índice.)

Los archivos originales nunca se modifican: solo se leen y se copian.

Uso (desde la raíz del repositorio web, con el Python de Anaconda):
    python scripts/preparar_datos_web.py "E:/Fondecyt 1262020"
"""

import json
import re
import shutil
import sys
from pathlib import Path

# Carpeta raíz del repositorio web (la carpeta que contiene a scripts/)
REPO = Path(__file__).resolve().parent.parent
DESTINO_DATOS = REPO / "datos"

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

# CTD_PUYUHUAPI_E02_09.11.2025_09.53.xlsx  → estación 2, fecha 09.11.2025, hora 09.53
# CTD_PUYUHUAPI_E01_09.11.2025_SOLO_TEMP.xlsx → estación 1, fecha 09.11.2025, sin hora
# CTD_PUYUHUAPI_E08_M07_30.01.2026_15.07.xlsx → estación 8 (el código extra M07, P01, etc. se ignora)
PATRON_ARCHIVO = re.compile(
    r"^CTD_PUYUHUAPI_E(?P<est>\d{2})(?:_[A-Z]\d+)?_(?P<dia>\d{2})\.(?P<mes>\d{2})\.(?P<anio>\d{4})_(?P<resto>.+)\.xlsx$"
)
PATRON_HORA = re.compile(r"^(?P<h>\d{2})\.(?P<m>\d{2})$")

# Correcciones de nombre: carpeta (en minúscula) → id con el mes real de los lances.
# La carpeta original en E: no se renombra; solo cambia cómo aparece en la web.
# Ejemplo: "9_febrero_2026": "9_enero_2026"   (si se quisiera nombrar por el mes real de los lances)
CORRECCIONES = {}


def leer_estaciones(ruta_csv):
    """Lee el CSV de estaciones (separado por ';': stn;lat;long)."""
    lineas = ruta_csv.read_text(encoding="utf-8").strip().splitlines()
    estaciones = []
    for linea in lineas[1:]:
        stn, lat, lon = linea.split(";")
        estaciones.append({"id": f"E{int(stn):02d}", "lat": float(lat), "lon": float(lon)})
    return estaciones


def main(origen):
    campanas = []
    # Campañas 1, 2, 3, ... (se omite 0_ESTACION_FIJA). El id se guarda en minúscula
    # para que todas las campañas tengan el mismo formato (ej. 9_Febrero_2026 → 9_febrero_2026)
    for carpeta in sorted(origen.glob("[1-9]*_*")):
        if not carpeta.is_dir() or not carpeta.name.split("_")[0].isdigit():
            continue
        id_campana = CORRECCIONES.get(carpeta.name.lower(), carpeta.name.lower())
        numero, mes_txt, anio = id_campana.split("_")
        campana = {
            "id": id_campana,
            "nombre": f"{mes_txt.capitalize()} {anio}",
            "orden": int(numero),
            "archivos": {},
        }

        destino_campana = DESTINO_DATOS / "ctd" / id_campana
        destino_campana.mkdir(parents=True, exist_ok=True)

        # rglob porque en septiembre 2023 los archivos están en una subcarpeta Data/
        for archivo in sorted(carpeta.rglob("CTD_PUYUHUAPI_E*.xlsx")):
            coincidencia = PATRON_ARCHIVO.match(archivo.name)
            if not coincidencia:
                print(f"  Omitido (nombre no reconocido): {archivo.name}")
                continue

            hora = PATRON_HORA.match(coincidencia["resto"])
            id_estacion = f"E{coincidencia['est']}"
            shutil.copy2(archivo, destino_campana / archivo.name)  # copia exacta del original

            campana["archivos"][id_estacion] = {
                "ruta": f"datos/ctd/{id_campana}/{archivo.name}",
                "fecha": f"{coincidencia['anio']}-{coincidencia['mes']}-{coincidencia['dia']}",
                "hora": f"{hora['h']}:{hora['m']}" if hora else None,
                "nota": None if hora else coincidencia["resto"].replace("_", " ").lower(),
            }

        print(f"{id_campana}: {len(campana['archivos'])} archivos copiados")
        campanas.append(campana)

    shutil.copy2(origen / "estaciones_fondecyt_2022.csv", DESTINO_DATOS / "estaciones_fondecyt_2022.csv")

    indice = {
        "estaciones": leer_estaciones(origen / "estaciones_fondecyt_2022.csv"),
        "campanas": sorted(campanas, key=lambda c: c["orden"]),
    }
    ruta_indice = DESTINO_DATOS / "indice.json"
    ruta_indice.write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Índice guardado en {ruta_indice.relative_to(REPO)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit('Uso: python scripts/preparar_datos_web.py "<carpeta Fondecyt>"')
    main(Path(sys.argv[1]))
