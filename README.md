# Monitor de Energía Argentina

Mapa indicativo de dónde se genera la electricidad en Argentina, dónde se consume y cómo fluye entre las 9 regiones del sistema eléctrico nacional (SADI).

Es una página estática: el navegador de quien la visita le pide los datos directamente a la API abierta de CAMMESA (`https://api.cammesa.com/demanda-svc/`) y los actualiza cada 5 minutos. No hay servidor ni paso de compilación.

## Qué muestra

- Mapa de las 9 regiones coloreadas según si exportan o importan energía, la intensidad de carbono estimada, o de dónde viene lo que consume la región elegida.
- Flujos estimados entre regiones (líneas con ancho proporcional a los MW).
- Mix nacional (hidráulica, térmica, nuclear, renovable, importación) y detalle por región.
- Un control para recorrer las horas del día.
- **Para el campo:** pronóstico por región (temperatura, lluvia, viento, humedad, evapotranspiración), mejores horas para riego y bombeo, secado de granos y frío, estado de la red por región (cerca del pico, calor extremo) y huella de carbono por hora con descarga en CSV. Clima de Open-Meteo.com (CC BY 4.0), un punto por región.

## Limitaciones

- Los flujos entre regiones son un **modelo** (aproximación lineal sobre una red reducida de 12 corredores), no mediciones de líneas.
- La importación llega como un solo número, sin país. Unos 700 a 800 MW de generación nacional no figuran en ninguna región; se muestran como "sin ubicar".
- El mix viene en 4 tipos, así que el carbono es aproximado (450 gCO₂/kWh para la térmica).
- No hay precios ni generación por central en la API abierta.
- La API guarda unos 8 meses de historia.

## Archivos

- `index.html`, `estilos.css`, `app.js`: la página. `agro.js`: la sección "Para el campo".
- `datos/regiones.json`: contornos de las regiones (provincias de Natural Earth agrupadas por región de CAMMESA; el Gran Buenos Aires es un área aproximada).
- `herramientas/`: el script que generó los contornos.

Si la página no puede leer la API de CAMMESA, no muestra números: muestra un aviso con el motivo y reintenta cada minuto.

## Probarla en tu computadora

```
python3 -m http.server 8000
```

y abrir http://localhost:8000.

## Versión para Alemania (`de/`)

https://controlvegetal.github.io/monitor-energia/de/ — misma idea, en alemán, con las 4 zonas de los operadores (50Hertz, Amprion, TenneT, TransnetBW), los flujos con los países vecinos y el precio day-ahead. También tiene la sección para el campo ("Für die Landwirtschaft"), donde las mejores horas se eligen por precio day-ahead.

- Datos: SMARD.de (Bundesnetzagentur) y Energy-Charts (Fraunhofer ISE), licencia CC BY 4.0.
- Energy-Charts no deja leer sus datos desde el navegador, así que un job de GitHub Actions (`.github/workflows/datos-alemania.yml`) los baja cada 15 minutos con `de/herramientas/actualizar_datos.py` y los guarda en la rama `datos-de`. La página lee ese archivo.
- SMARD publica los datos por zona con cerca de un día de demora: el mapa muestra el último momento completo; "Deutschland jetzt" y los precios son de hace 1 a 2 horas.

## Emisores de CO₂ (`emisiones/`)

Mapa de las instalaciones de Argentina que más gases de efecto invernadero emiten (centrales, petróleo y gas, industria, minería, residuos), con totales y ranking por provincia y sector, ficha de cada instalación y descarga en CSV.

- Datos: [Climate TRACE](https://climatetrace.org), licencia CC BY 4.0. Son **estimaciones anuales**, no mediciones.
- `emisiones/datos/instalaciones.json` lo arma `emisiones/herramientas/armar_instalaciones.py` desde el paquete descargable de Argentina (emisiones por año) y la API v6 (propietarios). Para actualizarlo: Actions > datos-emisiones > Run workflow, y copiar el archivo de la rama `datos-emisiones` (o del artefacto) al repo con un PR.
- `emisiones/datos/provincias.json`: contornos de Natural Earth (`emisiones/herramientas/generar_provincias.py`).
- Petróleo y gas figuran por cuenca, no por pozo; los feedlots solo suman a los totales (Climate TRACE los estima en grilla).
