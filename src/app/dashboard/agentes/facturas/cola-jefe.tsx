'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  UserRound, ShieldAlert, ChevronDown, ChevronUp, Copy, Check, ExternalLink,
} from 'lucide-react';
import { mxn, fechaCorta } from '@/lib/formato';
import { PillPlazo } from './pills';
import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';

/** Una fila de la cola del jefe, ya SERIALIZADA por el server (la vista no
 *  manda el ticket entero al cliente — solo lo que esta cola pinta y usa). */
export interface FilaJefe {
  gastoId: string;
  fecha: string | null;
  comercio: string;
  portal: string;
  /** Liga directa leída del ticket/QR, o null (se cae al portal). */
  urlTicket: string | null;
  concepto: string;
  monto: number;
  caducidad: TicketPorFacturar['caducidad'];
  motivo: 'requiere_cuenta' | 'bloqueado';
  detalle?: string;
  /** Los campos que el portal va a pedir, con su etiqueta LITERAL. */
  campos: Array<{ etiqueta: string; valor: string | null; requerido: boolean }>;
}

export type AccionMarcarFacturada = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

/**
 * La cola interactiva del jefe (13-ago: "quiero que todas las
 * funcionalidades ya estén configuradas"). Cada fila se expande a su mesa
 * de trabajo: los campos que el portal pide con copiar por campo, abrir el
 * portal, y "ya quedó" con el folio fiscal — que ESCRIBE el CFDI en la base
 * y saca el ticket de la cola de verdad. La acción vive en el servidor y
 * re-verifica sesión, rol y tenant; aquí solo se pinta.
 */
export function ColaJefe({ filas, marcarFacturada, maxFilas, totalFilas }: {
  filas: FilaJefe[];
  marcarFacturada: AccionMarcarFacturada;
  maxFilas: number;
  totalFilas: number;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-1">
        {filas.map((f) => (
          <div key={f.gastoId} className="rounded-xl border" style={{ borderColor: abierta === f.gastoId ? 'var(--line)' : 'transparent', background: abierta === f.gastoId ? 'var(--canvas)' : undefined }}>
            <button type="button" onClick={() => setAbierta((v) => (v === f.gastoId ? null : f.gastoId))}
              className="w-full grid grid-cols-[64px_1.2fr_1fr_auto_auto_auto_20px] items-center gap-3 px-2.5 py-2 rounded-xl text-left text-[13px] transition-colors hover:bg-[var(--canvas)]">
              <span style={{ color: 'var(--muted)' }}>{fechaCorta(f.fecha)}</span>
              <span className="min-w-0">
                <span className="font-medium block truncate">{f.comercio}</span>
                <span className="block text-[11px] truncate" style={{ color: 'var(--faint)' }}>{f.portal}</span>
              </span>
              <span className="truncate">{f.concepto}</span>
              <span className="cifra-mono text-right">{mxn(f.monto)}</span>
              <PillPlazo c={f.caducidad} />
              {f.motivo === 'requiere_cuenta' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium justify-self-start"
                  style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
                  <UserRound width={11} height={11} strokeWidth={2} /> Tu cuenta
                </span>
              ) : (
                <span title={f.detalle} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium justify-self-start"
                  style={{ color: 'var(--warn)', background: 'var(--warnbg)' }}>
                  <ShieldAlert width={11} height={11} strokeWidth={2} /> Bloqueado
                </span>
              )}
              {abierta === f.gastoId
                ? <ChevronUp width={14} height={14} strokeWidth={2} style={{ color: 'var(--muted)' }} />
                : <ChevronDown width={14} height={14} strokeWidth={2} style={{ color: 'var(--muted)' }} />}
            </button>

            {abierta === f.gastoId && <MesaDeTrabajo fila={f} marcarFacturada={marcarFacturada} />}
          </div>
        ))}
      </div>
      {totalFilas > maxFilas && (
        <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
          Se muestran los {maxFilas} que vencen primero — hay {totalFilas - maxFilas} más
          (el encabezado los suma todos).
        </p>
      )}
    </>
  );
}

/** El detalle expandido: exactamente lo que el jefe necesita para capturar
 *  en el portal, y la salida de la cola cuando ya quedó. */
function MesaDeTrabajo({ fila, marcarFacturada }: { fila: FilaJefe; marcarFacturada: AccionMarcarFacturada }) {
  const [estado, accion] = useActionState(marcarFacturada, null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const liga = fila.urlTicket ?? `https://${fila.portal}`;

  function copiar(clave: string, texto: string) {
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(clave);
      setTimeout(() => setCopiado((v) => (v === clave ? null : v)), 1500);
    });
  }

  const conValor = fila.campos.filter((c) => c.valor);

  return (
    <div className="px-3 pb-3 pt-1 space-y-3">
      {fila.motivo === 'bloqueado' && fila.detalle && (
        <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
          La máquina se rindió a propósito: {fila.detalle}. Te dejó todo listo para que lo
          termines tú.
        </p>
      )}

      {conValor.length > 0 ? (
        <div className="rounded-lg hairline p-2.5 space-y-1" style={{ background: 'var(--surface)' }}>
          <div className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>
            Lo que el portal te va a pedir, tal cual
          </div>
          {conValor.map((c) => (
            <div key={c.etiqueta} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span style={{ color: 'var(--muted)' }}>{c.etiqueta}</span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="cifra-mono truncate">{c.valor}</span>
                <button type="button" aria-label={`Copiar ${c.etiqueta}`} onClick={() => copiar(c.etiqueta, c.valor as string)}
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)]"
                  style={{ color: copiado === c.etiqueta ? 'var(--ok)' : 'var(--muted)' }}>
                  {copiado === c.etiqueta ? <Check width={12} height={12} strokeWidth={2} /> : <Copy width={12} height={12} strokeWidth={2} />}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
          Este portal se captura con tu sesión — no pide más datos que los de tu cuenta.
        </p>
      )}

      <div className="flex items-center gap-2">
        <a href={liga} target="_blank" rel="noopener noreferrer"
          className="hairline inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
          style={{ background: 'var(--surface)' }}>
          <ExternalLink width={13} height={13} strokeWidth={1.75} /> Abrir el portal
        </a>
        {conValor.length > 0 && (
          <button type="button" onClick={() => copiar('__todo__', conValor.map((c) => `${c.etiqueta}: ${c.valor}`).join('\n'))}
            className="hairline inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
            style={{ background: 'var(--surface)', color: copiado === '__todo__' ? 'var(--ok)' : undefined }}>
            {copiado === '__todo__' ? <Check width={13} height={13} strokeWidth={2} /> : <Copy width={13} height={13} strokeWidth={1.75} />}
            Copiar todo
          </button>
        )}
      </div>

      {/* Ya quedó: el folio fiscal que imprimió el portal saca el ticket de
          la cola DE VERDAD (escribe el CFDI en la base, anclado al tenant). */}
      <form action={accion} className="flex items-center gap-2">
        <input type="hidden" name="gastoId" value={fila.gastoId} />
        <input name="uuid" placeholder="Folio fiscal (UUID) del CFDI que te dio el portal"
          aria-label="Folio fiscal del CFDI"
          className="flex-1 min-w-0 text-[12.5px] px-3 py-1.5 rounded-lg hairline cifra-mono"
          style={{ background: 'var(--surface)' }} />
        <BotonGuardar />
      </form>
      {estado?.error && <p className="text-[12px]" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50 shrink-0"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {pending ? 'Guardando…' : 'Ya quedó'}
    </button>
  );
}
