/**
 * Escritor de archivos glTF Binary (.glb) sin dependencias.
 * Genera un GLB minimalista y válido con malla triangular:
 * POSITION + NORMAL + COLOR_0 (opcional) + índices.
 *
 * Es la base del simulador y del convertidor OBJ→GLB del worker.
 */

// ComponentType glTF
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

// Tipos de chunk GLB
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942;  // "BIN\0"

const alinear4 = (n) => Math.ceil(n / 4) * 4;

/**
 * @param {object} mesh
 * @param {number[]} mesh.positions  [x,y,z,...] triplas
 * @param {number[]} mesh.normals    [nx,ny,nz,...]
 * @param {number[]} [mesh.colors]   [r,g,b,...] 0..1 (opcional)
 * @param {number[]} mesh.indices    triplas de índices de vértices
 * @param {string} [nombre]
 * @returns {Buffer} contenido del .glb
 */
export function escribirGLB(mesh, nombre = 'modelo') {
  const { positions, normals, colors, indices } = mesh;
  if (!positions.length || positions.length % 3 !== 0) {
    throw new Error('Positions inválidas: deben ser triplas de floats');
  }
  if (!normals.length || normals.length !== positions.length) {
    throw new Error('Normals inválidas: deben tener la misma cantidad que positions');
  }
  if (indices.length % 3 !== 0) {
    throw new Error('Indices inválidos: deben ser triplas');
  }

  const nVertices = positions.length / 3;
  const usarUint32 = nVertices > 65535;

  // ── BufferViews ────────────────────────────────────────────────────────────
  // OJO: los offsets deben acumularse con byteLength (NO con length, que para
  // un TypedArray es la cantidad de elementos). Este bug dejaba corruptos los
  // bufferViews de NORMAL/COLOR/índices (offset en elementos en vez de bytes).
  const parts = [];
  const push = (data) => {
    const offset = parts.reduce((acc, p) => acc + p.byteLength, 0);
    parts.push(data);
    return offset;
  };

  const posOffset = push(Float32Array.from(positions));
  const normOffset = push(Float32Array.from(normals));
  let colOffset = null;
  if (colors && colors.length) {
    if (colors.length !== positions.length) {
      throw new Error('Colors inválidas: deben tener la misma cantidad que positions');
    }
    colOffset = push(Float32Array.from(colors));
  }
  const idxData = usarUint32 ? Uint32Array.from(indices) : Uint16Array.from(indices);
  const idxOffset = push(idxData);

  // Los offsets deben quedar alineados a 4 bytes; los Float32/Uint32 ya lo están.
  const binByteLength = parts.reduce((acc, p) => acc + p.byteLength, 0);

  const view = (offset, length, target) => ({
    buffer: 0,
    byteOffset: offset,
    byteLength: length,
    target,
  });
  const ARRAY_BUFFER = 34962;
  const ELEMENT_ARRAY_BUFFER = 34963;

  // Bounds del POSITION (requeridos por la spec glTF). Se calculan con un solo
  // barrido: los spread de Math.min(...) revientan la pila con mallas grandes
  // (las de COLMAP superan fácilmente 100k vértices).
  const minimo = [Infinity, Infinity, Infinity];
  const maximo = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let eje = 0; eje < 3; eje++) {
      const v = positions[i + eje];
      if (v < minimo[eje]) minimo[eje] = v;
      if (v > maximo[eje]) maximo[eje] = v;
    }
  }

  const bufferViews = [
    view(posOffset, positions.length * 4, ARRAY_BUFFER),
    view(normOffset, normals.length * 4, ARRAY_BUFFER),
  ];
  const accessors = [
    {
      bufferView: 0,
      componentType: FLOAT,
      count: nVertices,
      type: 'VEC3',
      min: minimo,
      max: maximo,
    },
    {
      bufferView: 1,
      componentType: FLOAT,
      count: nVertices,
      type: 'VEC3',
    },
  ];

  let colorAccessor = null;
  if (colOffset !== null) {
    bufferViews.push(view(colOffset, colors.length * 4, ARRAY_BUFFER));
    accessors.push({
      bufferView: 2,
      componentType: FLOAT,
      count: nVertices,
      type: 'VEC3',
    });
    colorAccessor = 2;
  }

  bufferViews.push(view(idxOffset, idxData.byteLength, ELEMENT_ARRAY_BUFFER));
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType: usarUint32 ? UNSIGNED_INT : UNSIGNED_SHORT,
    count: indices.length,
    type: 'SCALAR',
  });

  const attributes = { POSITION: 0, NORMAL: 1 };
  if (colorAccessor !== null) attributes.COLOR_0 = colorAccessor;

  const gltf = {
    asset: { version: '2.0', generator: 'spatial-value-gemelo-worker' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nombre }],
    meshes: [
      {
        name: nombre,
        primitives: [
          { attributes, indices: accessors.length - 1, material: 0, mode: 4 },
        ],
      },
    ],
    materials: [
      {
        name: 'malla',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binByteLength }],
    bufferViews,
    accessors,
  };

  const jsonBuffer = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonChunk = Buffer.alloc(alinear4(jsonBuffer.length));
  jsonBuffer.copy(jsonChunk);
  jsonChunk.fill(0x20, jsonBuffer.length); // padding con espacios

  const binChunk = Buffer.alloc(alinear4(binByteLength));
  let cursor = 0;
  for (const part of parts) {
    Buffer.from(part.buffer, part.byteOffset, part.byteLength).copy(binChunk, cursor);
    cursor += part.byteLength;
  }

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const glb = Buffer.alloc(total);
  glb.writeUInt32LE(0x46546c67, 0); // "glTF"
  glb.writeUInt32LE(2, 4);          // versión
  glb.writeUInt32LE(total, 8);      // largo total
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.writeUInt32LE(CHUNK_JSON, 16);
  jsonChunk.copy(glb, 20);
  glb.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
  glb.writeUInt32LE(CHUNK_BIN, 24 + jsonChunk.length);
  binChunk.copy(glb, 28 + jsonChunk.length);
  return glb;
}

/** Parsea el header y el JSON de un .glb (para tests/validación). */
export function leerGLB(buffer) {
  if (buffer.length < 20) throw new Error('GLB demasiado corto');
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  if (magic !== 0x46546c67) throw new Error(`Magic inválido: 0x${magic.toString(16)}`);
  if (version !== 2) throw new Error(`Versión GLB inválida: ${version}`);

  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== CHUNK_JSON) throw new Error('El primer chunk no es JSON');
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  return { version, json, jsonLength };
}
