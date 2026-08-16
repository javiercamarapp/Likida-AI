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

/** El paso de ENVÍO de una aprobada (0120): un click aparte con claim
 *  anti-doble-click en el servidor. Dice a quién sale y con qué versión;
 *  sin correo del prospecto, lo dice en vez de ofrecer un botón muerto. */
export function FormaEnvio({ pieza, accion }: { pieza: PiezaEnCola; accion: AccionPieza }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoPieza, FormData>(accion, null);

  if (estado?.ok) {
    return (
      <div className="hairline rounded-lg px-3 py-2.5 text-[12.5px]" style={{ background: 'var(--surface)', color: 'var(--ok)' }}>
        {estado.ok}
      </div>
    );
  }
  return (
    <div className="hairline rounded-lg px-3 py-2.5 flex items-center gap-2.5 flex-wrap" style={{ background: 'var(--surface)' }}>
      <span className="text-[13px] font-medium truncate">{pieza.titulo}</span>
      {pieza.cuerpoFinal && <StatusPill estado="neutral">con edición</StatusPill>}
      <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {pieza.prospectoEmpresa ? `→ ${pieza.prospectoEmpresa}` : 'sin prospecto'}
        {pieza.prospectoCorreo ? ` · ${pieza.prospectoCorreo}` : ''}
      </span>
      {pieza.envioError && (
        <span className="text-[11.5px]" style={{ color: 'var(--bad)' }}>último intento: {pieza.envioError}</span>
      )}
      {estado?.error && <span className="text-[12px] basis-full" style={{ color: 'var(--bad)' }}>{estado.error}</span>}
      <form action={enviar} className="ml-auto shrink-0">
        <input type="hidden" name="pieza" value={pieza.id} />
        {pieza.prospectoCorreo ? (
          <button type="submit" disabled={pendiente}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3.5 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
            {pendiente ? 'Enviando…' : 'Enviar por correo'}
          </button>
        ) : (
          <span className="text-[11.5px]" style={{ color: 'var(--faint)' }}>sin correo capturado — se captura en Vendedores</span>
        )}
      </form>
    </div>
  );
}
