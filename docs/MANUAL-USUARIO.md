# Manual de usuario — Gemelo Digital 3D

## Qué es

El **gemelo digital** es una réplica 3D interactiva de tu propiedad generada a
partir de fotos (o un video) con fotogrametría. Podés rotarla, hacer zoom y
descargarla como archivo `.glb`.

> ⚠️ Es un prototipo: la precisión del modelo mejora con más fotos, buen
> solapamiento y buenas condiciones de luz.

## Cómo llegar

- **Opción A — desde una tasación**: al finalizar el formulario de tasación,
  marcá la casilla **"Generar gemelo digital 3D"**. Al terminar te lleva a la
  página de subida de fotos.
- **Opción B — directo**: entrá a `/gemelo-digital`.

## Pasos

1. **Completá el título** de la propiedad (opcional).
2. **Subí fotos**: arrastrá los archivos a la zona punteada o hacé clic para
   elegirlos.
   - Formatos: JPG, PNG, HEIC, WebP… (fotos) y MP4, MOV (video).
   - Mínimo **5 fotos** (o un video) · máximo 100 archivos · 300 MB por archivo.
   - Consejo: recorré cada ambiente y que cada zona aparezca en **al menos 3
     fotos**.
3. Elegí la **calidad de reconstrucción** (Rápida / Equilibrada / Alta) y mirá
   el **tiempo estimado** y la **fidelidad esperada** según la cantidad de fotos.
4. Tocá **"Generar gemelo digital"**. Mientras se procesa vas a ver la barra de
   progreso con los pasos:
   - Subiendo fotos → Extrayendo cuadros (solo video) → Reconstruyendo en 3D →
     Generando modelo .glb.
5. Cuando termina, explorá el modelo en el visor 3D:
   - **Rotar**: arrastrá con el mouse (o el dedo en móvil).
   - **Zoom**: usá la rueda o pellizcá.
   - **Auto-rotar**: botón para activar/desactivar la rotación automática.
   - **Descargar .glb**: botón para guardar el modelo en tu equipo.

## Privacidad y retención

- **Tus fotos no se guardan**: se borran apenas termina el procesamiento.
- **El modelo es temporal**: se elimina automáticamente a la hora (TTL).
- No se almacena nada en la base de datos.

## Mensajes de fidelidad

| Fotos | Qué vas a obtener |
|-------|-------------------|
| 5–15  | Modelo aproximado (geometría parcial) |
| 15–30 | Modelo moderado |
| 30–60 | Buena fidelidad |
| 60+   | Alta fidelidad |

## Problemas comunes

| Problema | Solución |
|----------|----------|
| "No se pudo conectar con el servicio 3D" | El worker está dormido (plan free de Render) o caído. Esperá unos segundos y reintentá. |
| "El servicio no responde" | Reintentá; si persiste, avisale al administrador (ver DESPLIEGUE.md). |
| El modelo se ve como una "maqueta" | El motor fotogramétrico no está disponible: el sistema generó un modelo de demostración. Funciona igual para probar el flujo. |
| "Formato no soportado" | Usá JPG/PNG/HEIC para fotos y MP4/MOV para video. |
| El video no genera cuadros | Asegurate de que tenga contenido visible y de que el worker tenga ffmpeg instalado. |
