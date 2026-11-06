import type { PasoGuia, ResultadoSenal } from '@/lib/likida/guia/tipos';

// GUION · Puesta en marcha del dueño con los cinco agentes (pista D5, SPEC-ONBOARDING-GUIA 3 y 6.2).
// BORRADOR PARA REVISIÓN: todos los pasos nacen con `aprobado: false` y NO se publican hasta que Javier los apruebe en
// `docs/guia/TEXTOS-REVISION-LIKIDA.md` (regla 6.2). Sin cifras literales, sin signos de exclamación, sin emoji; lo que no se puede
// medir se declara y se rotula «confirmado por ti». El código jamás nombra a un cliente.

const PANTALLA = '/dashboard/puesta-en-marcha';
const base = { version: 1, pista: 'dueno_ca', pantalla: PANTALLA, perfil: 'cinco_agentes', aprobado: false } as const;

export const PASOS_PM: readonly PasoGuia[] = [
  {
    ...base, id: 'PM1-01', ancla: null, tipo: 'orientar', visual: { tipo: 'ilu', id: 'lista' }, deteccion: { via: 'ninguna' },
    titulo: 'Tu puesta en marcha, paso a paso',
    texto: 'Likida marca solo lo que puede comprobar. Lo que no puede medir lo confirmas tú y queda rotulado.',
    ayuda: 'Puedes salir cuando quieras y volver desde la Guía: retomas en el último paso que no hiciste, en cualquier equipo.',
  },
  {
    ...base, id: 'PM2-01', ancla: 'asistente.detalle', tipo: 'hacer', visual: { tipo: 'ilu', id: 'equipo' },
    titulo: 'Invita a quien coordina tu operación',
    texto: 'Esa persona ve viajes, mapa y documentos, pero no el dinero. Invítala desde Usuarios.',
    accion: { verbo: 'Aprieta', objetivo: 'Invitar a mi equipo' },
    deteccion: { via: 'senal', senal: 'coordinadores', modo: 'cambia' },
  },
  {
    ...base, id: 'PM3-01', ancla: 'asistente.como-conseguirlo', tipo: 'hacer', visual: { tipo: 'ilu', id: 'conectar' },
    titulo: 'Conecta tu sistema de transporte',
    texto: 'Pide a tu área de sistemas el acceso y prueba la conexión. Aquí tienes el texto listo para mandarles.',
    accion: { verbo: 'Aprieta', objetivo: 'Cómo conseguirlo' },
    deteccion: { via: 'senal', senal: 'tms_probada', modo: 'cambia' },
    ayuda: 'Mientras llega el acceso puedes subir un archivo de muestra: el paso sigue en espera de tu área de sistemas, no de ti.',
  },
  {
    ...base, id: 'PM4-01', ancla: 'asistente.detalle', tipo: 'hacer', visual: { tipo: 'ilu', id: 'correo' },
    titulo: 'Activa el desglose por correo',
    texto: 'Likida le manda a cada operador su desglose por correo. Activa el envío y mándate una prueba para ver cómo llega.',
    accion: { verbo: 'Aprieta', objetivo: 'Mandarme una prueba' },
    deteccion: { via: 'senal', senal: 'correo_desglose_activo', modo: 'cambia' },
  },
  {
    ...base, id: 'PM5-01', ancla: 'asistente.detalle', tipo: 'hacer', visual: { tipo: 'ilu', id: 'equipo' },
    titulo: 'Revisa que tus operadores tengan correo',
    texto: 'Sin correo no hay a dónde mandar el desglose. Completa el correo de cada operador activo.',
    accion: { verbo: 'Aprieta', objetivo: 'Revisar operadores' },
    deteccion: { via: 'senal', senal: 'operadores_con_correo', modo: 'cambia' },
  },
  {
    ...base, id: 'PM6-01', ancla: 'asistente.detalle', tipo: 'hacer', visual: { tipo: 'ilu', id: 'documento' },
    titulo: 'Designa quién revisa la Carta Porte',
    texto: 'Alguien debe revisar cada borrador antes de que salga. Elige a esa persona en la configuración de Carta Porte.',
    accion: { verbo: 'Aprieta', objetivo: 'Elegir revisor' },
    deteccion: { via: 'senal', senal: 'revisor_cp', modo: 'cambia' },
  },
  {
    ...base, id: 'PM7-01', ancla: 'asistente.detalle', tipo: 'practicar', visual: { tipo: 'ilu', id: 'reloj' },
    titulo: 'Haz un simulacro con datos de muestra',
    texto: 'Mándate un desglose de muestra y revisa cómo lo ve tu operador. Likida todavía no lo puede medir: lo confirmas tú.',
    accion: { verbo: 'Aprieta', objetivo: 'Ya lo hice y funcionó' },
    deteccion: { via: 'declarada', clave: 'simulacroVisto' },
  },
  {
    ...base, id: 'PM9-99', ancla: null, tipo: 'cierre', visual: { tipo: 'ilu', id: 'celebrar' }, deteccion: { via: 'ninguna' },
    // Texto por omisión = el honesto: no afirma una conexión que nadie comprobó. `cierreDePuestaEnMarcha` da el de «conectada».
    titulo: 'Lo tuyo está listo; falta conectar el sistema',
    texto: 'Lo que Likida pudo medir quedó marcado como hecho; lo que confirmaste tú, como confirmado. Vuelve aquí cuando quieras.',
  },
];

/** Cierre cuando la conexión sí está comprobada (prueba de conexión del TMS en `si` Y datos llegando). */
export const CIERRE_CONECTADO = { titulo: 'Listo: tu operación está conectada' } as const;

/**
 * Título del cierre según lo que MIDE el servidor. «Conectada» solo con `tms_probada` y `archivos_recibidos` ambas en `si`:
 * omitida, `no` o `sin_dato` en cualquiera cae al texto que dice que falta la conexión.
 */
export function cierreDePuestaEnMarcha(senales: Partial<Record<'tms_probada' | 'archivos_recibidos', ResultadoSenal>>): { titulo: string; texto: string } {
  const cierre = PASOS_PM[PASOS_PM.length - 1];
  const conectada = senales.tms_probada?.estado === 'si' && senales.archivos_recibidos?.estado === 'si';
  return { titulo: conectada ? CIERRE_CONECTADO.titulo : cierre.titulo, texto: cierre.texto };
}
