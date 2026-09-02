// ═══════════════════════════════════════════════════════════════════════════
// "LEÍDAS" DE LAS ALERTAS DE LA FLOTA
//
// Las alertas son un CÁLCULO en vivo (`calcularAlertasFlota`), no filas de una
// tabla: no existe un `notificacion.id` que marcar en la base. Así que "marcar
// leído" es un descarte de INTERFAZ, y vive en localStorage.
//
// Llave propia, separada de la de /admin (`likida:notificaciones:leidas`) a
// propósito: el contralor de una flota y el superadmin son personas distintas
// mirando hechos distintos. Compartir la llave haría que Javier "leyera" por
// accidente las alertas de un cliente, o al revés.
//
// La llave de cada alerta es su `id`, que ya carga el conteo adentro
// (`huerfanos:3`). Consecuencia buscada: si mañana hay 5 huérfanos, el id
// cambia y la alerta REAPARECE como nueva. Es correcto — 5 huérfanos no son
// "los mismos 3 que ya vi".
//
// Nota de deuda: /admin tiene su propia copia de esta mecánica
// (`admin/notificaciones-leidas.ts`), sin pruebas. Cuando alguien la toque,
// esta es la versión con pruebas a la cual migrar — no al revés.
// ═══════════════════════════════════════════════════════════════════════════

const CLAVE_STORAGE = 'likida:alertas-flota:leidas';
const EVENTO_CAMBIO = 'likida:alertas-flota:cambio';

/**
 * H47 (auditoría 24): tope del set de "leídas".
 *
 * El comentario de arriba lo dice: la llave de cada alerta CARGA SU CONTEO
 * (`huerfanos:3`), y por diseño "si mañana hay 5 huérfanos, el id cambia y
 * la alerta REAPARECE" — eso es correcto para la campana, pero tiene un
 * costo que nadie pagaba: el id VIEJO (`huerfanos:3`) nunca se borra de
 * `leidas`, solo se le suma el nuevo. A 500 viajes/día, con varios tipos de
 * alerta cuyo conteo cambia varias veces al día, el arreglo que
 * `JSON.stringify` serializa en CADA clic crece sin límite mientras el mismo
 * navegador siga abriendo el panel — meses de uso real acumulan miles de ids
 * muertos que ya no corresponden a ninguna alerta posible, y cada lectura/
 * escritura los vuelve a parsear/serializar completos. `MAX_LEIDAS` topa el
 * costo sin cambiar el comportamiento visible: solo se podan los ids MÁS
 * VIEJOS (los `Set` de JS conservan orden de inserción), nunca los
 * recientes, así que una alerta marcada hace un minuto no puede reaparecer
 * por la poda.
 */
const MAX_LEIDAS = 500;

/** Referencia estable para el caso "no hay nada leído": `useSyncExternalStore`
 *  entra en bucle si `getSnapshot` devuelve un objeto nuevo en cada render. */
export const SIN_LEIDAS: ReadonlySet<string> = new Set<string>();

let cache: { crudo: string | null; set: Set<string> } | null = null;

/** Solo para las pruebas: el cache es de módulo y sobrevive entre casos. */
export function _limpiarCache() {
  cache = null;
}

export function leerLeidas(): ReadonlySet<string> {
  if (typeof window === 'undefined') return SIN_LEIDAS;

  let crudo: string | null;
  try {
    crudo = window.localStorage.getItem(CLAVE_STORAGE);
  } catch {
    // Safari en privado tira al leer. Un almacenamiento caído significa "no
    // sé qué leyó" — y ahí la respuesta honesta es enseñar TODO, no esconder.
    return SIN_LEIDAS;
  }

  if (cache && cache.crudo === crudo) return cache.set;

  let set: Set<string>;
  try {
    const parsed = crudo ? JSON.parse(crudo) : [];
    // Un localStorage corrupto (o de otra versión) no debe tumbar la campana.
    set = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    set = new Set();
  }
  cache = { crudo, set };
  return set;
}

function guardar(leidas: Set<string>) {
  // H47: poda los ids más viejos si se pasó del tope — `[...leidas]`
  // conserva el orden de inserción, así que `.slice(-MAX_LEIDAS)` se queda
  // con los MÁS RECIENTES y descarta la cola vieja.
  const acotadas = leidas.size > MAX_LEIDAS ? new Set([...leidas].slice(-MAX_LEIDAS)) : leidas;
  try {
    window.localStorage.setItem(CLAVE_STORAGE, JSON.stringify([...acotadas]));
  } catch {
    // Cuota llena o modo privado: el descarte se pierde al recargar. Preferible
    // a romper el clic — la alerta reaparece, que es el lado seguro del error.
  }
  // `storage` solo dispara en OTRAS pestañas. La campana y la lista viven en
  // la misma, así que el evento propio es lo que de verdad las sincroniza.
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

export function marcarLeida(id: string) {
  const leidas = new Set(leerLeidas());
  leidas.add(id);
  guardar(leidas);
}

export function marcarTodasLeidas(ids: string[]) {
  const leidas = new Set(leerLeidas());
  ids.forEach((id) => leidas.add(id));
  guardar(leidas);
}

export function suscribirCambios(cb: () => void): () => void {
  window.addEventListener(EVENTO_CAMBIO, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENTO_CAMBIO, cb);
    window.removeEventListener('storage', cb);
  };
}
