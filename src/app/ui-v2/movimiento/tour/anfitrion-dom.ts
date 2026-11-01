import { ANCLAS_DERIVADAS } from '@/app/ui-v2/onboarding/anclas';
import type { Anfitrion, ElementoTour, EventoAccion, Rect } from './tipos';

// Anfitrión real: toca document/window. Es el único archivo del motor que lo hace.

const visibleReal = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const e = getComputedStyle(el);
  return e.visibility !== 'hidden' && e.display !== 'none';
};

/** Si `el` vive en una categoría plegada del menú (`.rv-grupo__cuerpo` cuyo botón dice aria-expanded=false), la despliega. */
function abrirGrupoPlegado(el: HTMLElement): void {
  const cuerpo = el.closest('.rv-grupo__cuerpo');
  const id = cuerpo?.getAttribute('aria-labelledby');
  const boton = id ? document.getElementById(id) : null;
  if (boton instanceof HTMLElement && boton.getAttribute('aria-expanded') === 'false') boton.click();
}

function envolver(el: HTMLElement): ElementoTour {
  return {
    rect(): Rect {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    visible: () => el.isConnected && visibleReal(el),
    traerAVista(reducido) {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const movil = window.innerWidth < 640;
      // En móvil el globo es una hoja inferior: el elemento debe quedar en el tercio superior.
      const bien = movil ? r.top >= 56 && r.bottom <= vh * 0.5 : r.top >= 72 && r.bottom <= vh - 72;
      if (bien) return;
      const destino = movil ? r.top - vh * 0.18 : r.top - (vh - r.height) / 2;
      window.scrollBy({ top: destino, behavior: reducido ? 'auto' : 'smooth' });
    },
    enfocar: () => el.focus({ preventScroll: true }),
    escuchar(evento: EventoAccion, fn) {
      el.addEventListener(evento, fn, true);
      return () => el.removeEventListener(evento, fn, true);
    },
  };
}

function almacenLocal() {
  try {
    const a = window.localStorage;
    a.getItem('likida:tour:sonda');
    return a;
  } catch {
    return null; // navegación privada, cookies bloqueadas
  }
}

export function crearAnfitrionDom(extra: { navegar: (ruta: string) => void; rutaActual: () => string }): Anfitrion {
  return {
    buscarAncla(nombre) {
      // `data-onboarding` es el atributo canónico; `data-tour` (menú y anclas anteriores) sigue valiendo; las derivadas son estructura común.
      const derivada = Object.hasOwn(ANCLAS_DERIVADAS, nombre) ? ANCLAS_DERIVADAS[nombre] : null;
      const n = CSS.escape(nombre);
      const lista = document.querySelectorAll<HTMLElement>(derivada ?? `[data-onboarding="${n}"], [data-tour="${n}"]`);
      for (const el of lista) if (visibleReal(el)) return envolver(el);
      // Un ítem del menú escondido en una categoría plegada del sidebar: se despliega (como la persona lo haría) y el motor
      // lo vuelve a buscar en su siguiente intento.
      for (const el of lista) abrirGrupoPlegado(el);
      return null;
    },
    rutaActual: extra.rutaActual,
    navegar: extra.navegar,
    reducirMovimiento: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    programar(fn, ms) {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
    almacen: almacenLocal(),
  };
}
