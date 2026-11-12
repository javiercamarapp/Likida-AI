import './agentes.css';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { duracionLegible } from '@/lib/likida/agentes/corridas';
import { fechaHoraMx } from '@/lib/formato';
import { Disclosure, EstadoError, StatusChip, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

/**
 * LA FICHA DE CORRIDAS — el «Fecha · Estado · Tareas · Duración · Disparo» (B3, auditoría 4), compartida por las páginas de agentes.
 *
 * Server component puro-props: la página trae las corridas (o el error) y esto solo pinta. Tres estados, como todo en este panel:
 * historial real, vacío que dice desde cuándo se anota, o el error DICHO. Va plegada («Actividad del agente») al final de la página.
 */

const estadoTr = (t: TResto = T_RESTO_ES): Record<string, { tono: TonoEstado; rotulo: string }> => ({
  ok: { tono: 'ok', rotulo: 'OK' },
  parcial: { tono: 'warn', rotulo: t('ch.parcial') },
  fallo: { tono: 'bad', rotulo: t('ch.fallo') },
});

/** Cada disparo con su verdad: 'correo' (0108) NO es programado (lo disparó un correo que llegó al buzón) y 'whatsapp' (0115) lo confirmó el operador por chat. */
function rotuloDisparo(d: CorridaRegistrada['disparo'], t: TResto = T_RESTO_ES): string {
  if (d === 'manual') return 'Ejecutar ahora';
  if (d === 'correo') return t('ch.llego_un_correo');
  if (d === 'whatsapp') return 'Confirmado por WhatsApp';
  return 'Programado';
}

const columnasTr = (t: TResto = T_RESTO_ES): readonly ColumnaBase<CorridaRegistrada>[] => ([
  { id: 'fecha', titulo: t('ch.fecha'), principal: true, celda: (c) => fechaHoraMx(c.inicio) },
  {
    id: 'estado', titulo: t('llaves.estado'),
    celda: (c) => {
      const e = estadoTr(t)[c.estado] ?? { tono: 'neutral' as const, rotulo: c.estado };
      return (
        <>
          <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>
          {c.error ? <span className="rv-ag-error">{c.error}</span> : null}
        </>
      );
    },
  },
  {
    id: 'tareas', titulo: t('ch.tareas'), alinear: 'der',
    // NULL no es 0/0: una corrida que no se mide en tareas lo dice con un guion.
    celda: (c) => (c.tareasHechas === null || c.tareasTotal === null ? '—' : `${c.tareasHechas}/${c.tareasTotal}`),
  },
  { id: 'duracion', titulo: t('ch.duracion'), alinear: 'der', celda: (c) => duracionLegible(c.duracionMs) ?? '—' },
  { id: 'disparo', titulo: t('ch.disparo'), celda: (c) => rotuloDisparo(c.disparo, t) },
]);

export function FichaCorridas({ corridas, t = T_RESTO_ES }: { corridas: CorridaRegistrada[] | null; t?: TResto }) {
  return (
    <Disclosure titulo={t('ch.actividad_del_agente')} resumen={corridas === null ? t('ch.no_disponible') : `${corridas.length} corridas recientes`}>
      {corridas === null ? (
        <EstadoError compacto>{t('ch.no_se_pudo_leer_el_historial')}</EstadoError>
      ) : (
        <TablaBase
          etiqueta={t('ch.corridas_recientes_del_agente')}
          columnas={columnasTr(t)}
          filas={corridas}
          idFila={(c) => c.id}
          densa
          tarjetaMovil
          vacio={{
            titulo: t('op.sin_corridas_registradas'),
            texto: t('ch.el_historial_se_anota_desde_el'),
          }}
        />
      )}
    </Disclosure>
  );
}
