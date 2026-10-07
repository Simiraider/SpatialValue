
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

const CHUNK_JSON = 0x4e4f534a; 
const CHUNK_BIN = 0x004e4942;  

const alinear4 = (n) => Math.ceil(n / 4) * 4;

export function escribirGLB(mesh, nombre = 'modelo') {
  const { positions, normals, colors, indices, mode = 4 } = mesh;
  const esPuntos = mode === 0;

  if (!positions.length || positions.length % 3 !== 0) {
    throw new Error('Positions inválidas: deben ser triplas de floats');
  }
  if (!esPuntos && (!indices || indices.length === 0)) {
    throw new Error('Faltan indices: una malla (mode 4) necesita triángulos');
  }
  if (!esPuntos && indices.length % 3 !== 0) {
    throw new Error('Indices inválidos: deben ser triplas');
  }
  if (normals && normals.length && normals.length !== positions.length) {
    throw new Error('Normals inválidas: deben tener la misma cantidad que positions');
  }

  const nVertices = positions.length / 3;
  const usarUint32 = nVertices > 65535;

  const parts = [];
  const push = (data) => {
    const offset = parts.reduce((acc, p) => acc + p.byteLength, 0);
    parts.push(data);
    return offset;
  };

  const posOffset = push(Float32Array.from(positions));

  const tieneNormales = !!(normals && normals.length);
  const normOffset = tieneNormales ? push(Float32Array.from(normals)) : null;

  let colOffset = null;
  if (colors && colors.length) {
    if (colors.length !== positions.length) {
      throw new Error('Colors inválidas: deben tener la misma cantidad que positions');
    }
    colOffset = push(Float32Array.from(colors));
  }

  let idxOffset = null;
  let idxData = null;
  if (!esPuntos) {
    idxData = usarUint32 ? Uint32Array.from(indices) : Uint16Array.from(indices);
    idxOffset = push(idxData);
  }

  const binByteLength = parts.reduce((acc, p) => acc + p.byteLength, 0);

  const ARRAY_BUFFER = 34962;
  const ELEMENT_ARRAY_BUFFER = 34963;

  const bufferViews = [];
  const accessors = [];
  const addView = (offset, length, target) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: length, target });
    return bufferViews.length - 1;
  };

  const minimo = [Infinity, Infinity, Infinity];
  const maximo = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let eje = 0; eje < 3; eje++) {
      const v = positions[i + eje];
      if (v < minimo[eje]) minimo[eje] = v;
      if (v > maximo[eje]) maximo[eje] = v;
    }
  }

  const posBV = addView(posOffset, positions.length * 4, ARRAY_BUFFER);
  accessors.push({
    bufferView: posBV,
    componentType: FLOAT,
    count: nVertices,
    type: 'VEC3',
    min: minimo,
    max: maximo,
  });

  const attributes = { POSITION: 0 };

  if (normOffset !== null) {
    const bv = addView(normOffset, normals.length * 4, ARRAY_BUFFER);
    accessors.push({ bufferView: bv, componentType: FLOAT, count: nVertices, type: 'VEC3' });
    attributes.NORMAL = accessors.length - 1;
  }

  if (colOffset !== null) {
    const bv = addView(colOffset, colors.length * 4, ARRAY_BUFFER);
    accessors.push({ bufferView: bv, componentType: FLOAT, count: nVertices, type: 'VEC3' });
    attributes.COLOR_0 = accessors.length - 1;
  }

  const primitive = { attributes, material: 0, mode };

  if (idxOffset !== null) {
    const bv = addView(idxOffset, idxData.byteLength, ELEMENT_ARRAY_BUFFER);
    accessors.push({
      bufferView: bv,
      componentType: usarUint32 ? UNSIGNED_INT : UNSIGNED_SHORT,
      count: indices.length,
      type: 'SCALAR',
    });
    primitive.indices = accessors.length - 1;
  }

  const gltf = {
    asset: { version: '2.0', generator: 'spatial-value-gemelo-worker' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nombre }],
    meshes: [{ name: nombre, primitives: [primitive] }],
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
  jsonChunk.fill(0x20, jsonBuffer.length); 

  const binChunk = Buffer.alloc(alinear4(binByteLength));
  let cursor = 0;
  for (const part of parts) {
    Buffer.from(part.buffer, part.byteOffset, part.byteLength).copy(binChunk, cursor);
    cursor += part.byteLength;
  }

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const glb = Buffer.alloc(total);
  glb.writeUInt32LE(0x46546c67, 0); 
  glb.writeUInt32LE(2, 4);          
  glb.writeUInt32LE(total, 8);      
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.writeUInt32LE(CHUNK_JSON, 16);
  jsonChunk.copy(glb, 20);
  glb.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
  glb.writeUInt32LE(CHUNK_BIN, 24 + jsonChunk.length);
  binChunk.copy(glb, 28 + jsonChunk.length);
  return glb;
}

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
