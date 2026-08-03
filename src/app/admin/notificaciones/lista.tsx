'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { TriangleAlert, CircleCheck, CheckCheck } from 'lucide-react';
import type { Alerta } from '../calcular-alertas';
import { claveAlerta, leerLeidas, marcarLeida, marcarTodasLeidas, suscribirCambiosLeidas, SIN_LEIDAS } from '../notificaciones-leidas';

const UMBRAL_SWIPE = 72; // px de arrastre horizontal antes de contar como "descartar"

/** Una fila — en escritorio, el botón "Marcar leído"; en táctil, se puede
 *  arrastrar de lado (izquierda o derecha) para descartarla, y al soltar
 *  pasado el umbral se anima saliendo de lado Y HACIA ARRIBA (pedido así
 *  explícitamente) antes de marcarse como leída. Por debajo del umbral,
 *  regresa a su lugar — no se pierde por accidente con un roce. */
function FilaAlerta({ alerta, onLeida }: { alerta: Alerta; onLeida: () => void }) {
  const [dx, setDx] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);
  const [saliendo, setSaliendo] = useState<'izq' | 'der' | null>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    inicio.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setArrastrando(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!inicio.current) return;
    setDx(e.touches[0].clientX - inicio.current.x);
  }
  function onTouchEnd() {
    setArrastrando(false);
    inicio.current = null;
    if (Math.abs(dx) > UMBRAL_SWIPE) {
      setSaliendo(dx > 0 ? 'der' : 'izq');
      setTimeout(onLeida, 260);
    } else {
      setDx(0);
    }
  }

  const transform = saliendo
    ? `translate(${saliendo === 'der' ? 420 : -420}px, -72px) rotate(${saliendo === 'der' ? 6 : -6}deg)`
    : `translateX(${dx}px)`;

  return (
    <div
      className="px-5 py-4 flex items-start gap-3 touch-pan-y"
      style={{
        transform,
        opacity: saliendo ? 0 : 1,
        transition: arrastrando ? 'none' : 'transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 260ms ease',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: alerta.tipo === 'atencion' ? 'color-mix(in srgb, var(--color-bad) 12%, transparent)' : 'color-mix(in srgb, var(--color-ok) 12%, transparent)' }}>
        {alerta.tipo === 'atencion'
          ? <TriangleAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--color-bad)' }} />
          : <CircleCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--color-ok)' }} />}
      </div>
      <p className="text-sm pt-1 flex-1">{alerta.texto}</p>
      <button type="button" onClick={() => { setSaliendo('der'); setTimeout(onLeida, 260); }}
        className="shrink-0 text-xs px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
        Marcar leído
      </button>
    </div>
  );
}

/**
 * Lista real de /admin/notificaciones — "marcar como leído" es dismissal
 * de UI guardado en localStorage (`notificaciones-leidas.ts`), no una
 * tabla nueva: las alertas no tienen id de base de datos, son un cálculo
 * en vivo. En móvil cada fila se puede correr de lado para descartarla; en
 * cualquier tamaño hay un botón "Marcar leído" por fila y uno "Marcar
 * todas como leídas" arriba.
 */
export default function NotificacionesLista({ alertas }: { alertas: Alerta[] }) {
  const leidas = useSyncExternalStore(suscribirCambiosLeidas, leerLeidas, () => SIN_LEIDAS);
  const pendientes = alertas.filter((a) => !leidas.has(claveAlerta(a)));

  function marcar(a: Alerta) {
    marcarLeida(claveAlerta(a));
  }
  function marcarTodas() {
    marcarTodasLeidas(alertas.map(claveAlerta));
  }

  if (alertas.length === 0) {
    return (
      <div className="p-10 text-sm text-center" style={{ color: 'var(--muted)' }}>
        Sin novedades — no hay ninguna condición real que requiera tu atención ahorita.
      </div>
    );
  }

  if (pendientes.length === 0) {
    return (
      <div className="p-10 text-sm text-center" style={{ color: 'var(--muted)' }}>
        Ya marcaste todas como leídas.
      </div>
    );
  }

  return (
    <div>
      <div className="px-5 py-3 flex justify-end border-b" style={{ borderColor: 'var(--line)' }}>
        <button type="button" onClick={marcarTodas}
          className="text-xs font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity inline-flex items-center gap-1.5">
          <CheckCheck width={13} height={13} strokeWidth={1.75} /> Marcar todas como leídas
        </button>
      </div>
      <div className="divide-y overflow-hidden" style={{ borderColor: 'var(--line)' }}>
        {pendientes.map((a) => (
          <FilaAlerta key={claveAlerta(a)} alerta={a} onLeida={() => marcar(a)} />
        ))}
      </div>
    </div>
  );
}
