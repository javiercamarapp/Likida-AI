'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Sun, Monitor, Moon } from 'lucide-react';

const LLAVE = 'likida-tema';

export type Tema = 'claro' | 'sistema' | 'oscuro';

// Mismo patrón que boton-sidebar.tsx (y por las mismas razones): el estado
// vive fuera de React (localStorage + atributo en la raíz), el snapshot del
// servidor es fijo y el cliente se corrige al hidratar.
const oyentes = new Set<() => void>();
function suscribir(cb: () => void): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}
function leerTema(): Tema {
  const v = window.localStorage.getItem(LLAVE);
  return v === 'oscuro' || v === 'sistema' ? v : 'claro';
}

/** `sistema` se resuelve AQUÍ a light/dark: el CSS solo conoce los dos
 *  `[data-theme]` explícitos — así el tema no cambia solo por el ajuste del
 *  sistema operativo salvo que el usuario haya elegido "sistema". */
function aplicar(tema: Tema) {
  const oscuro = tema === 'oscuro'
    || (tema === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
}

const OPCIONES: Array<{ valor: Tema; Icono: typeof Sun; rotulo: string }> = [
  { valor: 'claro', Icono: Sun, rotulo: 'Tema claro' },
  { valor: 'sistema', Icono: Monitor, rotulo: 'Seguir al sistema' },
  { valor: 'oscuro', Icono: Moon, rotulo: 'Tema oscuro' },
];

/**
 * El selector claro / sistema / oscuro (13-ago-2026). Activa los overrides `[data-theme]` que globals.css
 * tenía esperando "para ESE switch, si algún día se construye" — hoy se
 * construyó. El default sigue siendo claro: la decisión del 12-ago (no
 * oscurecer la app solo porque el sistema operativo esté en oscuro) se
 * conserva — "sistema" es una elección explícita del usuario.
 */
export function SelectorTema() {
  const tema = useSyncExternalStore(suscribir, leerTema, () => 'claro' as Tema);

  // Reaplica al montar (el atributo no sobrevive a la navegación dura) y,
  // mientras el usuario esté en "sistema", sigue los cambios del SO en vivo.
  useEffect(() => {
    aplicar(leerTema());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiar = () => { if (leerTema() === 'sistema') aplicar('sistema'); };
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  function elegir(nuevo: Tema) {
    window.localStorage.setItem(LLAVE, nuevo);
    aplicar(nuevo);
    oyentes.forEach((cb) => cb());
  }

  return (
    <div role="radiogroup" aria-label="Tema de la interfaz"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-full hairline"
      style={{ background: 'var(--canvas)' }}>
      {OPCIONES.map(({ valor, Icono, rotulo }) => {
        const activo = tema === valor;
        return (
          <button key={valor} type="button" role="radio" aria-checked={activo}
            aria-label={rotulo} title={rotulo} onClick={() => elegir(valor)}
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${activo ? 'hairline' : ''}`}
            style={activo
              ? { background: 'var(--surface)', color: 'var(--ink)' }
              : { color: 'var(--muted)' }}>
            <Icono width={12} height={12} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
