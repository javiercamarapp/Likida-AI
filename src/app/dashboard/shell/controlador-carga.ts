// El controlador de la capa de carga único, SIN DOM ni React: recibe un «puerto» (¿hay pantalla de carga de página pendiente?,
// poner estado, reloj) y decide cuándo la capa aparece, cuánto dura y cuándo se suelta. Separado de `capa-carga.tsx` para
// probarlo con reloj falso (ESTILO-LIKIDA §9: aparece a >250 ms, ≥400 ms visible, carga inicial se libera tras 600 ms estables,
// seguro de 20 s).

export const VENTANA_ESTABLE_MS = 600;
export const VENTANA_NAVEGACION_MS = 150;
export const RETARDO_NAVEGACION_MS = 250;
export const MINIMO_VISIBLE_MS = 400;
export const TOPE_MS = 20000;

/** inicial / nav = la capa se ve · oculta = no se ve · tope = el seguro venció: capa fuera y «No disponible ahora» a la vista. */
export type EstadoCarga = 'inicial' | 'oculta' | 'nav' | 'tope';

export interface PuertoCarga {
  /** ¿Sigue pendiente la pantalla de carga de página (o el documento aún está llegando)? Se lee del DOM, no del registro de React. */
  hayPendiente: () => boolean;
  /** ¿El documento aún está llegando? (para no levantar la capa en plena carga inicial) */
  documentoCargando: () => boolean;
  poner: (e: EstadoCarga) => void;
  ahora: () => number;
  esperar: (f: () => void, ms: number) => number;
  cancelar: (id: number | undefined) => void;
}

export function crearControlador(p: PuertoCarga) {
  let estado: EstadoCarga = 'inicial';
  let desde = p.ahora();
  let vivo = true;
  let tope: number | undefined;
  let espera: number | undefined;
  let aparicion: number | undefined;

  const poner = (e: EstadoCarga) => { estado = e; p.poner(e); };
  const armarTope = () => {
    p.cancelar(tope);
    tope = p.esperar(() => { if (vivo && (estado === 'inicial' || estado === 'nav')) poner('tope'); }, TOPE_MS);
  };
  const soltar = () => { p.cancelar(tope); p.cancelar(espera); espera = undefined; poner('oculta'); };

  /**
   * Idempotente: se llama en cada ráfaga de mutaciones del DOM (a veces continuas: streaming, contadores, mapas) y NO reinicia
   * nada mientras el estado pendiente/no pendiente no cambie. Solo se (re)arma una ventana cuando cambia el pendiente.
   */
  function evaluar() {
    if (!vivo) return;
    const pendiente = p.hayPendiente();
    if (estado === 'tope') { if (!pendiente) poner('oculta'); return; }
    if (estado === 'inicial' || estado === 'nav') {
      if (pendiente) { p.cancelar(espera); espera = undefined; return; } // volvió a haber algo pendiente: la ventana estable se pierde
      if (espera !== undefined) return;                                  // ya corre una ventana y nada cambió: se deja correr
      const visible = p.ahora() - desde;
      const ventana = estado === 'inicial'
        ? Math.max(VENTANA_ESTABLE_MS, MINIMO_VISIBLE_MS - visible)
        : Math.max(VENTANA_NAVEGACION_MS, MINIMO_VISIBLE_MS - visible);
      espera = p.esperar(() => { espera = undefined; if (vivo && !p.hayPendiente()) soltar(); }, ventana);
      return;
    }
    // oculta: ¿empieza una navegación lenta? Solo aparece si sigue pendiente pasados 250 ms.
    if (!pendiente || p.documentoCargando()) { p.cancelar(aparicion); aparicion = undefined; return; }
    if (aparicion !== undefined) return; // el retardo de 250 ms ya corre
    aparicion = p.esperar(() => {
      aparicion = undefined;
      if (!vivo || estado !== 'oculta' || !p.hayPendiente()) return;
      desde = p.ahora();
      poner('nav');
      armarTope();
    }, RETARDO_NAVEGACION_MS);
  }

  armarTope();
  return {
    evaluar,
    estado: () => estado,
    destruir() { vivo = false; p.cancelar(tope); p.cancelar(espera); p.cancelar(aparicion); },
  };
}
