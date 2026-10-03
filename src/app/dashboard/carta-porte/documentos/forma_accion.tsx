'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { TriangleAlert, CheckCircle2 } from 'lucide-react';

export type ResultadoAccion = { ok: true; mensaje: string; detalles?: string[] } | { ok: false; error: string } | null;
export type AccionDoc = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

export function Aviso({ estado }: { estado: ResultadoAccion }) {
  if (!estado) return null;
  return estado.ok ? (
    <div role="status" className="text-[12.5px] px-3.5 py-2.5 rounded-lg space-y-1" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <p className="flex items-start gap-2"><CheckCircle2 width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{estado.mensaje}</p>
      {estado.detalles && estado.detalles.length > 0 && (
        <ul className="pl-6 list-disc space-y-0.5">{estado.detalles.map((d) => <li key={d}>{d}</li>)}</ul>
      )}
    </div>
  ) : (
    <div role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{estado.error}
    </div>
  );
}

/** Una forma con su resultado visible. Los campos van como hijos (los arma el servidor). */
export function FormaAccion({ accion, children, className = 'space-y-3', enctype }: { accion: AccionDoc; children: ReactNode; className?: string; enctype?: 'multipart/form-data' }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className={className} encType={enctype}>
      {children}
      <Aviso estado={estado} />
    </form>
  );
}

const COLOR: Record<string, { bg: string; fg: string }> = {
  primario: { bg: 'var(--marca)', fg: 'var(--marca-fg)' },
  secundario: { bg: 'var(--surface)', fg: 'var(--ink)' },
  peligro: { bg: 'var(--badbg)', fg: 'var(--bad)' },
};

/** Un botón de envío; `intencion` viaja como `name="intencion"` para que UNA acción atienda varios botones. */
export function BotonEnvio({ etiqueta, pendiente = 'Procesando…', intencion, variante = 'primario', icono }: {
  etiqueta: string; pendiente?: string; intencion?: string; variante?: 'primario' | 'secundario' | 'peligro'; icono?: ReactNode;
}) {
  const { pending } = useFormStatus();
  const c = COLOR[variante];
  return (
    <button type="submit" name={intencion ? 'intencion' : undefined} value={intencion} disabled={pending}
      className={`h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50 ${variante === 'primario' ? '' : 'hairline'}`}
      style={{ background: c.bg, color: c.fg }}>
      {icono}{pending ? pendiente : etiqueta}
    </button>
  );
}

export const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
export const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
