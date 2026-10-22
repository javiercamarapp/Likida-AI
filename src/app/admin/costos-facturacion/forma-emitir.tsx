'use client';

import { useActionState, useState } from 'react';
import { Aviso, ESTILO_CONTROL, type AccionDeForma, type ResultadoAccion } from '../ui/forma';
import { BotonConfirmar } from '../ui/confirmar';

// ═══════════════════════════════════════════════════════════════════════════
// "EMITIR MENSUALIDAD" — auditoría adversarial, HALLAZGO MEDIO: `accionEmitir`
// dispara `emitirMensualidad` (acción fiscal real: genera el cobro del
// periodo, con constraint de unicidad por periodo en la base, 0057) con un
// solo clic y CERO diálogo de confirmación. Un clic accidental en la flota
// equivocada emite una mensualidad real que luego hay que corregir A MANO —
// no hay botón para deshacerla. Se envuelve con el ÚNICO sistema de
// confirmación del repo (`admin/ui/confirmar`, DESIGN.md §3: nunca un
// `confirm()` nuevo), mismo molde que `FormaRechazarCliente`
// (admin/mcp-clientes, PR #583): `BotonConfirmar`/`DialogoConfirmar`, con
// `tono="peligro"`, y el diálogo DICE qué periodo y a qué flota se le va a
// emitir — no "¿estás seguro?" a secas.
//
// Aquí la flota NO es fija por fila (como en mcp-clientes, un botón por
// cliente): es un `<select>` dentro del MISMO formulario, y el diálogo tiene
// que anunciar la opción elegida EN ESE MOMENTO — por eso el `<select>` es
// CONTROLADO (useState) en vez del `Selector` no controlado de `ui/forma`.
// Mientras no se elija flota, el disparador queda deshabilitado: no hay
// manera de abrir el diálogo con "elige una flota" como destinatario.
// ═══════════════════════════════════════════════════════════════════════════

export function FormaEmitirMensualidad({
  accion, flotas, periodoIni, periodoFin,
}: {
  accion: AccionDeForma;
  flotas: Array<{ id: string; nombre: string }>;
  /** El MISMO cálculo que corre `accionEmitir` (periodoMesActualMx): el
   *  diálogo anuncia el periodo REAL que se va a emitir, nunca uno aproximado
   *  calculado aparte que pudiera divergir del que de verdad se cobra. */
  periodoIni: string;
  periodoFin: string;
}) {
  const [estado, despachar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const [tenantId, setTenantId] = useState('');
  const flota = flotas.find((f) => f.id === tenantId);

  return (
    <form action={despachar} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="tenantId" className="text-xs" style={{ color: 'var(--muted)' }}>
            Flota<span aria-hidden> *</span>
          </label>
          <select
            id="tenantId"
            name="tenantId"
            required
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="text-sm rounded-lg px-2.5 py-2"
            style={ESTILO_CONTROL}
          >
            <option value="">Elige…</option>
            {flotas.map((f) => (
              <option key={f.id} value={f.id}>{f.nombre}</option>
            ))}
          </select>
        </div>
      </div>
      <Aviso estado={estado} />
      <div>
        <BotonConfirmar
          etiqueta="Emitir"
          tono="peligro"
          deshabilitado={!tenantId || pendiente}
          etiquetaConfirmar="Sí, emitir mensualidad"
          titulo="Emitir mensualidad"
          descripcion={flota
            ? `Se va a emitir la mensualidad del periodo ${periodoIni} — ${periodoFin} para ${flota.nombre}. Genera `
              + 'un cobro real (hay un índice único por periodo en la base) y no hay botón para deshacerlo: una '
              + 'flota equivocada se corrige a mano.'
            : 'Elige una flota primero.'}
          className="text-sm font-medium rounded-lg px-4 py-2 w-full md:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}
        />
      </div>
    </form>
  );
}
