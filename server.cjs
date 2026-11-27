const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const password = process.env.ARANGO_PASSWORD;
if (!password) {
  console.error('Define ARANGO_PASSWORD antes de iniciar la API.');
  process.exit(1);
}

const user = process.env.ARANGO_USER || 'root';
const authorization = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
const cursorUrl = 'http://127.0.0.1:8529/_db/produccion_cientifica/_api/cursor';

const publicationsByResearcher = `
  WITH investigadores, publicaciones
  FOR publicacion IN 1..1 OUTBOUND @origen autorias
    SORT publicacion.titulo
    RETURN { id: publicacion._key, titulo: publicacion.titulo, tipo: publicacion.tipo }
`;

const publicationsByUniversity = `
  WITH universidades, investigadores, publicaciones
  FOR investigador IN 1..1 INBOUND @origen afiliaciones
    FOR publicacion IN 1..1 OUTBOUND investigador autorias
      RETURN DISTINCT { id: publicacion._key, titulo: publicacion.titulo, tipo: publicacion.tipo }
`;

const collaborationsByResearcher = `
  WITH investigadores, publicaciones
  FOR publicacion IN 1..1 OUTBOUND @origen autorias
    FOR colega IN 1..1 INBOUND publicacion autorias
      FILTER colega._id != @origen
      RETURN DISTINCT { autorId: colega._key, colaborador: colega.nombre, publicacionId: publicacion._key, publicacion: publicacion.titulo }
`;

const queries = {
  'investigadores/publicaciones': publicationsByResearcher,
  'investigadores/colaboradores': collaborationsByResearcher,
  'universidades/publicaciones': publicationsByUniversity,
};


const catalogos = new Map([
  ['/api/revistas', 'revista'],
  ['/api/congresos', 'congreso'],
  ['/api/areas', 'area'],
]);
let inicializacionMetadatos;

function asegurarMetadatos() {
  if (!inicializacionMetadatos) {
    inicializacionMetadatos = crearColeccionMetadatos().catch(error => {
      inicializacionMetadatos = undefined;
      throw error;
    });
  }
  return inicializacionMetadatos;
}

async function crearColeccionMetadatos() {
  const respuesta = await fetch(cursorUrl.replace(/cursor$/, 'collection'), {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'metadatos' }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await respuesta.json();
  if (!respuesta.ok && data.errorNum !== 1207) throw new Error(data.errorMessage || 'No se pudo crear metadatos.');
}

const listMetadata = `
  FOR item IN metadatos
    SORT item.tipo, item.nombre, item._key
    RETURN { id: item._key, nombre: item.nombre, tipo: item.tipo }
`;

const insertMetadata = `
  INSERT { nombre: @nombre, tipo: @tipo } INTO metadatos
  RETURN { id: NEW._key, nombre: NEW.nombre, tipo: NEW.tipo }
`;

async function registrarMetadato(datos, response, tipo) {
  const nombre = typeof datos?.nombre === 'string' ? datos.nombre.trim() : '';
  if (!nombre || nombre.length > 150) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: 'Ingresa un nombre de hasta 150 caracteres.' }));
    return;
  }

  await asegurarMetadatos();
  await guardarConAql(response, insertMetadata, { nombre, tipo }, 'No se pudo registrar el metadato.');
}

const insertPublication = `
  LET autores = (
    FOR clave IN @autores
      LET autor = DOCUMENT(CONCAT("investigadores/", clave))
      FILTER autor != null
      RETURN autor._id
  )
  LET medio = @medio == "" ? null : DOCUMENT(CONCAT("metadatos/", @medio))
  LET area = @area == "" ? null : DOCUMENT(CONCAT("metadatos/", @area))
  FILTER LENGTH(autores) == LENGTH(@autores)
  FILTER @medio == "" OR (medio != null AND medio.tipo IN ["revista", "congreso"])
  FILTER @area == "" OR (area != null AND area.tipo == "area")
  INSERT { titulo: @titulo, tipo: @tipo, anio: @anio, resumen: @resumen, medioId: @medio, areaId: @area } INTO publicaciones
  LET publicacion = NEW
  LET autoriasCreadas = (
    FOR autor IN autores
      INSERT { _from: autor, _to: publicacion._id } INTO autorias
      RETURN 1
  )
  RETURN { id: publicacion._key, titulo: publicacion.titulo, tipo: publicacion.tipo, autores: LENGTH(autoriasCreadas) }
`;

async function leerDatos(request) {
  let datos;
  try {
    let body = '';
    for await (const chunk of request.setEncoding('utf8').iterator({ destroyOnReturn: false })) {
      body += chunk;
      if (body.length > 32768) return;
    }
    datos = JSON.parse(body);
  } catch {
    // La validación responde con el mismo mensaje si el JSON no es válido.
  }

  return datos;
}

async function registrarPublicacion(datos, response) {
  const titulo = typeof datos?.titulo === 'string' ? datos.titulo.trim() : '';
  const { tipo, autores, anio, medio = '', area = '' } = datos || {};
  const metadatoValido = clave => typeof clave === 'string' && /^[a-zA-Z0-9_-]{0,254}$/.test(clave);
  const resumen = typeof datos?.resumen === 'string' ? datos.resumen.trim() : '';
  const anioValido = Number.isInteger(anio) && anio >= 1900 && anio <= 2100;
  const autoresValidos = Array.isArray(autores) && autores.length >= 1 && autores.length <= 50
    && autores.every(autor => typeof autor === 'string' && /^[a-zA-Z0-9_-]{1,254}$/.test(autor));

  if (!titulo || titulo.length > 200 || !['articulo', 'tesis'].includes(tipo) || !autoresValidos || !anioValido || resumen.length > 700 || !metadatoValido(medio) || !metadatoValido(area)) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: 'Revisa el título, el tipo, el año entre 1900 y 2100, el resumen de hasta 700 caracteres y los autores.' }));
    return;
  }

  await asegurarMetadatos();
  await guardarConAql(response, insertPublication, {
    titulo, tipo, anio, resumen, medio, area, autores: [...new Set(autores)],
  }, 'Revisa los autores, el medio y el área seleccionados. Algún registro ya no existe o pertenece a otro tipo.');
}

async function guardarConAql(response, query, bindVars, mensajeSinResultado) {
  const resultado = await fetch(cursorUrl, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, bindVars }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await resultado.json();
  if (!resultado.ok || data.error) throw new Error(data.errorMessage || 'HTTP ' + resultado.status);
  if (!data.result.length) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: mensajeSinResultado }));
    return;
  }
  response.statusCode = 201;
  response.end(JSON.stringify(data.result[0]));
}

const authorSearch = `
  WITH investigadores, universidades
  FOR item IN investigadores
    FILTER CONTAINS(LOWER(item.nombre), @texto)
    FILTER item._key NOT IN @excluir
    SORT item.nombre, item._key
    LIMIT 8
    LET afiliadas = (
      FOR universidad IN 1..1 OUTBOUND item afiliaciones
        SORT universidad.nombre
        RETURN DISTINCT universidad.nombre
    )
    RETURN { id: item._key, nombre: item.nombre, universidades: afiliadas }
`;

const insertUniversity = `
  INSERT { nombre: @nombre } INTO universidades
  RETURN { id: NEW._key, nombre: NEW.nombre }
`;

const insertResearcher = `
  LET universidad = DOCUMENT(CONCAT("universidades/", @universidad))
  FILTER universidad != null
  INSERT { nombre: @nombre } INTO investigadores
  LET investigador = NEW
  INSERT { _from: investigador._id, _to: universidad._id } INTO afiliaciones
  RETURN { id: investigador._key, nombre: investigador.nombre }
`;

async function registrarEntidad(datos, response, esInvestigador) {
  const nombre = typeof datos?.nombre === 'string' ? datos.nombre.trim() : '';
  const universidad = datos?.universidad;
  const universidadValida = typeof universidad === 'string' && /^[a-zA-Z0-9_-]{1,254}$/.test(universidad);

  if (!nombre || nombre.length > 150 || (esInvestigador && !universidadValida)) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: esInvestigador
      ? 'Ingresa un nombre de hasta 150 caracteres y selecciona una universidad.'
      : 'Ingresa un nombre de hasta 150 caracteres.' }));
    return;
  }

  if (esInvestigador) {
    await guardarConAql(response, insertResearcher, { nombre, universidad }, 'La universidad seleccionada ya no existe.');
  } else {
    await guardarConAql(response, insertUniversity, { nombre }, 'No se pudo registrar la universidad.');
  }
}

const publicationDetail = `
  WITH publicaciones, investigadores
  LET item = DOCUMENT(CONCAT("publicaciones/", @id))
  FILTER item != null
  LET autores = (
    FOR autor IN 1..1 INBOUND item autorias
      SORT autor.nombre, autor._key
      RETURN DISTINCT { id: autor._key, nombre: autor.nombre }
  )
  LET medio = item.medioId ? DOCUMENT(CONCAT("metadatos/", item.medioId)) : null
  LET area = item.areaId ? DOCUMENT(CONCAT("metadatos/", item.areaId)) : null
  RETURN {
    id: item._key, titulo: item.titulo, tipo: item.tipo, autores, anio: item.anio, resumen: item.resumen,
    medio: medio ? { nombre: medio.nombre, tipo: medio.tipo } : null,
    area: area ? area.nombre : null
  }
`;

const directoryQueries = {
  '/api/publicaciones': 'FOR item IN publicaciones SORT item.titulo, item._key RETURN { id: item._key, titulo: item.titulo, tipo: item.tipo }',
  '/api/universidades': 'FOR item IN universidades SORT item.nombre, item._key RETURN { id: item._key, nombre: item.nombre }',
  '/api/directorio-investigadores': `
    WITH investigadores, universidades
    FOR item IN investigadores
      SORT item.nombre, item._key
      LET afiliadas = (
        FOR universidad IN 1..1 OUTBOUND item afiliaciones
          SORT universidad.nombre
          RETURN DISTINCT universidad.nombre
      )
      RETURN { id: item._key, nombre: item.nombre, universidades: afiliadas }
  `,
};

const archivos = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/investigadores.js', ['investigadores.js', 'text/javascript']],
  ['/publicaciones.js', ['publicaciones.js', 'text/javascript']],
  ['/gestion.js', ['gestion.js', 'text/javascript']],
  ['/entidades.js', ['entidades.js', 'text/javascript']],
]);

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');
  const archivo = archivos.get(pathname);

  if (request.method === 'GET' && archivo) {
    try {
      const contenido = await readFile(join(__dirname, 'public', archivo[0]));
      response.setHeader('Content-Type', archivo[1] + '; charset=utf-8');
      response.end(contenido);
    } catch (error) {
      console.error(error.message);
      response.statusCode = 500;
      response.end(JSON.stringify({ error: 'No se pudo abrir la página.' }));
    }
    return;
  }

  const ruta = /^\/api\/(investigadores|universidades)\/([a-zA-Z0-9_-]+)\/(publicaciones|colaboradores)$/.exec(pathname);
  const catalogo = catalogos.get(pathname);
  const permiteRegistro = catalogo || ['/api/publicaciones', '/api/universidades', '/api/investigadores'].includes(pathname);
  if (request.method === 'POST' && permiteRegistro) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      response.statusCode = 415;
      response.end(JSON.stringify({ error: 'Se esperaba una solicitud JSON.' }));
      return;
    }
    try {
      const datos = await leerDatos(request);
      if (pathname === '/api/publicaciones') {
        await registrarPublicacion(datos, response);
      } else if (catalogo) {
        await registrarMetadato(datos, response, catalogo);
      } else {
        await registrarEntidad(datos, response, pathname === '/api/investigadores');
      }
    } catch (error) {
      console.error('Registro en ArangoDB:', error.message);
      response.statusCode = 502;
      response.end(JSON.stringify({ error: 'No se pudo confirmar el registro. Revisa el catálogo antes de volver a guardar.' }));
    }
    return;
  }

  const ficha = /^\/api\/publicaciones\/([a-zA-Z0-9_-]+)$/.exec(pathname);
  const buscarAutores = pathname === '/api/investigadores' && searchParams.has('q');
  const texto = (searchParams.get('q') || '').trim().slice(0, 150).toLowerCase();
  if (request.method === 'GET' && buscarAutores && !texto) {
    response.end('[]');
    return;
  }
  const listarMetadatos = pathname === '/api/metadatos';
  const query = listarMetadatos ? listMetadata : buscarAutores ? authorSearch : ficha ? publicationDetail : (ruta ? queries[ruta[1] + '/' + ruta[3]] : directoryQueries[pathname]);

  if (request.method !== 'GET' || !query) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Ruta no encontrada.' }));
    return;
  }

  try {
    const headers = { Authorization: authorization, 'Content-Type': 'application/json' };
    if (ficha || listarMetadatos) await asegurarMetadatos();
    const bindVars = buscarAutores ? { texto, excluir: searchParams.getAll('excluir').slice(0, 50) } : ficha ? { id: ficha[1] } : (ruta ? { origen: ruta[1] + '/' + ruta[2] } : {});
    let url = cursorUrl;
    let body = JSON.stringify({ query, bindVars });
    const registros = [];

    while (url) {
      const respuesta = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
      const datos = await respuesta.json();
      if (!respuesta.ok || datos.error) throw new Error(datos.errorMessage || 'HTTP ' + respuesta.status);
      for (const registro of datos.result) registros.push(registro);
      url = datos.hasMore ? cursorUrl + '/' + encodeURIComponent(datos.id) : null;
      body = undefined;
    }

    if (ficha && !registros.length) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'No se encontró la publicación.' }));
      return;
    }
    response.end(JSON.stringify(ficha ? registros[0] : registros));
  } catch (error) {
    console.error('Consulta a ArangoDB:', error.message);
    response.statusCode = 502;
    response.end(JSON.stringify({ error: 'No se pudo consultar ArangoDB.' }));
  }
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Ágora disponible en http://127.0.0.1:3000');
});