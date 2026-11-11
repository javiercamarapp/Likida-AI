import { fechaHoraMx, numero } from '@/lib/formato';
import '../vigia.css';
import { Chip, EstadoVacio, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import type { AlertaSinAtender, MotivoSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

const motivoTr = (tx: TAgentes = TR_ES.t): Record<MotivoSinAtender, string> => ({
  espera_sobre_umbral: tx('rest.plazo_vencido'), insistencia: tx('rest.el_cliente_insiste'), urgencia: tx('rest.urgente'), pregunta: tx('rest.pregunta'), palabra_clave: tx('rest.tema_importante'),
});
const turnoTr = (tx: TAgentes = TR_ES.t) => ({ dia: tx('rest.dia'), noche: tx('rest.noche'), festivo: tx('rest.festivo_o_fin_de_semana') } as const);

export function duracion(min: number): string {
  if (min < 60) return `${numero(min)} min`;
  return `${numero(Math.floor(min / 60))} h ${numero(min % 60)} min`;
}

const columnasTr = (tx: TAgentes = TR_ES.t): readonly ColumnaBase<AlertaSinAtender>[] => ([
  { id: 'grupo', titulo: tx('cartaporte.vista.grupo'), principal: true, celda: (a) => <>{a.chatNombre}{a.critico ? <> <Chip tono="warn">{tx('rest.critico')}</Chip></> : null}</> },
  { id: 'prioridad', titulo: tx('rest.prioridad'), celda: (a) => <Chip tono={a.nivel === 'alta' ? 'bad' : 'neutral'}>{a.nivel === 'alta' ? tx('rest.alta') : tx('rest.normal')}</Chip> },
  { id: 'espera', titulo: tx('rest.sin_respuesta'), celda: (a) => <>{duracion(a.antiguedadMin)}{' '}{ricoT(tx('rest.e0_plazo_e0', { duracion: duracion(a.umbralAplicadoMin) }), { e0: (c) => <span className="rv-vg__faint">{c}</span> })}</> },
  { id: 'motivo', titulo: tx('rest.motivo'), celda: (a) => a.motivos.map((m) => motivoTr(tx)[m]).join(', ') },
  { id: 'turno', titulo: tx('rest.turno'), celda: (a) => turnoTr(tx)[a.turno] },
  {
    id: 'ultimo', titulo: tx('rest.ultimo_mensaje'),
    celda: (a) => (
      <>
        {fechaHoraMx(a.ultimoEn)}
        {a.vistaPrevia ? <span className="rv-vg__bloquear rv-vg__muted">{a.vistaPrevia}</span> : null}
      </>
    ),
  },
]);

/** La lista de conversaciones sin atender. Pura (sin acciones): sirve igual en servidor y dentro del formulario. */
export function TablaSinAtender({ alertas, tr = TR_ES }: { alertas: readonly AlertaSinAtender[]; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (alertas.length === 0) {
    return <EstadoVacio titulo={tx('rest.nada_sin_atender')} contenido>{tx('rest.ninguna_conversacion_pasa_de_su_plazo')}</EstadoVacio>;
  }
  return <TablaBase etiqueta={tx('rest.conversaciones_sin_atender')} columnas={columnasTr(tx)} filas={alertas} idFila={(a) => a.clave} densa tarjetaMovil />;
}
