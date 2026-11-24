# Monitor de Energía Argentina

Mapa indicativo de dónde se genera la electricidad en Argentina, dónde se consume y cómo fluye entre las 9 regiones del sistema eléctrico nacional (SADI). Inspirado en [GB Power Flow](https://timdaw37.github.io/gb-power-flow/).

Es una página estática: el navegador de quien la visita le pide los datos directamente a la API abierta de CAMMESA (`https://api.cammesa.com/demanda-svc/`) y los actualiza cada 5 minutos. No hay servidor ni paso de compilación.

## Qué muestra

- Mapa de las 9 regiones coloreadas según si exportan o importan energía, la intensidad de carbono estimada, o de dónde viene lo que consume la región elegida.
- Flujos estimados entre regiones (líneas con ancho proporcional a los MW).
- Mix nacional (hidráulica, térmica, nuclear, renovable, importación) y detalle por región.
- Un control para recorrer las horas del día.

## Limitaciones

- Los flujos entre regiones son un **modelo** (flujo DC sobre una red reducida de 12 corredores), no mediciones de líneas.
- La importación llega como un solo número, sin país. Unos 700 a 800 MW de generación nacional no figuran en ninguna región; se muestran como "sin ubicar".
- El mix viene en 4 tipos, así que el carbono es aproximado (450 gCO₂/kWh para la térmica).
- No hay precios ni generación por central en la API abierta.
- La API guarda unos 8 meses de historia.

## Archivos

- `index.html`, `estilos.css`, `app.js`: la página.
- `datos/regiones.json`: contornos de las regiones (provincias de Natural Earth agrupadas por región de CAMMESA; el Gran Buenos Aires es un área aproximada).
- `datos/ejemplo.json`: datos **ilustrativos** que se muestran, con un aviso, solo si la API no responde. También se ven con `?ejemplo` al final de la dirección.
- `herramientas/`: scripts que generaron esos dos archivos.

## Probarla en tu computadora

```
python3 -m http.server 8000
```

y abrir http://localhost:8000.
