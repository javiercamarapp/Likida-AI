'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2, SlidersHorizontal } from 'lucide-react';

// La estrategia editable de un agente (B4, auditoría 4) — SOLO donde hay una
// perilla que un motor de verdad lee. El valor actual llega como prop desde el
// server component (que lo leyó de getConfig); el default del producto se dice
// en la ayuda para que "regresar a como estaba" no requiera adivinar.

export type ResultadoEstrategia = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionEstrategia = (previo: ResultadoEstrategia, fd: FormData) => Promise<ResultadoEstrategia>;

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
      {pending ? 'Guardando…' : 'Guardar estrategia'}
    </button>
  );
}

function Aviso({ estado }: { estado: ResultadoEstrategia }) {
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

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <section className="card p-4 space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
        <SlidersHorizontal width={13} height={13} strokeWidth={1.75} />
        Estrategia del agente
      </h2>
      {children}
    </section>
  );
}

export function FormaEstrategiaConductores({ accion, horasActuales }: {
  accion: AccionEstrategia;
  horasActuales: number;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Marco>
      <form action={despachar} className="space-y-3">
        <div className="max-w-xs">
          <label htmlFor="est-horas" className={ETIQUETA}>Horas sin confirmación antes de escalar</label>
          <input id="est-horas" name="horasEscalacion" type="text" inputMode="numeric" required
            defaultValue={horasActuales} className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Si el chofer no confirma su viaje en este tiempo, se le insiste una vez y se le avisa al
            jefe de tráfico. Entre 1 y 48 horas; el estándar de Likida es 5. El cambio aplica desde
            la siguiente corrida (cada hora en punto).
          </p>
        </div>
        <Aviso estado={estado} />
        <Boton />
      </form>
    </Marco>
  );
}

export function FormaEstrategiaLiquidacion({ accion, umbralActual }: {
  accion: AccionEstrategia;
  umbralActual: number;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Marco>
      <form action={despachar} className="space-y-3">
        <div className="max-w-xs">
          <label htmlFor="est-umbral" className={ETIQUETA}>Confianza mínima de lectura (OCR)</label>
          <input id="est-umbral" name="umbralConfianza" type="text" inputMode="decimal" required
            defaultValue={umbralActual} className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Un comprobante leído con confianza por debajo de este umbral sale «a revisar» en vez de
            contarse directo. Entre 0.50 y 0.99; el estándar de Likida es 0.85. Subirlo manda más
            papeles a revisión manual; bajarlo acepta lecturas más dudosas como medición.
          </p>
        </div>
        <Aviso estado={estado} />
        <Boton />
      </form>
    </Marco>
  );
}
