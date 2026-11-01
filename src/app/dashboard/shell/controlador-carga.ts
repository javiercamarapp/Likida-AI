// El controlador del TELÓN de carga, SIN DOM ni React: recibe un «puerto» (¿hay pantalla de carga de página pendiente?, poner estado,
// reloj, ¿es la primera carga de esta sesión?) y decide cuánto dura y cuándo se suelta. Separado de `capa-carga.tsx` para probarlo con
// reloj falso.
//
// DECISIÓN DE JAVIER (31-oct-2026): el telón con el logo a pantalla completa es SOLO de la primera carga de la sesión. Las
// navegaciones internas y las tarjetas que esperan sus datos muestran esqueletos con la forma real (`EsqPagina`, `Esq*`), nunca el
// telón. En una recarga dentro de la misma sesión el telón (que viaja en el HTML del servidor) se suelta en cuanto el contenido está listo.

/** Primera carga: el contenido debe estar estable este tiempo seguido antes de soltar el telón. */
export const VENTANA_ESTABLE_MS = 600;
/** Primera carga: el telón dura al menos esto una vez visible. */
export const MINIMO_VISIBLE_MS = 400;
/** Seguro: pasado este tiempo el telón se retira y queda «No disponible ahora. No es cero» con Reintentar. */
export const TOPE_MS = 20000;

/** inicial = el telón se ve · oculta = no se ve · tope = el seguro venció: telón fuera y «No disponible ahora» a la vista. */
export type EstadoCarga = 'inicial' | 'oculta' | 'tope';

export interface PuertoCarga {
  /** ¿Sigue pendiente la pantalla de carga de página (o el documento aún está llegando)? Se lee del DOM, no del registro de React. */
  hayPendiente: () => boolean;
  poner: (e: EstadoCarga) => void;
  ahora: () => number;
  esperar: (f: () => void, ms: number) => number;
  cancelar: (id: number | undefined) => void;
  /** ¿Es la primera carga de esta sesión del navegador? (sessionStorage; si no se puede leer, sí.) */
  primeraVez: boolean;
  /** Se llama al soltar el telón: deja anotado que la sesión ya lo vio. */
  marcarVista: () => void;
}

export function crearControlador(p: PuertoCarga) {
  let estado: EstadoCarga = 'inicial';
  const desde = p.ahora();
  let vivo = true;
  let espera: number | undefined;
  // El seguro: pasado TOPE_MS el telón se retira y queda «No disponible ahora».
  const tope = p.esperar(() => { if (vivo && estado === 'inicial') poner('tope'); }, TOPE_MS);

  const poner = (e: EstadoCarga) => { estado = e; p.poner(e); };
  const soltar = () => { p.cancelar(tope); p.cancelar(espera); espera = undefined; p.marcarVista(); poner('oculta'); };

  /**
   * Idempotente: se llama en cada ráfaga de mutaciones del DOM (a veces continuas: streaming, contadores, mapas) y NO reinicia
   * nada mientras el estado pendiente/no pendiente no cambie. Solo se (re)arma una ventana cuando cambia el pendiente.
   */
  function evaluar() {
    if (!vivo) return;
    const pendiente = p.hayPendiente();
    if (estado === 'tope') { if (!pendiente) poner('oculta'); return; }
    if (estado !== 'inicial') return; // oculta: el telón NO vuelve (ni en navegaciones lentas): ahí van los esqueletos
    if (pendiente) { p.cancelar(espera); espera = undefined; return; } // volvió a haber algo pendiente: la ventana estable se pierde
    if (espera !== undefined) return;                                  // ya corre una ventana y nada cambió: se deja correr
    const visible = p.ahora() - desde;
    const ventana = p.primeraVez ? Math.max(VENTANA_ESTABLE_MS, MINIMO_VISIBLE_MS - visible) : 0;
    espera = p.esperar(() => { espera = undefined; if (vivo && !p.hayPendiente()) soltar(); }, ventana);
  }

  return {
    evaluar,
    estado: () => estado,
    destruir() { vivo = false; p.cancelar(tope); p.cancelar(espera); },
  };
}
