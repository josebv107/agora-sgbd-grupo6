const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const os = require('node:os');

const urlBase = 'http://127.0.0.1:8529';
const usuario = process.env.ARANGO_USER || 'root';
const clave = process.env.ARANGO_PASSWORD;
const repeticiones = 20;
const calentamiento = 3;
const escalas = [1000, 10000];
const nombres = [
  ['publicationsByResearcher', 'Por investigador', 'investigadores/inv_0'],
  ['publicationsByUniversity', 'Por universidad', 'universidades/uni_0'],
  ['collaborationsByResearcher', 'Coautoría', 'investigadores/inv_0'],
];

async function api(base, ruta, { metodo = 'GET', datos, duplicado } = {}) {
  const respuesta = await fetch(urlBase + '/_db/' + base + '/_api/' + ruta, {
    method: metodo,
    headers: {
      Authorization: 'Basic ' + Buffer.from(usuario + ':' + clave).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: datos === undefined ? undefined : JSON.stringify(datos),
    signal: AbortSignal.timeout(60000),
  });
  const contenido = await respuesta.json();
  if (!respuesta.ok && (duplicado === undefined || contenido.errorNum !== duplicado)) {
    throw new Error(ruta + ': ' + (contenido.errorMessage || respuesta.status));
  }
  return contenido;
}

async function aql(base, query, bindVars, batchSize = 1000) {
  const inicio = performance.now();
  let cursor = await api(base, 'cursor', {
    metodo: 'POST',
    datos: { query, bindVars, batchSize, cache: false },
  });
  const resultado = [...cursor.result];
  let tiempoAql = cursor.extra?.stats?.executionTime;
  while (cursor.hasMore) {
    cursor = await api(base, 'cursor/' + encodeURIComponent(cursor.id), { metodo: 'POST' });
    resultado.push(...cursor.result);
    tiempoAql = cursor.extra?.stats?.executionTime ?? tiempoAql;
  }
  return {
    resultado,
    latencia: performance.now() - inicio,
    tiempoAqlMs: Number.isFinite(tiempoAql) ? tiempoAql * 1000 : null,
  };
}

function generarDatos(total) {
  const universidades = Array.from({ length: 10 }, (_, i) => ({ _key: 'uni_' + i, nombre: 'Universidad de prueba ' + i }));
  const cantidadInvestigadores = total / 10;
  const investigadores = Array.from({ length: cantidadInvestigadores }, (_, i) => ({
    _key: 'inv_' + i, nombre: 'Investigador de prueba ' + i,
  }));
  const afiliaciones = investigadores.map((persona, i) => ({
    _key: 'afil_' + i, _from: 'investigadores/' + persona._key, _to: 'universidades/uni_' + (i % 10),
  }));
  const publicaciones = [];
  const autorias = [];
  for (let i = 0; i < total; i++) {
    const clavePublicacion = 'pub_' + i;
    publicaciones.push({ _key: clavePublicacion, titulo: 'Publicación de prueba ' + i, tipo: i % 4 === 0 ? 'tesis' : 'articulo' });
    const principal = i % cantidadInvestigadores;
    const coautor = (principal + 1 + Math.floor(i / cantidadInvestigadores)) % cantidadInvestigadores;
    for (const autor of [principal, coautor]) {
      autorias.push({ _key: 'aut_' + i + '_' + autor, _from: 'investigadores/inv_' + autor, _to: 'publicaciones/' + clavePublicacion });
    }
  }
  return { universidades, investigadores, publicaciones, afiliaciones, autorias };
}

async function prepararBase(base, total) {
  await api('_system', 'database', { metodo: 'POST', datos: { name: base }, duplicado: 1207 });
  const grupos = generarDatos(total);
  const conteos = {};
  for (const [nombre, filas] of Object.entries(grupos)) {
    const tipo = ['afiliaciones', 'autorias'].includes(nombre) ? 3 : 2;
    await api(base, 'collection', { metodo: 'POST', datos: { name: nombre, type: tipo }, duplicado: 1207 });
    for (let i = 0; i < filas.length; i += 1000) {
      const lote = filas.slice(i, i + 1000);
      const respuesta = await api(base, 'document/' + nombre + '?overwriteMode=ignore', { metodo: 'POST', datos: lote });
      if (!Array.isArray(respuesta) || respuesta.length !== lote.length || respuesta.some(item => item.error)) {
        throw new Error('Carga incompleta en ' + nombre);
      }
    }
    const { count } = await api(base, 'collection/' + nombre + '/count');
    if (count !== filas.length) throw new Error(base + '/' + nombre + ': el conteo real difiere del previsto.');
    conteos[nombre] = count;
  }
  return conteos;
}

function percentil(valores, p) {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.ceil(p * ordenados.length) - 1];
}

async function medir(base, etiqueta, query, origen) {
  for (let i = 0; i < calentamiento; i++) await aql(base, query, { origen });
  const muestras = [];
  let filas;
  for (let i = 0; i < repeticiones; i++) {
    const medida = await aql(base, query, { origen });
    filas ??= medida.resultado.length;
    if (!filas || medida.resultado.length !== filas) throw new Error('Resultado vacío o variable en ' + etiqueta);
    muestras.push({ latenciaMs: medida.latencia, tiempoAqlMs: medida.tiempoAqlMs });
  }
  const latencias = muestras.map(item => item.latenciaMs);
  return { consulta: etiqueta, filas, p50Ms: percentil(latencias, .5), p95Ms: percentil(latencias, .95), muestras };
}

async function main() {
  if (!clave) throw new Error('Configura ARANGO_PASSWORD antes de ejecutar el benchmark.');
  const fuente = await readFile(join(__dirname, 'server.cjs'), 'utf8');
  const consultas = nombres.map(([nombre, etiqueta, origen]) => {
    const inicio = fuente.indexOf('const ' + nombre + ' = ' + String.fromCharCode(96));
    if (inicio === -1) throw new Error('No se encontró la consulta activa ' + nombre);
    const delimitador = String.fromCharCode(96);
    const query = fuente.split('const ' + nombre + ' = ' + delimitador)[1].split(delimitador)[0];
    return { etiqueta, origen, query };
  });
  const { version } = await api('_system', 'version');
  const informe = {
    fecha: new Date().toISOString(),
    entorno: { sistema: os.platform() + ' ' + os.release(), cpu: os.cpus()[0]?.model, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, arangoDB: version },
    repeticiones,
    calentamiento,
    unidad: 'milisegundos',
    escenarios: [],
  };
  console.log('Entorno:', informe.entorno);
  console.log('Latencia HTTP local hasta consumir todos los lotes. ' + calentamiento + ' calentamientos y ' + repeticiones + ' mediciones por consulta.');
  for (const total of escalas) {
    const base = 'agora_bench_' + total;
    console.log('\nPreparando ' + base + '…');
    const conteos = await prepararBase(base, total);
    console.log(JSON.stringify(conteos));
    const resultados = [];
    for (const { etiqueta, origen, query } of consultas) resultados.push(await medir(base, etiqueta, query, origen));
    console.table(resultados.map(({ consulta, filas, p50Ms, p95Ms }) => ({
      consulta, filas, 'p50 (ms)': p50Ms.toFixed(3), 'p95 (ms)': p95Ms.toFixed(3),
    })));
    informe.escenarios.push({ base, conteos, resultados });
  }
  await writeFile(join(__dirname, 'resultados-rendimiento.json'), JSON.stringify(informe, null, 2) + '\n');
  console.log('Mediciones guardadas en resultados-rendimiento.json');
}

main().catch(error => {
  console.error('Prueba interrumpida:', error.message, error.cause?.code || '');
  process.exitCode = 1;
});
