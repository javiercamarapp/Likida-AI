'use client';

import { useEffect, useRef } from 'react';
import LogoV2 from './logo-v2';
import { crearControlador, type EstadoCarga } from './controlador-carga';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPA DE CARGA ÚNICA (ESTILO-LIKIDA §9; patrón de `~/vexa`: rovaq-cargando + arranque-limpio).
//
// UNA capa fija (`inset:0; z-index:2000; background:var(--carga-fondo)`) que tapa sidebar, topbar y contenido; SOLO el logo de
// Likida centrado que respira. Sin texto visible (`role=status aria-busy aria-label`), sin spinner, sin barra, sin esqueletos.
//
// CSP / SCRIPT_TEMA: no hay script inline nuevo (el hash de `SCRIPT_TEMA` no se toca y la CSP con nonce no cambia). El primer
// pintado lo da el SERVIDOR: la capa viaja en el HTML con `data-estado="inicial"` y su CSS (`ui-v2/carga.css`) la muestra desde
// el primer fotograma, sin esperar a React. Este controlador cliente solo la SUELTA y la vuelve a levantar en navegaciones lentas:
//   · carga inicial / recarga: se libera cuando, de forma continua durante 600 ms, el documento terminó de llegar y no hay
//     pantalla de carga de página en el DOM, y la capa lleva ≥400 ms visible;
//   · navegación interna: si la pantalla de carga de página (`loading.tsx`) sigue montada tras 250 ms, la capa aparece (en
//     navegaciones rápidas NUNCA aparece); una vez visible dura ≥400 ms; sale con fundido de 170 ms;
//   · seguro de 20 s: se retira y deja «No disponible ahora. No es cero» con «Reintentar».
// El cambio de periodo o de filtro NO levanta la capa (esos estados viven en la tarjeta y no son `loading.tsx`).
// La condición se lee del DOM (no del registro de React): con respuestas lentas el HTML llega por partes y la frontera
// Suspense aún pendiente no se hidrata, pero el DOM del servidor sí trae la pantalla de carga.
// ═══════════════════════════════════════════════════════════════════════════

/** La pantalla de carga de PÁGINA (`cargando.tsx`, vía `loading.tsx`): el estado con el logo respirando. Las tarjetas que cargan sus datos NO cuentan. */
const PENDIENTE = '.rv-contenido [role="status"][aria-label="Cargando"]:has(> .likida-respira)';

export default function CapaCarga() {
  const capa = useRef<HTMLDivElement>(null);
  const error = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = capa.current;
    const err = error.current;
    if (!el || !err) return;
    const ctl = crearControlador({
      hayPendiente: () => document.readyState === 'loading' || document.querySelector(PENDIENTE) !== null,
      documentoCargando: () => document.readyState === 'loading',
      poner: (e: EstadoCarga) => { el.dataset.estado = e === 'tope' ? 'oculta' : e; el.setAttribute('aria-busy', e === 'inicial' || e === 'nav' ? 'true' : 'false'); err.hidden = e !== 'tope'; },
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
        <LogoV2 alto={40} className="rv-respira" />
      </div>
      <div ref={error} className="rv-carga-error" role="alert" hidden>
        <p><strong>No disponible ahora.</strong> No es cero: la consulta no respondió a tiempo.</p>
        <button type="button" className="rv-btn" onClick={() => window.location.reload()}>Reintentar</button>
      </div>
    </>
  );
}
