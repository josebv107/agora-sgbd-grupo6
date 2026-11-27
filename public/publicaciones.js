(() => {
  const vista = elemento('vista-publicaciones');
  const encabezado = elemento('titulo-publicaciones');
  const subtitulo = elemento('subtitulo-publicaciones');
  const estado = elemento('estado-publicaciones');
  const lista = elemento('lista-publicaciones');
  const ficha = elemento('ficha-publicacion');
  const buscador = elemento('buscar-publicacion');
  const tipo = elemento('tipo-publicacion');
  const universidad = elemento('universidad-publicacion');
  let publicaciones = [];
  let solicitud = 0;
  let disponible = false;
  let universidadesCargadas = false;

  const etiquetaTipo = valor => ({ articulo: 'Artículo', tesis: 'Tesis' })[valor] || valor || 'Tipo sin registrar';

  function actualizarResultados() {
    if (!disponible) return;
    const busqueda = normalizar(buscador.value.trim());
    const filtradas = publicaciones.filter(item =>
      normalizar(item.titulo).includes(busqueda) && (!tipo.value || item.tipo === tipo.value)
    );
    lista.replaceChildren();
    for (const item of filtradas) {
      const tarjeta = document.createElement('article');
      tarjeta.className = 'box';
      const etiqueta = document.createElement('span');
      etiqueta.className = 'etiqueta-tipo';
      etiqueta.textContent = etiquetaTipo(item.tipo);
      const titulo = document.createElement('h2');
      const enlace = document.createElement('a');
      enlace.href = '#publicaciones/' + encodeURIComponent(item.id);
      enlace.textContent = item.titulo;
      titulo.append(enlace);
      tarjeta.append(etiqueta, titulo);
      lista.append(tarjeta);
    }
    estado.textContent = filtradas.length
      ? filtradas.length + (filtradas.length === 1 ? ' publicación' : ' publicaciones')
      : 'No se encontraron publicaciones.';
  }

  function panel(titulo, contenido) {
    const seccion = document.createElement('section');
    seccion.className = 'box';
    const encabezado = document.createElement('h2');
    encabezado.textContent = titulo;
    seccion.append(encabezado, contenido);
    return seccion;
  }

  function mostrarFicha(item) {
    encabezado.textContent = item.titulo;
    subtitulo.textContent = [etiquetaTipo(item.tipo), item.anio].filter(Boolean).join(' · ');
    const resumen = document.createElement('p');
    resumen.textContent = item.resumen || 'Sin resumen registrado.';
    const autores = document.createElement('ul');
    for (const autor of item.autores) {
      const fila = document.createElement('li');
      const enlace = document.createElement('a');
      enlace.href = '#investigadores/' + encodeURIComponent(autor.id);
      enlace.textContent = autor.nombre;
      fila.append(enlace);
      autores.append(fila);
    }
    if (!item.autores.length) {
      const fila = document.createElement('li');
      fila.textContent = 'No hay autores registrados.';
      autores.append(fila);
    }
    const detalle = panel('Resumen', resumen);
    if (item.medio || item.area) {
      const datos = document.createElement('dl');
      for (const [nombre, valor] of [
        [item.medio?.tipo === 'congreso' ? 'Congreso' : 'Revista', item.medio?.nombre],
        ['Área de investigación', item.area],
      ]) {
        if (!valor) continue;
        const etiqueta = document.createElement('dt');
        etiqueta.textContent = nombre;
        const contenido = document.createElement('dd');
        contenido.textContent = valor;
        datos.append(etiqueta, contenido);
      }
      detalle.append(datos);
    }
    ficha.replaceChildren(detalle, panel('Autores', autores));
    ficha.hidden = false;
    estado.textContent = '';
    encabezado.focus();
  }

  async function navegarPublicaciones() {
    const turno = ++solicitud;
    const activa = !location.hash || /^#publicaciones(?:\/|$)/.test(location.hash);
    vista.hidden = !activa;
    document.querySelector('nav a[href="#publicaciones"]').toggleAttribute('aria-current', activa);
    if (!activa) return;
    const id = /^#publicaciones\/([a-zA-Z0-9_-]+)$/.exec(location.hash)?.[1];
    ficha.hidden = true;
    lista.hidden = Boolean(id);
    elemento('filtros-publicaciones').hidden = Boolean(id);
    elemento('volver-publicaciones').hidden = !id;
    encabezado.textContent = id ? 'Ficha de publicación' : 'Publicaciones';
    subtitulo.textContent = id ? '' : 'Explora artículos y tesis por título, tipo o universidad.';
    estado.textContent = 'Cargando…';
    disponible = false;
    lista.replaceChildren();

    try {
      if (id) {
        const respuesta = await fetch('/api/publicaciones/' + id);
        if (respuesta.status === 404) throw new Error('No se encontró la publicación.');
        if (!respuesta.ok) throw new Error('No se pudo consultar la publicación.');
        const datos = await respuesta.json();
        if (turno === solicitud) mostrarFicha(datos);
        return;
      }

      const ruta = universidad.value
        ? '/api/universidades/' + encodeURIComponent(universidad.value) + '/publicaciones'
        : '/api/publicaciones';
      const [encontradas, instituciones] = await Promise.all([
        consultar(ruta),
        universidadesCargadas ? null : consultar('/api/universidades'),
      ]);
      if (turno !== solicitud) return;
      if (instituciones) {
        const seleccion = universidad.value;
        universidad.replaceChildren(new Option('Todas las universidades', ''));
        for (const item of instituciones) universidad.add(new Option(item.nombre, item.id));
        if (instituciones.some(item => item.id === seleccion)) universidad.value = seleccion;
        universidadesCargadas = true;
      }
      publicaciones = encontradas;
      disponible = true;
      actualizarResultados();
    } catch (error) {
      if (turno === solicitud) estado.textContent = error.message;
    }
  }

  buscador.addEventListener('input', actualizarResultados);
  tipo.addEventListener('change', actualizarResultados);
  universidad.addEventListener('change', navegarPublicaciones);
  document.addEventListener('gestion:universidad-creada', () => { universidadesCargadas = false; });
  window.addEventListener('hashchange', navegarPublicaciones);
  navegarPublicaciones();
})();