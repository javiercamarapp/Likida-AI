import './agentes.css';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { duracionLegible } from '@/lib/likida/agentes/corridas';
import { fechaHoraMx } from '@/lib/formato';
import { Disclosure, EstadoError, StatusChip, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';

/**
 * LA FICHA DE CORRIDAS — el «Fecha · Estado · Tareas · Duración · Disparo» (B3, auditoría 4), compartida por las páginas de agentes.
 *
 * Server component puro-props: la página trae las corridas (o el error) y esto solo pinta. Tres estados, como todo en este panel:
 * historial real, vacío que dice desde cuándo se anota, o el error DICHO. Va plegada («Actividad del agente») al final de la página.
 */

const ESTADO: Record<string, { tono: TonoEstado; rotulo: string }> = {
  ok: { tono: 'ok', rotulo: 'OK' },
  parcial: { tono: 'warn', rotulo: 'Parcial' },
  fallo: { tono: 'bad', rotulo: 'Falló' },
};

/** Cada disparo con su verdad: 'correo' (0108) NO es programado (lo disparó un correo que llegó al buzón) y 'whatsapp' (0115) lo confirmó el operador por chat. */
function rotuloDisparo(d: CorridaRegistrada['disparo']): string {
  if (d === 'manual') return 'Ejecutar ahora';
  if (d === 'correo') return 'Llegó un correo';
  if (d === 'whatsapp') return 'Confirmado por WhatsApp';
  return 'Programado';
}

const COLUMNAS: readonly ColumnaBase<CorridaRegistrada>[] = [
  { id: 'fecha', titulo: 'Fecha', principal: true, celda: (c) => fechaHoraMx(c.inicio) },
  {
    id: 'estado', titulo: 'Estado',
    celda: (c) => {
      const e = ESTADO[c.estado] ?? { tono: 'neutral' as const, rotulo: c.estado };
      return (
        <>
          <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>
          {c.error ? <span className="rv-ag-error">{c.error}</span> : null}
        </>
      );
    },
  },
  {
    id: 'tareas', titulo: 'Tareas', alinear: 'der',
    // NULL no es 0/0: una corrida que no se mide en tareas lo dice con un guion.
    celda: (c) => (c.tareasHechas === null || c.tareasTotal === null ? '—' : `${c.tareasHechas}/${c.tareasTotal}`),
  },
  { id: 'duracion', titulo: 'Duración', alinear: 'der', celda: (c) => duracionLegible(c.duracionMs) ?? '—' },
  { id: 'disparo', titulo: 'Disparo', celda: (c) => rotuloDisparo(c.disparo) },
];

export function FichaCorridas({ corridas }: { corridas: CorridaRegistrada[] | null }) {
  return (
    <Disclosure titulo="Actividad del agente" resumen={corridas === null ? 'No disponible' : `${corridas.length} corridas recientes`}>
      {corridas === null ? (
        <EstadoError compacto>
          No se pudo leer el historial de corridas. No se pinta «sin corridas» sobre una consulta caída: es exactamente la mentira que
          este historial existe para evitar.
        </EstadoError>
      ) : (
        <TablaBase
          etiqueta="Corridas recientes del agente"
          columnas={COLUMNAS}
          filas={corridas}
          idFila={(c) => c.id}
          densa
          tarjetaMovil
          vacio={{
            titulo: 'Sin corridas registradas',
            texto: 'El historial se anota desde el 14 de agosto de 2026; si el agente corrió antes de esa fecha, esas corridas no aparecen aquí.',
          }}
        />
      )}
    </Disclosure>
  );
}
