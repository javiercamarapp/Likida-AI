import type { Alerta } from './calcular-alertas';

// Las alertas no tienen id de base de datos — son un CÁLCULO en vivo
// (`calcularAlertas`), no filas persistidas. "Marcar como leído" es
// entonces un dismissal de UI, no un estado de negocio: se guarda en
// localStorage (por eso vive solo en el navegador de Javier, no cruza de
// dispositivo) con una clave derivada de tipo+texto. Si la condición real
// cambia mañana (el costo sube OTRO %, por ejemplo), el texto cambia y la
// alerta reaparece como no-leída — correcto: es un hecho distinto, no la
// misma alerta de ayer.
const CLAVE_STORAGE = 'likida:notificaciones:leidas';
const EVENTO_CAMBIO = 'likida:notificaciones:cambio';

export function claveAlerta(a: Alerta): string {
  return `${a.tipo}::${a.texto}`;
}

// `useSyncExternalStore` exige que `getSnapshot` devuelva la MISMA
// referencia si nada cambió (si no, cree que la tienda cambió en cada
// render y entra en bucle). Por eso el cache: un nuevo `Set` únicamente
// cuando el string crudo de localStorage de verdad cambió.
export const SIN_LEIDAS = new Set<string>();
let cache: { crudo: string | null; set: Set<string> } | null = null;

export function leerLeidas(): Set<string> {
  if (typeof window === 'undefined') return SIN_LEIDAS;
  let crudo: string | null;
  try {
    crudo = window.localStorage.getItem(CLAVE_STORAGE);
  } catch {
    return SIN_LEIDAS;
  }
  if (cache && cache.crudo === crudo) return cache.set;
  let set: Set<string>;
  try {
    set = new Set(crudo ? (JSON.parse(crudo) as string[]) : []);
  } catch {
    set = new Set();
  }
  cache = { crudo, set };
  return set;
}

function guardarLeidas(leidas: Set<string>) {
  window.localStorage.setItem(CLAVE_STORAGE, JSON.stringify([...leidas]));
  // `storage` solo dispara en OTRAS pestañas — la campana del sidebar y la
  // lista de /admin/notificaciones viven en la MISMA pestaña (mismo
  // layout persistente), así que un evento propio es lo que de verdad las
  // sincroniza sin recargar la página.
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

export function marcarLeida(clave: string) {
  const leidas = leerLeidas();
  leidas.add(clave);
  guardarLeidas(leidas);
}

export function marcarTodasLeidas(claves: string[]) {
  const leidas = leerLeidas();
  claves.forEach((c) => leidas.add(c));
  guardarLeidas(leidas);
}

export function suscribirCambiosLeidas(cb: () => void): () => void {
  window.addEventListener(EVENTO_CAMBIO, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENTO_CAMBIO, cb);
    window.removeEventListener('storage', cb);
  };
}
