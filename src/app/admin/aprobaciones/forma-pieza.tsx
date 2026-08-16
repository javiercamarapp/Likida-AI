'use client';

import { useActionState, useState } from 'react';
import { Check, PencilLine, X } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { StatusPill } from '../ui/kit';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';

export type ResultadoPieza = { ok?: string; error?: string } | null;
export type AccionPieza = (previo: ResultadoPieza, fd: FormData) => Promise<ResultadoPieza>;

/**
 * UNA pieza de la cola con sus TRES acciones — aprobar tal cual, editar y
 * aprobar (el textarea aparece al pedirlo y la versión editada es la que
 * sale), rechazar con motivo obligatorio. El borrador se muestra COMPLETO:
 * aprobar algo que no se leyó entero no es aprobación.
 */
export function FormaPieza({ pieza, accion }: { pieza: PiezaEnCola; accion: AccionPieza }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoPieza, FormData>(accion, null);
  const [editando, setEditando] = useState(false);
  const [rechazando, setRechazando] = useState(false);

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
        <StatusPill estado="neutral">{pieza.tipo}</StatusPill>
        <span className="cifra-mono text-[11px]" style={{ color: 'var(--faint)' }}>{pieza.agente}</span>
        {pieza.prospectoEmpresa && (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>→ {pieza.prospectoEmpresa}</span>
        )}
        <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--faint)' }}>{fechaHoraMx(pieza.creadoEn)}</span>
      </div>

      {/* El borrador COMPLETO, con scroll propio — nunca truncado. */}
      <pre className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto rounded-lg px-3 py-2 hairline"
        style={{ background: 'var(--canvas)', fontFamily: 'inherit' }}>
        {pieza.cuerpo}
      </pre>

      {pieza.fuentes && Object.keys(pieza.fuentes).length > 0 && (
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>
          Fuentes: {Object.entries(pieza.fuentes).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
        </p>
      )}

      {estado?.error && <p className="text-[12px] mt-2" style={{ color: 'var(--bad)' }}>{estado.error}</p>}

      <form action={enviar} className="mt-2.5 space-y-2">
        <input type="hidden" name="pieza" value={pieza.id} />
        {editando && (
          <textarea name="cuerpoEditado" defaultValue={pieza.cuerpo} rows={6}
            className="w-full text-[12.5px] leading-relaxed px-3 py-2 rounded-lg hairline"
            style={{ background: 'var(--surface)' }} />
        )}
        {rechazando && (
          <input name="motivo" placeholder="Motivo del rechazo (obligatorio) — sin él, la misma pieza vuelve"
            className="w-full text-[12.5px] px-3 py-2 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {!rechazando && (
            <button type="submit" name="operacion" value="aprobar" disabled={pendiente}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
              <Check width={13} height={13} strokeWidth={2} />
              {editando ? 'Aprobar con mi edición' : 'Aprobar tal cual'}
            </button>
          )}
          {!editando && !rechazando && (
            <button type="button" onClick={() => setEditando(true)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
              <PencilLine width={13} height={13} strokeWidth={1.75} /> Editar y aprobar
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
            <button type="button" onClick={() => { setRechazando(true); setEditando(false); }}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity"
              style={{ color: 'var(--bad)' }}>
              <X width={13} height={13} strokeWidth={1.75} /> Rechazar…
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
