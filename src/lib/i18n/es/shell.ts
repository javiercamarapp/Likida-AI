// Namespace «shell»: el marco de la app (sidebar, menús, pie). Fuente de verdad en español; `en/shell.ts` lo espeja y el
// compilador exige las mismas claves. Por ahora solo trae el PIE del sidebar (demostración de P0); P1 agrega el resto.
export const shell = {
  // Pie del sidebar: organización
  'pie.org.titulo': 'Organización',
  'pie.org.sinDato': 'Sin dato',
  'pie.org.sinOrganizacion': 'Sin organización',
  'pie.org.ir': 'Ir',
  'pie.org.irA': '{ir}: {nombre}',
  'pie.org.sinNombre': 'organización',
  // Pie del sidebar: avisos
  'pie.avisos.titulo': 'Avisos',
  'pie.avisos.sinDato': 'Avisos: sin dato',
  'pie.avisos.nadaPendiente': 'Avisos: nada pendiente',
  'pie.avisos.pendientes.uno': 'Avisos: {n} pendiente',
  'pie.avisos.pendientes.otros': 'Avisos: {n} pendientes',
  'pie.avisos.pendientesUrgente.uno': 'Avisos: {n} pendiente, hay algo urgente',
  'pie.avisos.pendientesUrgente.otros': 'Avisos: {n} pendientes, hay algo urgente',
  // Pie del sidebar: tema
  'pie.tema.titulo': 'Tema de la interfaz',
  'pie.tema.claro': 'Tema claro',
  'pie.tema.sistema': 'Seguir al sistema',
  'pie.tema.oscuro': 'Tema oscuro',
  'pie.tema.ciclo': '{actual}. Cambiar a: {siguiente}',
  'pie.tema.cicloTitulo': '{actual} (cambiar a: {siguiente})',
  // Pie del sidebar: idioma
  'pie.idioma.titulo': 'Idioma',
  'pie.idioma.es': 'Español (México)',
  'pie.idioma.en': 'English (US)',
  'pie.idioma.proximamente': 'Inglés: próximamente',
  'pie.idioma.error': 'No se pudo guardar el idioma. Inténtalo de nuevo.',
  // Pie del sidebar: tarjeta de usuario
  'pie.cuenta.fallback': 'Mi cuenta',
  'pie.cuenta.menu': 'Menú de la cuenta',
  'pie.cuenta.etiqueta': 'Cuenta',
  'pie.cuenta.salir': 'Cerrar sesión',
  // Cabecera de escritorio y buscador (⌘K)
  'cab.plegar': 'Plegar el menú',
  'cab.expandir': 'Expandir el menú',
  'cab.buscar': 'Buscar',
  'cab.buscar.etiqueta': 'Buscar una pantalla ({atajo})',
  'cab.guia': 'Guía',
  'cab.guia.ayuda': 'Centro de ayuda',
  'cab.guia.paneles': 'Ver los otros paneles',
  'cab.guia.novedad': 'Guía, hay algo nuevo',
  // Navegación: bloque que muestra la pantalla abierta cuando su grupo está cerrado
  'nav.paginaActual': 'Página actual',
  'nav.proximamente': '{nombre} (próximamente)',
  // Buscador de pantallas (⌘K)
  'paleta.titulo': 'Buscar una pantalla',
  'paleta.subtitulo': 'Escribe el nombre de una pantalla o usa las flechas para recorrer la lista.',
  'paleta.placeholder': 'Buscar una pantalla… (Viajes, Facturación, ARCO)',
  'paleta.resultados': 'Resultados',
  'paleta.recientes': 'Recientes',
  'paleta.todas': 'Pantallas',
  'paleta.sinResultados': 'Sin resultados.',
} as const;
