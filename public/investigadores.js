const elemento = id => document.getElementById(id);
const buscador = elemento('buscar');
const directorio = elemento('directorio');
const perfil = elemento('perfil');
const estado = elemento('estado');
const titulo = elemento('titulo');
let investigadores = [];
let turno = 0;

const normalizar = texto => texto.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');

async function consultar(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) throw new Error('No se pudo consultar ArangoDB. Revisa la terminal del servidor.');
  return respuesta.json();
}

function mostrarDirectorio() {
  const filtro = normalizar(buscador.value.trim());
  const coincidencias = investigadores.filter(persona =>
    [persona.nombre, ...persona.universidades].some(texto => normalizar(texto).includes(filtro))
  );
  directorio.replaceChildren();
  for (const persona of coincidencias) {
    const tarjeta = document.createElement('a');
    tarjeta.className = 'box tarjeta';
    tarjeta.href = '#investigadores/' + encodeURIComponent(persona.id);
    const nombre = document.createElement('strong');
    nombre.textContent = persona.nombre;
    const universidad = document.createElement('span');
    universidad.textContent = persona.universidades.join(' · ') || 'Sin afiliación registrada';
    tarjeta.append(nombre, universidad);
    directorio.append(tarjeta);
  }
  estado.textContent = coincidencias.length
    ? coincidencias.length + (coincidencias.length === 1 ? ' investigador' : ' investigadores')
    : 'No se encontraron investigadores.';
}

function mostrarLista(id, elementos, vacio) {
  const lista = elemento(id);
  lista.replaceChildren();
  for (const contenido of elementos.length ? elementos : [vacio]) {
    const fila = document.createElement('li');
    fila.append(contenido);
    lista.append(fila);
  }
}

function agruparCoautorias(filas) {
  const grupos = new Map();
  for (const fila of filas) {
    if (!grupos.has(fila.autorId)) grupos.set(fila.autorId, []);
    grupos.get(fila.autorId).push(fila);
  }
  return [...grupos.values()].map(trabajos => {
    const grupo = document.createElement('div');
    const colega = document.createElement('a');
    colega.href = '#investigadores/' + encodeURIComponent(trabajos[0].autorId);
    colega.textContent = trabajos[0].colaborador;
    const lista = document.createElement('ul');
    for (const trabajo of trabajos) {
      const fila = document.createElement('li');
      fila.textContent = trabajo.publicacion;
      lista.append(fila);
    }
    grupo.append(colega, lista);
    return grupo;
  });
}

async function navegar() {
  const actual = ++turno;
  const activa = /^#investigadores(?:\/|$)/.test(location.hash);
  elemento('vista-investigadores').hidden = !activa;
  document.querySelector('nav a[href="#investigadores"]').toggleAttribute('aria-current', activa);
  if (!activa) return;
  const id = /^#investigadores\/([a-zA-Z0-9_-]+)$/.exec(location.hash)?.[1];
  perfil.hidden = true;
  directorio.hidden = Boolean(id);
  elemento('filtro').hidden = Boolean(id);
  elemento('volver').hidden = !id;
  titulo.textContent = id ? 'Perfil de investigador' : 'Investigadores';
  elemento('subtitulo').textContent = id ? '' : 'Encuentra a un investigador y explora sus publicaciones y colaboraciones.';
  estado.textContent = 'Cargando…';

  try {
    if (!investigadores.length) {
      const datos = await consultar('/api/directorio-investigadores');
      if (actual !== turno) return;
      investigadores = datos;
    }
    if (!id) {
      mostrarDirectorio();
      return;
    }
    const persona = investigadores.find(item => item.id === id);
    if (!persona) throw new Error('No se encontró el investigador.');
    const ruta = '/api/investigadores/' + id;
    const [publicaciones, coautorias] = await Promise.all([
      consultar(ruta + '/publicaciones'),
      consultar(ruta + '/colaboradores'),
    ]);
    if (actual !== turno) return;
    titulo.textContent = persona.nombre;
    elemento('subtitulo').textContent = persona.universidades.join(' · ') || 'Sin afiliación registrada';
    mostrarLista('publicaciones', publicaciones.map(item => {
      const enlace = document.createElement('a');
      enlace.href = '#publicaciones/' + encodeURIComponent(item.id);
      enlace.textContent = item.titulo;
      return enlace;
    }), 'Aún no tiene publicaciones.');
    mostrarLista('colaboradores', agruparCoautorias(coautorias), 'Aún no tiene colaboraciones.');
    estado.textContent = '';
    perfil.hidden = false;
    titulo.focus();
  } catch (error) {
    if (actual === turno) estado.textContent = error.message;
  }
}

buscador.addEventListener('input', () => { if (investigadores.length) mostrarDirectorio(); });
document.addEventListener('gestion:investigador-creado', () => { investigadores = []; });
window.addEventListener('hashchange', navegar);
navegar();
