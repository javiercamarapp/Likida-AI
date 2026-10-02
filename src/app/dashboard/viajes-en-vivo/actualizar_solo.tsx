'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { CADA_SEG_POR_OMISION, puedeRefrescar } from './refresco';

/**
 * «Viajes en vivo» se refresca solo (P6): cada `cadaSeg` segundos pide al servidor el tablero de nuevo (`router.refresh()`, que conserva lo que la persona
 * esté escribiendo en la caja del asistente: el estado del cliente no se pierde). Reglas, para no gastar ni estorbar:
 *   · NO refresca con la pestaña oculta; al volver a verla refresca de inmediato si ya tocaba.
 *   · NO refresca mientras hay un campo con foco (alguien escribiendo o con un menú abierto).
 *   · Un solo temporizador; se limpia al salir.
 *   · Lleva su botón «Actualizar ahora» y dice cuándo fue la última vez, de modo que un tablero detenido no se vea como vivo.
 */
export function ActualizarSolo({ cadaSeg = CADA_SEG_POR_OMISION }: { cadaSeg?: number }) {
  const router = useRouter();
  const [ultima, setUltima] = useState<Date | null>(null);
  const [pausado, setPausado] = useState(false);
  const refrescando = useRef(false);

  const refrescar = useCallback((forzar: boolean) => {
    const activo = typeof document !== 'undefined' ? document.activeElement : null;
    if (!puedeRefrescar({
      forzar, refrescando: refrescando.current,
      visible: typeof document === 'undefined' || document.visibilityState !== 'hidden', tagActivo: activo ? activo.tagName : null,
    })) return;
    refrescando.current = true;
    try { router.refresh(); setUltima(new Date()); } finally { setTimeout(() => { refrescando.current = false; }, 1_000); }
  }, [router]);

  useEffect(() => {
    if (pausado || cadaSeg <= 0) return undefined;
    const id = setInterval(() => refrescar(false), cadaSeg * 1_000);
    const alVolver = () => { if (document.visibilityState === 'visible') refrescar(false); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
  }, [cadaSeg, pausado, refrescar]);

  return (
    <div className="inline-flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }} aria-live="off">
      <span>{pausado ? 'Actualización automática en pausa' : `Se actualiza solo cada ${cadaSeg} s`}{ultima ? ` · última vez ${ultima.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>
      <button type="button" onClick={() => refrescar(true)} className="hairline rounded-lg px-2 h-7 inline-flex items-center gap-1"><RefreshCw size={12} aria-hidden /> Actualizar ahora</button>
      <button type="button" onClick={() => setPausado((p) => !p)} className="underline">{pausado ? 'Reanudar' : 'Pausar'}</button>
    </div>
  );
}
