import type { errores as erroresEs } from '../es/errores';

// «errores» en inglés (US). El tipo exige EXACTAMENTE las claves de es.
export const errores: Record<keyof typeof erroresEs, string> = {
  'panel.titulo': 'The panel could not be loaded',
  'panel.apoyo': 'There was a problem reading the data, which is not the same as having no data. Try again; if it persists, share the code with support.',
  'admin.titulo': 'This area could not be loaded',
  'admin.apoyo': 'The rest of the console may still be available. Try again; if it continues, share the code with support.',
  'agente.titulo': 'This agent could not be loaded',
  'agente.apoyo': 'There was a problem reading the data, which is not the same as having no data. Try again; if it persists, share the code with support.',
  'flota.titulo': 'You switched fleets',
  'flota.cuerpo': 'The fleet you are viewing changed since you opened this screen (another tab picked a different fleet). Nothing was saved: reload the page and try again.',
  'chunk.titulo': 'Likida was updated',
  'chunk.apoyo': 'There is a new version and this screen is running old code. Reload the page to continue.',
  'recargando.titulo': 'Reloading',
  'recargando.apoyo': 'There is a new version of Likida; the page reloads on its own.',
  'accion.reintentar': 'Try again',
  'accion.recargar': 'Reload',
  'accion.inicio': 'Back to home',
  'accion.resumen': 'Go to summary',
  'codigo.rotulo': 'Incident code',
  'raiz.rotulo': 'Something broke',
  'raiz.titulo': 'The application could not continue.',
  'raiz.apoyo': 'Try again in a moment. If it stays the same, the code below is exactly what support needs to find out what happened.',
  'raiz.pie': 'Likida · Trip settlement over WhatsApp',
};
