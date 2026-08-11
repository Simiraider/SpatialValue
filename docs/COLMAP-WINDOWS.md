# COLMAP en Windows (WSL2) — reconstrucción real del gemelo digital

El modo simulación genera una maqueta de demostración. Para que el gemelo
digital reconstruya la **geometría real de la propiedad** a partir de las fotos
se necesita **COLMAP**. La forma más simple en Windows es instalarlo dentro de
**WSL2 (Ubuntu)** y correr ahí el worker 3D. Es **gratis**.

> ⚠️ Requisito: Windows 10/11 con WSL2 habilitado y ~10 GB libres. Los tiempos
> de reconstrucción en CPU son reales: 22 fotos ≈ 10 min.

---

## Paso 1 — Instalar WSL2 (una sola vez)

Abrí **PowerShell como administrador** y corré:

```powershell
wsl --install
```

Reiniciá la PC cuando termine. Luego abrí el menú Inicio y ejecutá **Ubuntu**
(la primera vez te pide crear usuario y contraseña).

## Paso 2 — Instalar ffmpeg y Node.js en Ubuntu

Dentro de la terminal de Ubuntu:

```bash
# Actualizar e instalar ffmpeg
sudo apt update && sudo apt install -y ffmpeg

# Node.js 22 (para correr el worker)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # debe decir v22.x
```

## Paso 3 — Instalar COLMAP (conda-forge)

```bash
# Miniconda (si no lo tenés)
curl -L https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o miniconda.sh
bash miniconda.sh -b
~/miniconda3/bin/conda init bash
# Cerrá y volvé a abrir la terminal de Ubuntu

# COLMAP desde conda-forge
conda install -c conda-forge colmap -y

# Verificar
colmap help   # COLMAP 3.12 usa `help`, no `--version` (debe listar comandos)
```

Si conda-forge da problemas, alternativa con apt (Ubuntu 24.04+):

```bash
sudo apt install -y colmap
```

> ⚠️ **Bug conocido en Ubuntu 26.04**: el paquete `colmap` queda incompleto y
> falla con `error while loading shared libraries: libPoseLib.so`. La solución
> es instalar la librería que falta:
>
> ```bash
> sudo apt install -y libposelib
> colmap help   # debe listar los comandos, sin errores (3.12 no acepta `--version`)
> ```

O build desde fuente (https://colmap.github.io/install.html).

## Paso 4 — Correr el worker con COLMAP

```bash
# Copiá el proyecto dentro de Ubuntu (más rápido que usar /mnt/c):
cp -r /mnt/c/Users/simon/Documents/SpatialValue ~/SpatialValue
cd ~/SpatialValue/server

npm install

# Activá el modo COLMAP (edita server/.env):
#   GEMELO_MODO=auto
# y arrancá:
npm start
```

El worker queda escuchando en **http://localhost:4000** — WSL2 redirige
`localhost` automáticamente, así que el navegador de Windows lo ve igual.

## Paso 5 — Usar el frontend

El `.env.local` de la raíz ya apunta a `http://localhost:4000`, así que no
cambia nada:

```powershell
# En Windows, terminal del proyecto:
npm run dev     # o npx astro dev
```

Entrá a `/gemelo-digital`, subí las fotos y ahora sí: el modelo será la
**reconstrucción real** de la propiedad (la etiqueta dirá "modelo" y no
"modelo de demostración").

---

## Verificación rápida

- `curl http://localhost:4000/api/healthz` debe responder
  `"colmapInstalado": true`.
- Consejo de fotos: cada zona debe aparecer en **≥3 fotos**, con buen
  solapamiento y luz pareja. 22 fotos ≈ calidad **moderada**; 60+ ≈ buena.
- Si COLMAP termina sin malla y el resultado cae a la maqueta de demostración
  (síntoma: "COLMAP no encontró suficientes coincidencias"), la solución más
  simple es **grabar un video recorriendo cada ambiente** y subirlo: el worker
  extrae **1 cuadro cada 3 segundos** (espaciado que evita los fotogramas casi
  duplicados de un recorrido lento, que degeneran la geometría) y los cuadros
  consecutivos se solapan entre sí garantizado.
- Para videos: mové la cámara **despacio y parejo**, sin detenerte ni hacer
  zoom; los fotogramas borrosos no aportan y COLMAP los ignora.

## Alternativa: VPS con Docker (U$S ~4/mes)

Si preferís no usar WSL2, cualquier VPS con Ubuntu:

```bash
git clone <repo> && cd SpatialValue/server
docker build -t spatial-value-gemelo .
docker run -d --name gemelo -p 4000:4000 \
  -e GEMELO_MODO=auto -e CORS_ORIGIN=https://tu-frontend.vercel.app \
  spatial-value-gemelo
```

Y en Vercel: `PUBLIC_GEMELO_WORKER_URL=https://ip-del-vps:4000`.

## Volver al modo simulación

Solo cambiá `server/.env` a `GEMELO_MODO=simular` y reiniciá el worker.
