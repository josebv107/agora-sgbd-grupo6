(() => {
  const formulario = document.querySelector('#registro');
  const verPublicacion = document.querySelector('#ver-publicacion-registrada');
  const buscador = document.querySelector('#buscar-autores');
  const resultados = document.querySelector('#resultados-autores');
  const autores = document.querySelector('#autores-publicacion');
  const guardar = document.querySelector('#guardar-publicacion');
  const estado = document.querySelector('#estado-registro');
  const estadoAutores = document.querySelector('#estado-autores');
  const seleccion = new Map();
  let solicitud = 0;
  let espera;
  let guardando = false;
  let solicitudMetadatos = 0;
  const medioPublicacion = document.querySelector('#medio-publicacion');
  const areaPublicacion = document.querySelector('#area-publicacion');

  async function cargarMetadatos() {
    const turno = ++solicitudMetadatos;
    const estadoMetadatos = document.querySelector('#estado-metadatos');
    estadoMetadatos.hidden = true;
    try {
      const registros = await consultar('/api/metadatos');
      if (turno !== solicitudMetadatos) return;

      const medioElegido = medioPublicacion.value;
      const areaElegida = areaPublicacion.value;
      medioPublicacion.replaceChildren(new Option('Sin medio registrado', ''));
      areaPublicacion.replaceChildren(new Option('Sin área registrada', ''));
      for (const [tipo, etiqueta] of [['revista', 'Revistas'], ['congreso', 'Congresos']]) {
        const grupo = document.createElement('optgroup');
        grupo.label = etiqueta;
        for (const item of registros.filter(item => item.tipo === tipo)) grupo.append(new Option(item.nombre, item.id));
        if (grupo.children.length) medioPublicacion.append(grupo);
      }
      for (const item of registros.filter(item => item.tipo === 'area')) areaPublicacion.add(new Option(item.nombre, item.id));
      if (registros.some(item => item.id === medioElegido && item.tipo !== 'area')) medioPublicacion.value = medioElegido;
      if (registros.some(item => item.id === areaElegida && item.tipo === 'area')) areaPublicacion.value = areaElegida;
    } catch {
      if (turno !== solicitudMetadatos) return;
      estadoMetadatos.textContent = 'No se pudieron cargar las revistas, congresos ni áreas. Vuelve a abrir Publicaciones en Gestión para reintentar.';
      estadoMetadatos.hidden = false;
    }
  }

  document.addEventListener('gestion:publicacion-abierta', cargarMetadatos);

  function presentarAutor(autor) {
    const identidad = document.createElement('span');
    identidad.className = 'identidad-autor';
    const nombre = document.createElement('strong');
    nombre.textContent = autor.nombre;
    const universidades = document.createElement('span');
    universidades.textContent = autor.universidades.join(' · ') || 'Sin afiliación registrada';
    identidad.append(nombre, universidades);
    return identidad;
  }

  function mostrarSeleccion() {
    autores.replaceChildren();
    for (const [id, autor] of seleccion) {
      const fila = document.createElement('li');
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.textContent = 'Quitar';
      quitar.setAttribute('aria-label', 'Quitar a ' + autor.nombre + (autor.universidades.length ? ', ' + autor.universidades.join(', ') : ''));
      quitar.addEventListener('click', () => {
        seleccion.delete(id);
        mostrarSeleccion();
        programarBusqueda();
        buscador.focus();
      });
      fila.append(presentarAutor(autor), quitar);
      autores.append(fila);
    }
    guardar.disabled = guardando || !seleccion.size;
  }

  function programarBusqueda() {
    clearTimeout(espera);
    const turno = ++solicitud;
    resultados.replaceChildren();
    const texto = buscador.value.trim();
    if (seleccion.size >= 50) {
      estadoAutores.textContent = 'Has seleccionado el máximo de 50 autores.';
      return;
    }
    if (!texto) {
      estadoAutores.textContent = 'Escribe un nombre para buscar.';
      return;
    }
    estadoAutores.textContent = 'Buscando…';
    espera = setTimeout(() => buscar(texto, turno), 200);
  }

  async function buscar(texto, turno) {
    try {
      const parametros = new URLSearchParams({ q: texto });
      for (const id of seleccion.keys()) parametros.append('excluir', id);
      const respuesta = await fetch('/api/investigadores?' + parametros);
      if (!respuesta.ok) throw new Error('No se pudieron buscar investigadores.');
      const opciones = await respuesta.json();
      if (turno !== solicitud) return;

      for (const autor of opciones) {
        const fila = document.createElement('li');
        const agregar = document.createElement('button');
        agregar.type = 'button';
        agregar.append(presentarAutor(autor));
        agregar.setAttribute('aria-label', 'Agregar a ' + autor.nombre + (autor.universidades.length ? ', ' + autor.universidades.join(', ') : ''));
        agregar.addEventListener('click', () => {
          seleccion.set(autor.id, autor);
          mostrarSeleccion();
          programarBusqueda();
          buscador.focus();
        });
        fila.append(agregar);
        resultados.append(fila);
      }
      estadoAutores.textContent = opciones.length === 8
        ? 'Hasta 8 coincidencias. Escribe más para acotar.'
        : opciones.length ? 'Elige un autor para agregarlo.' : 'No se encontraron autores disponibles.';
    } catch (error) {
      if (turno === solicitud) estadoAutores.textContent = error.message;
    }
  }

  buscador.addEventListener('input', programarBusqueda);
  buscador.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      resultados.querySelector('button')?.focus();
    }
  });
  programarBusqueda();

  formulario.addEventListener('submit', async event => {
    event.preventDefault();
    if (guardando || !seleccion.size) return;
    guardando = true;
    guardar.disabled = true;
    verPublicacion.hidden = true;
    estado.textContent = 'Guardando…';
    try {
      const respuesta = await fetch('/api/publicaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: document.querySelector('#titulo-publicacion').value,
          tipo: document.querySelector('#tipo-registro').value,
          anio: document.querySelector('#anio-publicacion').valueAsNumber,
          resumen: document.querySelector('#resumen-publicacion').value,
          medio: medioPublicacion.value,
          area: areaPublicacion.value,
          autores: [...seleccion.keys()],
        }),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error);
      formulario.reset();
      seleccion.clear();
      programarBusqueda();
      estado.textContent = 'Publicación registrada: ' + resultado.titulo + '.';
      verPublicacion.href = '#publicaciones/' + encodeURIComponent(resultado.id);
      verPublicacion.hidden = false;
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      guardando = false;
      mostrarSeleccion();
    }
  });
})();