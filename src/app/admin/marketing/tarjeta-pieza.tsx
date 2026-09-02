'use client';

import { useActionState, useState } from 'react';
import { Check, X } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { StatusPill } from '../ui/kit';
// Del módulo PURO (`piezas.ts`), no de `estudio.ts` — ese último importa
// `supabaseAdmin` y, con él, built-ins de Node que el bundle del navegador
// no puede resolver (ver la cabecera de `piezas.ts`).
import { partirCopyPorCanal, type PiezaEstudio } from '@/lib/likida/marketing/piezas';

export type ResultadoPublicar = { ok?: string; error?: string } | null;
export type AccionPublicar = (previo: ResultadoPublicar, fd: FormData) => Promise<ResultadoPublicar>;

const ETIQUETA_TIPO: Record<string, string> = {
  guion_video: 'Guion de video',
  carrusel_noticias: 'Carrusel del mercado',
  promo_diaria: 'Promo del día',
  encargo_visual: 'Encargo visual',
  encargo_video_demo: 'Encargo de video demo',
  encargo_video_marketing: 'Encargo de reel',
};

/**
 * UNA pieza del estudio como tarjeta: el copy por canal cuando el agente lo
 * marcó así (`promos_diarias`), el cuerpo completo cuando no (un guion o un
 * encargo no son "copy por canal" — partirCopyPorCanal() devuelve `null` y
 * aquí se respeta, no se inventa una estructura). Publicar = `aprobarPieza`
 * de `agentes/cola.ts`, el MISMO mecanismo que usa /admin/aprobaciones — no
 * hay un segundo camino de publicación.
 */
export function TarjetaPieza({ pieza, publicar, rechazar }: {
  pieza: PiezaEstudio;
  publicar: AccionPublicar;
  rechazar: AccionPublicar;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoPublicar, FormData>(
    async (previo, fd) => (String(fd.get('operacion')) === 'rechazar' ? rechazar(previo, fd) : publicar(previo, fd)),
    null,
  );
  const [rechazando, setRechazando] = useState(false);
  const bloques = partirCopyPorCanal(pieza.cuerpo);

  if (estado?.ok) {
    return (
      <div className="hairline rounded-lg px-3 py-2.5 text-[12.5px]" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
        {estado.ok}
      </div>
    );
  }

  return (
    <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-medium">{pieza.titulo}</span>
        <StatusPill estado="neutral">{ETIQUETA_TIPO[pieza.tipo] ?? pieza.tipo}</StatusPill>
        <span className="cifra-mono text-[11px]" style={{ color: 'var(--faint)' }}>{pieza.agente}</span>
        <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--faint)' }}>{fechaHoraMx(pieza.creadoEn)}</span>
      </div>

      {bloques === null ? (
        <pre className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto rounded-lg px-3 py-2 hairline"
          style={{ background: 'var(--canvas)', fontFamily: 'inherit' }}>
          {pieza.cuerpo}
        </pre>
      ) : (
        <div className="mt-2 space-y-2">
          {bloques.map((b) => (
            <div key={b.canal} className="rounded-lg px-3 py-2 hairline" style={{ background: 'var(--canvas)' }}>
              <p className="text-[10.5px] uppercase font-semibold tracking-wide m-0" style={{ color: 'var(--muted)' }}>{b.canal}</p>
              <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap mt-1 m-0">{b.texto}</p>
            </div>
          ))}
        </div>
      )}

      {estado?.error && <p className="text-[12px] mt-2" style={{ color: 'var(--bad)' }}>{estado.error}</p>}

      <form action={enviar} className="mt-2.5 space-y-2">
        <input type="hidden" name="pieza" value={pieza.id} />
        {rechazando && (
          <input name="motivo" placeholder="Motivo del rechazo (obligatorio)"
            className="w-full text-[12.5px] px-3 py-2 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {!rechazando && (
            <button type="submit" name="operacion" value="publicar" disabled={pendiente}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
              <Check width={13} height={13} strokeWidth={2} /> Publicar
            </button>
          )}
          {rechazando ? (
            <>
              <button type="submit" name="operacion" value="rechazar" disabled={pendiente}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: 'var(--bad)', color: 'var(--surface)' }}>
                <X width={13} height={13} strokeWidth={2} /> Rechazar
              </button>
              <button type="button" onClick={() => setRechazando(false)}
                className="text-[12.5px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setRechazando(true)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity"
              style={{ color: 'var(--bad)' }}>
              <X width={13} height={13} strokeWidth={1.75} /> Rechazar…
            </button>
          )}
        </div>
      </form>
      <p className="text-[10.5px] mt-1.5 m-0" style={{ color: 'var(--faint)' }}>
        Publicar aquí es tu aprobación (cola_aprobacion) — postearlo en el canal sigue siendo tu tap fuera de Likida; no hay integración de redes sociales todavía.
      </p>
    </div>
  );
}
