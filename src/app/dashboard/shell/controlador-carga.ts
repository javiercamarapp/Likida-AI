// El controlador del TELÓN de carga, SIN DOM ni React: recibe un «puerto» (¿hay pantalla de carga de página pendiente?, poner estado,
// reloj, ¿es la primera carga de esta sesión?) y decide cuánto dura y cuándo se suelta. Separado de `capa-carga.tsx` para probarlo con
// reloj falso.
//
// DECISIÓN DEL DUEÑO (10-nov-2026, reemplaza la de Javier del 31-oct): el telón con el logo es IGUAL A ROVAQ (`arranque-limpio.tsx`):
//   · carga y recarga: visible desde el HTML del servidor; se suelta tras una ventana estable (600 ms la primera vez en la sesión);
//   · NAVEGACIÓN INTERNA: si la pantalla de carga de página sigue pendiente pasados 250 ms (RETARDO_NAVEGACION_MS), el telón vuelve
//     (en navegaciones rápidas nunca aparece); una vez visible dura al menos 400 ms para no destellar;
//   · seguro de 45 s (TOPE_MS): el telón se retira y queda «No disponible ahora. No es cero» con Reintentar.
// Con prefers-reduced-motion el logo queda estático (lo resuelve carga.css); aquí no hay movimiento.

/** Primera carga: el contenido debe estar estable este tiempo seguido antes de soltar el telón. */
export const VENTANA_ESTABLE_MS = 600;
/** Navegación: una vez cumplido el mínimo, el contenido debe estar estable este tiempo antes de soltar. */
export const VENTANA_NAVEGACION_MS = 150;
/** Navegación: la pantalla de carga debe seguir pendiente tanto como esto para que el telón aparezca. */
export const RETARDO_NAVEGACION_MS = 250;
/** El telón dura al menos esto una vez visible. */
export const MINIMO_VISIBLE_MS = 400;
/** Seguro: pasado este tiempo el telón se retira y queda «No disponible ahora. No es cero» con Reintentar. */
export const TOPE_MS = 45000;

/** inicial = telón de la carga/recarga · nav = telón de una navegación lenta · oculta = no se ve · tope = venció el seguro: telón fuera y «No disponible ahora». */
export type EstadoCarga = 'inicial' | 'nav' | 'oculta' | 'tope';

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
  let desde = p.ahora();
  let vivo = true;
  let espera: number | undefined;
  let aparicion: number | undefined;
  let tope: number | undefined;

  const poner = (e: EstadoCarga) => { estado = e; p.poner(e); };
  const armarTope = () => {
    p.cancelar(tope);
    tope = p.esperar(() => { if (vivo && (estado === 'inicial' || estado === 'nav')) poner('tope'); }, TOPE_MS);
  };
  const soltar = () => { p.cancelar(tope); p.cancelar(espera); espera = undefined; p.marcarVista(); poner('oculta'); };
  armarTope();

  /**
   * Idempotente: se llama en cada ráfaga de mutaciones del DOM (a veces continuas: streaming, contadores, mapas) y NO reinicia
   * nada mientras el estado pendiente/no pendiente no cambie. Solo se (re)arma una ventana cuando cambia el pendiente.
   */
  function evaluar() {
    if (!vivo) return;
    const pendiente = p.hayPendiente();
    if (estado === 'tope') { if (!pendiente) poner('oculta'); return; } // con el seguro vencido no vuelve el telón hasta que haya pasado la carga

    if (estado === 'oculta') {
      // Navegación interna: solo aparece si la pantalla de carga sigue ahí pasados RETARDO_NAVEGACION_MS.
      if (!pendiente) { p.cancelar(aparicion); aparicion = undefined; return; }
      if (aparicion !== undefined) return;
      aparicion = p.esperar(() => {
        aparicion = undefined;
        if (!vivo || estado !== 'oculta' || !p.hayPendiente()) return;
        desde = p.ahora();
        poner('nav');
        armarTope();
      }, RETARDO_NAVEGACION_MS);
      return;
    }

    // inicial | nav: el telón está a la vista.
    if (pendiente) { p.cancelar(espera); espera = undefined; return; } // volvió a haber algo pendiente: la ventana estable se pierde
    if (espera !== undefined) return;                                  // ya corre una ventana y nada cambió: se deja correr
    const visible = p.ahora() - desde;
    const ventana = estado === 'inicial'
      ? (p.primeraVez ? Math.max(VENTANA_ESTABLE_MS, MINIMO_VISIBLE_MS - visible) : 0)
      : Math.max(VENTANA_NAVEGACION_MS, MINIMO_VISIBLE_MS - visible);
    espera = p.esperar(() => { espera = undefined; if (vivo && !p.hayPendiente()) soltar(); }, ventana);
  }

  return {
    evaluar,
    estado: () => estado,
    destruir() { vivo = false; p.cancelar(tope); p.cancelar(espera); p.cancelar(aparicion); },
  };
}
