'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';

/**
 * El formulario de NUEVO VIAJE — pieza REUSABLE a propósito (12-ago-2026):
 * la embebe Despacho (la página suelta /viajes/nuevo se retiró el 13-ago), que
 * es la siguiente página por reconstruir. Presentación pura: la mutación
 * llega como server action del host, que es quien re-verifica permisos
 * adentro (el patrón del repo: el gateo de la UI solo decide si se pinta).
 *
 * Campos = los de `NuevoViaje` (operacion.ts). La unidad llega cuando
 * Despacho exista — este formulario no promete lo que aún no ofrece.
 */

export type AccionCrearViaje = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-sm outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-xs font-medium mb-1.5';

function BotonCrear() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Plus width={15} height={15} strokeWidth={2} />
      {pending ? 'Creando…' : 'Crear viaje'}
    </button>
  );
}

export function FormaViaje({ action, operadores }: {
  action: AccionCrearViaje;
  operadores: Array<{ id: string; nombre: string }>;
}) {
  const [estado, dispatch] = useActionState(action, null);

  return (
    <form action={dispatch} className="space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label htmlFor="folio" className={ETIQUETA}>Folio</label>
          <input id="folio" name="folio" type="text" maxLength={40} placeholder="F-0148"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="fechaInicio" className={ETIQUETA}>Fecha de inicio</label>
          <input id="fechaInicio" name="fechaInicio" type="date"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="origen" className={ETIQUETA}>Origen</label>
          <input id="origen" name="origen" type="text" maxLength={120} placeholder="Silao"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="destino" className={ETIQUETA}>Destino</label>
          <input id="destino" name="destino" type="text" maxLength={120} placeholder="Monterrey"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="anticipo" className={ETIQUETA}>Anticipo (MXN)</label>
          <input id="anticipo" name="anticipo" type="number" min={0} step="0.01" placeholder="8000"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="operadorId" className={ETIQUETA}>Operador</label>
          <select id="operadorId" name="operadorId" className={CAMPO} style={{ background: 'var(--surface)' }} defaultValue="">
            <option value="">Sin asignar todavía</option>
            {operadores.map((o) => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>
            Con operador asignado, Likida le avisa por WhatsApp en cuanto el viaje exista.
          </p>
        </div>
      </div>

      {estado?.error && (
        <div className="rounded-lg px-3 py-2.5 text-[13px]" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
          {estado.error}
        </div>
      )}

      <div className="pt-1">
        <BotonCrear />
      </div>
    </form>
  );
}
