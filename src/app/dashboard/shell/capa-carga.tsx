'use client';

import { useEffect, useRef } from 'react';
import LogoV2, { PROPORCION_LOGO } from './logo-v2';
import { crearControlador, type EstadoCarga } from './controlador-carga';

// ═══════════════════════════════════════════════════════════════════════════
// EL TELÓN DE CARGA (ESTILO-LIKIDA §9; patrón de `~/vexa`: arranque-limpio) — IGUAL A ROVAQ desde el 10-nov-2026: en la carga, en la
// recarga Y en las navegaciones internas lentas (> 250 ms, mínimo 400 ms visible).
//
// UNA capa fija (`inset:0; z-index:2000; background:var(--carga-fondo)`) que tapa sidebar, topbar y contenido; SOLO el logo de
// Likida centrado (140 px de ancho) que respira. Sin texto visible (`role=status aria-busy aria-label`), sin spinner, sin barra, sin
// contador. Con prefers-reduced-motion el logo queda quieto (carga.css).
//
// CSP / SCRIPT_TEMA: no hay script inline nuevo (el hash de `SCRIPT_TEMA` no se toca y la CSP con nonce no cambia). El primer
// pintado lo da el SERVIDOR: la capa viaja en el HTML con `data-estado="inicial"` y su CSS (`ui-v2/carga.css`) la muestra desde
// el primer fotograma, sin esperar a React. Este controlador cliente la SUELTA y la vuelve a levantar (`data-estado="nav"`):
//   · primera carga de la sesión: se libera cuando, de forma continua durante 600 ms, el documento terminó de llegar y no hay
//     pantalla de carga de página en el DOM, y la capa lleva ≥400 ms visible; sale con fundido de 170 ms;
//   · recarga dentro de la misma sesión: se libera en cuanto el contenido está listo (sin mínimo ni ventana);
//   · navegación interna: si la pantalla de carga de página sigue en el DOM pasados 250 ms, la capa vuelve; se suelta cuando
//     desaparece (150 ms estables, ≥400 ms visible);
//   · seguro de 45 s: se retira y deja «No disponible ahora. No es cero» con «Reintentar».
// La condición se lee del DOM (no del registro de React): con respuestas lentas el HTML llega por partes y la frontera
// Suspense aún pendiente no se hidrata, pero el DOM del servidor sí trae la pantalla de carga.
// ═══════════════════════════════════════════════════════════════════════════

/** Logo del telón: 140 px de ANCHO como Rovaq (`RovaqLogo ancho={140}`); antes 40 px de alto (~195 px de ancho). */
export const ANCHO_LOGO_CARGA = 140;
export const ALTO_LOGO_CARGA = ANCHO_LOGO_CARGA / PROPORCION_LOGO.horizontal;

/** Clave de sessionStorage: ya se mostró el telón en esta sesión del navegador. */
export const CLAVE_TELON = 'likida.telon.visto';

export function leerPrimeraVez(): boolean {
  try { return window.sessionStorage.getItem(CLAVE_TELON) === null; } catch { return true; }
}
export function anotarVista(): void {
  try { window.sessionStorage.setItem(CLAVE_TELON, '1'); } catch { /* sin almacenamiento: el telón vuelve a salir en la siguiente carga */ }
}

/** La marca EXPLÍCITA de la pantalla de carga de PÁGINA (`cargando.tsx`, vía `loading.tsx`). Las tarjetas que cargan sus datos
 *  (ChartState, «Cargando» en línea) NO la llevan, así que no levantan la capa ni se ocultan. Sin `:has`: funciona en cualquier navegador. */
export const MARCA_CARGA_PAGINA = { atributo: 'data-carga', valor: 'pagina' } as const;
export const PENDIENTE = `.rv-contenido [${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"]`;

export default function CapaCarga() {
  const capa = useRef<HTMLDivElement>(null);
  const error = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = capa.current;
    const err = error.current;
    if (!el || !err) return;
    // Foco: el marco queda `visibility:hidden` mientras la capa se ve, así que el foco cae a <body>; se guarda y se restaura al soltar.
    let foco: HTMLElement | null = null;
    const ctl = crearControlador({
      hayPendiente: () => { try { return document.readyState === 'loading' || document.querySelector(PENDIENTE) !== null; } catch { return false; } },
      primeraVez: leerPrimeraVez(),
      marcarVista: anotarVista,
      poner: (e: EstadoCarga) => {
        const visible = e === 'inicial' || e === 'nav';
        const activo = document.activeElement;
        if (visible && activo instanceof HTMLElement && activo !== document.body) foco = activo;
        if (!visible && foco) {
          const f = foco; foco = null;
          // Se restaura tras pintar el marco visible; solo si el foco no fue a otro sitio y el elemento sigue en el documento.
          queueMicrotask(() => { if (f.isConnected && (document.activeElement === document.body || document.activeElement === null)) f.focus({ preventScroll: true }); });
        }
        el.dataset.estado = e === 'tope' ? 'oculta' : e; el.setAttribute('aria-busy', visible ? 'true' : 'false'); err.hidden = e !== 'tope'; },
      ahora: () => Date.now(),
      esperar: (f, ms) => window.setTimeout(f, ms),
      cancelar: (id) => window.clearTimeout(id),
    });
    // Las mutaciones llegan en ráfagas durante la hidratación: se evalúa una vez por ráfaga.
    let programado = false;
    const alCambiar = () => { if (programado) return; programado = true; queueMicrotask(() => { programado = false; ctl.evaluar(); }); };
    const observador = new MutationObserver(alCambiar);
    observador.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('readystatechange', alCambiar);
    ctl.evaluar();
    return () => {
      ctl.destruir();
      observador.disconnect();
      document.removeEventListener('readystatechange', alCambiar);
    };
  }, []);

  return (
    <>
      {/* `data-estado="inicial"` viaja en el HTML del servidor: visible desde el primer fotograma, sin script inline. */}
      <div ref={capa} id="rv-carga" className="rv-carga" data-estado="inicial" role="status" aria-busy="true" aria-label="Cargando">
        <LogoV2 alto={ALTO_LOGO_CARGA} className="rv-respira" />
      </div>
      <div ref={error} className="rv-carga-error" role="alert" hidden>
        <p><strong>No disponible ahora.</strong> No es cero: la consulta no respondió a tiempo.</p>
        <button type="button" className="rv-btn" onClick={() => window.location.reload()}>Reintentar</button>
      </div>
    </>
  );
}
