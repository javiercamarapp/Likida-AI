'use client';

import { useActionState } from 'react';
import { StatusPill } from '../ui/kit';
import { Aviso, type ResultadoAccion, type AccionDeForma } from '../ui/forma';

// ═══════════════════════════════════════════════════════════════════════════
// LA PALANCA, EN LA MISMA FILA QUE EL AGENTE.
//
// Esta columna existía desde la Fase 2 pero era SOLO LECTURA: pintaba
// «Encendido / APAGADO» y el pie de la tabla mandaba a Observabilidad o al
// ⌘K. Es un salto de pantalla en el peor momento posible — cuando un agente
// está fabricando ruido, el catálogo es donde se le mira y donde se le tiene
// que poder apagar.
//
// UNA FILA, UN `useActionState`, igual que `interruptores-ui.tsx`: apagar
// Cobranza no comparte «Guardando…» con Facturas, porque en un incidente se
// tocan dos palancas seguidas y un spinner compartido esconde cuál respondió.
//
// EL MOTIVO SIGUE SIENDO OBLIGATORIO al apagar — `required` en el HTML y el
// CHECK de la 0110 detrás. No se relaja por ser una tabla más apretada: una
// palanca apagada sin nota es una bomba sin nota.
//
// NO DECIDE PERMISOS: el server action re-gatea superadmin adentro.
// ═══════════════════════════════════════════════════════════════════════════

export function PalancaAgente({
  id,
  apagado,
  accion,
}: {
  /** El id de la PALANCA (`agente:<id>`), no el del agente. */
  id: string;
  apagado: boolean;
  accion: AccionDeForma;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <StatusPill estado={apagado ? 'bad' : 'ok'}>{apagado ? 'APAGADO' : 'Encendido'}</StatusPill>
      </div>
      <form action={enviar} className="flex flex-wrap items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="operacion" value={apagado ? 'encender' : 'apagar'} />
        {!apagado && (
          <input
            name="motivo"
            required
            placeholder="Motivo"
            className="text-[11px] rounded-md px-2 py-1 w-28 outline-none"
            style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="text-[11px] font-medium rounded-md px-2 py-1 disabled:opacity-60 disabled:cursor-not-allowed"
          style={apagado
            ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
            : { background: 'var(--badbg)', color: 'var(--bad)', border: '1px solid var(--line)' }}
        >
          {pendiente ? '…' : apagado ? 'Encender' : 'Apagar'}
        </button>
      </form>
      <Aviso estado={estado} />
    </div>
  );
}
