'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ControladorTour } from './controlador';
import { rectFoco } from './geometria';
import { GloboTour } from './globo';

// La capa visual del recorrido (foco con atenuación, como la guía de Vexa): una capa que NO recibe clics —la persona puede usar el
// elemento y la página mientras el recorrido está abierto—, un recorte con anillo de tinta cuya posición se escribe por CSSOM
// (`style.setProperty`, que la CSP permite), una etiqueta «Haz clic aquí: …» junto al elemento real y un aviso «Ahora: …» al entrar
// a una pantalla nueva. La tarjeta se ancla al lado contrario del elemento para no taparlo (siempre abajo en pantallas estrechas).
// Teclado: Esc cierra y conserva el paso; ←/→ solo si el foco está dentro de la tarjeta; nunca se roban teclas a quien escribe.

const RELLENO = 6;
const GAP = 10;
const MARGEN = 8;
const ESTRECHA = 767;

const esCampo = (el: Element | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"], [role="tab"]'));

export function CapaTour({ controlador }: { controlador: ControladorTour }) {
  const snap = useSyncExternalStore(controlador.suscribir.bind(controlador), () => controlador.instantanea(), () => controlador.instantanea());
  const tarjeta = useRef<HTMLElement | null>(null);
  const capa = useRef<HTMLDivElement | null>(null);
  const etiqueta = useRef<HTMLDivElement | null>(null);
  const previo = useRef<Element | null>(null);
  const activo = snap.fase === 'activo';
  const paso = snap.paso;
  const pasoId = paso?.id;
  const hayElemento = activo && snap.anclaLista === true && paso?.tipo !== 'cierre' && Boolean(paso?.ancla);

  // El foco previo se devuelve al cerrar.
  useEffect(() => {
    if (!activo) return;
    previo.current = document.activeElement;
    return () => {
      if (previo.current instanceof HTMLElement && previo.current.isConnected) previo.current.focus({ preventScroll: true });
    };
  }, [activo]);

  // Seguir al elemento real: scroll, tamaño y animaciones. Recorte, anillo y etiqueta por CSSOM, solo cuando algo cambia.
  useEffect(() => {
    const c = capa.current;
    if (!c) return;
    const el = hayElemento ? controlador.elementoActual : null;
    if (!el) { c.setAttribute('data-sin-foco', ''); etiqueta.current?.style.setProperty('visibility', 'hidden'); tarjeta.current?.removeAttribute('data-lado'); return; }
    let cuadro = 0;
    let ultima = '';
    let primera = true;
    const medir = () => {
      cuadro = requestAnimationFrame(medir);
      if (!el.visible()) { c.setAttribute('data-sin-foco', ''); return; }
      const vp = { w: window.innerWidth, h: window.innerHeight };
      const r = rectFoco(el.rect(), vp, RELLENO);
      const e = etiqueta.current;
      const w = e?.offsetWidth ?? 0;
      const h = e?.offsetHeight ?? 0;
      const clave = [r.x, r.y, r.w, r.h, w, h, vp.w, vp.h].map(Math.round).join(',');
      if (clave === ultima) return;
      ultima = clave;
      c.style.setProperty('--tour-x', `${Math.round(r.x)}px`);
      c.style.setProperty('--tour-y', `${Math.round(r.y)}px`);
      c.style.setProperty('--tour-w', `${Math.round(r.w)}px`);
      c.style.setProperty('--tour-h', `${Math.round(r.h)}px`);
      c.removeAttribute('data-sin-foco');
      if (primera) { primera = false; requestAnimationFrame(() => c.setAttribute('data-animar', '')); }
      if (e) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const cabe = { abajo: r.y + r.h + GAP + h < vp.h - MARGEN, arriba: r.y - GAP - h > MARGEN, der: r.x + r.w + GAP + w < vp.w - MARGEN, izq: r.x - GAP - w > MARGEN };
        const lado = (['abajo', 'arriba', 'der', 'izq'] as const).find((l) => cabe[l]) ?? 'abajo';
        const x = lado === 'der' ? r.x + r.w + GAP : lado === 'izq' ? r.x - GAP - w : cx - w / 2;
        const y = lado === 'abajo' ? r.y + r.h + GAP : lado === 'arriba' ? r.y - GAP - h : cy - h / 2;
        e.style.setProperty('--lab-x', `${Math.round(Math.max(MARGEN, Math.min(x, vp.w - w - MARGEN)))}px`);
        e.style.setProperty('--lab-y', `${Math.round(Math.max(MARGEN, Math.min(y, vp.h - h - MARGEN)))}px`);
        e.setAttribute('data-lado', lado);
        e.style.setProperty('visibility', 'visible');
      }
      // La tarjeta va al lado contrario del elemento para no taparlo (en pantallas estrechas siempre abajo, a todo el ancho).
      if (vp.w > ESTRECHA) tarjeta.current?.setAttribute('data-lado', r.x + r.w / 2 > vp.w / 2 ? 'izq' : 'der');
    };
    medir();
    return () => cancelAnimationFrame(cuadro);
  }, [controlador, hayElemento, pasoId]);

  // Foco: pasa al botón principal solo si estaba en la tarjeta, en el cuerpo o en el menú; nunca se le quita a quien escribe.
  useEffect(() => {
    if (!activo) return;
    const a = document.activeElement;
    const libre = !a || a === document.body || tarjeta.current?.contains(a) || Boolean(a.closest?.('nav, [role="menu"]'));
    if (libre && !esCampo(a)) tarjeta.current?.querySelector<HTMLElement>('[data-onb-primario]')?.focus({ preventScroll: true });
  }, [activo, pasoId]);

  // Teclado: Esc cierra conservando el paso; ←/→ solo dentro de la tarjeta y sin modificadores.
  useEffect(() => {
    if (!activo) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { if (esCampo(document.activeElement) && !tarjeta.current?.contains(document.activeElement)) return; e.preventDefault(); controlador.masTarde(); return; }
      if (!tarjeta.current?.contains(document.activeElement) || esCampo(document.activeElement)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); controlador.siguiente(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); controlador.atras(); }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [activo, controlador]);

  if (!activo || !paso) return null;
  const centrada = paso.tipo === 'cierre' || snap.anclaLista === false || !paso.ancla;
  const nombreEl = paso.tipo === 'ir' ? paso.nombrePantalla : paso.accion?.objetivo;
  const conEtiqueta = hayElemento && Boolean(nombreEl) && (paso.tipo === 'ir' || paso.avance?.tipo === 'accion' || Boolean(paso.accion));

  return (
    <div className="rv-tour" data-ui="v2" data-reducido={snap.reducirMovimiento || undefined}>
      <div ref={capa} className="rv-onb-capa" data-sin-foco data-scrim={centrada || undefined} aria-hidden="true">
        <div className="rv-onb-foco" />
      </div>
      {conEtiqueta ? (
        <div ref={etiqueta} className="rv-onb-etiqueta" aria-hidden="true">
          <span className="rv-onb-etiqueta__in">
            <svg className="rv-onb-etiqueta__flecha" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            {paso.tipo === 'ir' || paso.avance?.tipo === 'accion' ? `Haz clic aquí: ${nombreEl}` : `Aquí: ${nombreEl}`}
          </span>
        </div>
      ) : null}
      {paso.tipo !== 'cierre' && paso.nombrePantalla ? <div key={snap.grupo} className="rv-onb-banner" aria-hidden="true">Ahora: {paso.nombrePantalla}</div> : null}
      <GloboTour
        snap={snap}
        centrada={centrada}
        refGlobo={tarjeta}
        onSiguiente={() => controlador.siguiente()}
        onAtras={() => controlador.atras()}
        onSaltar={() => controlador.saltar()}
        onMasTarde={() => controlador.masTarde()}
        onIrAlElemento={() => controlador.elementoActual?.enfocar()}
      />
    </div>
  );
}
