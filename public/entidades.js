(() => {
  const vista = document.querySelector('#vista-gestion');
  const enlaces = [...document.querySelectorAll('.gestion-menu a')];
  const investigador = document.querySelector('#registro-investigador');
  const universidad = investigador.elements.universidad;
  const botonInvestigador = investigador.querySelector('button');
  const estadoInvestigador = investigador.closest('section').querySelector('[role=status]');
  let universidadNueva = '';
  let universidadesListas = false;
  let solicitud = 0;

  async function cargarUniversidades() {
    const turno = ++solicitud;
    botonInvestigador.disabled = true;
    estadoInvestigador.textContent = 'Cargando universidades…';
    universidadesListas = false;
    try {
      const opciones = await consultar('/api/universidades');
      if (turno !== solicitud) return;
      const seleccion = universidadNueva || universidad.value;
      universidad.replaceChildren(new Option('Selecciona una universidad', ''));
      for (const opcion of opciones) universidad.add(new Option(opcion.nombre, opcion.id));
      if (opciones.some(opcion => opcion.id === seleccion)) universidad.value = seleccion;
      universidadNueva = '';
      universidadesListas = Boolean(opciones.length);
      estadoInvestigador.textContent = universidadesListas ? '' : 'Registra primero una universidad.';
      botonInvestigador.disabled = !universidadesListas;
    } catch (error) {
      if (turno === solicitud) estadoInvestigador.textContent = error.message;
    }
  }

  function navegarGestion() {
    const [, seccion] = /^#gestion(?:\/(publicaciones|universidades|investigadores|revistas|congresos|areas))?$/.exec(location.hash) || [];
    const activa = location.hash === '#gestion' || Boolean(seccion);
    vista.hidden = !activa;
    document.querySelector('.top a[href="#gestion"]').toggleAttribute('aria-current', activa);
    if (!activa) return;
    const grupo = seccion || 'publicaciones';
    for (const enlace of enlaces) {
      const panel = enlace.hash.split('/')[1];
      enlace.toggleAttribute('aria-current', panel === grupo);
      document.querySelector('#gestion-' + panel).hidden = panel !== grupo;
    }
    if (grupo === 'publicaciones') document.dispatchEvent(new Event('gestion:publicacion-abierta'));
    if (grupo === 'investigadores' && (!universidadesListas || universidadNueva)) cargarUniversidades();
  }

  function prepararRegistro(id, ruta, enlace, confirmar) {
    const formulario = document.querySelector('#' + id);
    const boton = formulario.querySelector('button');
    const estado = formulario.closest('section').querySelector('[role=status]');
    formulario.addEventListener('submit', async event => {
      event.preventDefault();
      if (boton.disabled) return;
      boton.disabled = true;
      if (enlace) enlace.hidden = true;
      estado.textContent = 'Guardando…';
      try {
        const respuesta = await fetch('/api/' + ruta, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(formulario))),
        });
        const registro = await respuesta.json();
        if (!respuesta.ok) throw new Error(registro.error);
        formulario.reset();
        estado.textContent = 'Registro guardado: ' + registro.nombre + '.';
        confirmar?.(registro);
        if (enlace) enlace.hidden = false;
      } catch (error) {
        estado.textContent = error.message;
      } finally {
        boton.disabled = false;
      }
    });
  }

  const registrarAfiliado = document.querySelector('#registrar-afiliado');
  prepararRegistro('registro-universidad', 'universidades', registrarAfiliado, registro => {
    universidadNueva = registro.id;
    document.dispatchEvent(new Event('gestion:universidad-creada'));
  });

  const verPerfil = document.querySelector('#ver-investigador-registrado');
  prepararRegistro('registro-investigador', 'investigadores', verPerfil, registro => {
    verPerfil.href = '#investigadores/' + encodeURIComponent(registro.id);
    document.dispatchEvent(new Event('gestion:investigador-creado'));
  });

  for (const ruta of ['revistas', 'congresos', 'areas']) {
    prepararRegistro('registro-' + ruta, ruta);
  }

  window.addEventListener('hashchange', navegarGestion);
  navegarGestion();
})();