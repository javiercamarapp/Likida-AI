'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Guardando…' : 'Guardar declaración'}
    </button>
  );
}

function Aviso({ estado }: { estado: ResultadoForma }) {
  if (!estado) return null;
  return estado.ok ? (
    <div className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
      {estado.mensaje}
    </div>
  ) : (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.error}
    </div>
  );
}

/**
 * La declaración que decide el complemento, POR VIAJE. Dos campos y los dos
 * pueden quedarse vacíos: un vacío es "no declarado" y el clasificador
 * responde "falta declarar" — nunca decide por ti. La regla exige "plena
 * certeza", y la certeza es de quien conoce la ruta, no del software.
 */
export function FormaDeclaracion({ accion, viajeId, inicial }: {
  accion: AccionForma;
  viajeId: string;
  inicial: { pisaFederal: boolean | null; radioKm: number | null };
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `ccp-${viajeId}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="viajeId" value={viajeId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={campo('federal')} className={ETIQUETA}>¿La ruta pisa carretera federal?</label>
          <select id={campo('federal')} name="pisaFederal"
            defaultValue={inicial.pisaFederal === null ? '' : inicial.pisaFederal ? 'si' : 'no'}
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Sin declarar</option>
            <option value="si">Sí, pisa tramo federal</option>
            <option value="no">No — plena certeza de ruta local</option>
          </select>
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            «No» exige plena certeza: si por cualquier causa se pisa federal, la obligación revive
            completa (regla 2.7.7.2.1). La declaración queda registrada con quién la hizo.
          </p>
        </div>
        <div>
          <label htmlFor={campo('radio')} className={ETIQUETA}>Radio del tramo federal (km)</label>
          <input id={campo('radio')} name="radioKm" type="text" inputMode="decimal"
            defaultValue={inicial.radioKm ?? ''} placeholder="Solo si pisa federal y la unidad es hasta C2"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Es un RADIO entre origen inicial y destino final (con puntos intermedios), no kilómetros
            de odómetro. Con unidad hasta C2 y radio ≤ 30 km, el viaje se considera sin tramo federal
            (regla 2.7.7.2.8).
          </p>
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton />
    </form>
  );
}
