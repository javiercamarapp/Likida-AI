import { fechaHoraMx, numero } from '@/lib/formato';
import '../vigia.css';
import { Chip, EstadoVacio, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import type { AlertaSinAtender, MotivoSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';

const MOTIVO: Record<MotivoSinAtender, string> = {
  espera_sobre_umbral: 'Plazo vencido', insistencia: 'El cliente insiste', urgencia: 'Urgente', pregunta: 'Pregunta', palabra_clave: 'Tema importante',
};
const TURNO = { dia: 'Día', noche: 'Noche', festivo: 'Festivo o fin de semana' } as const;

export function duracion(min: number): string {
  if (min < 60) return `${numero(min)} min`;
  return `${numero(Math.floor(min / 60))} h ${numero(min % 60)} min`;
}

const COLUMNAS: readonly ColumnaBase<AlertaSinAtender>[] = [
  { id: 'grupo', titulo: 'Grupo', principal: true, celda: (a) => <>{a.chatNombre}{a.critico ? <> <Chip tono="warn">Crítico</Chip></> : null}</> },
  { id: 'prioridad', titulo: 'Prioridad', celda: (a) => <Chip tono={a.nivel === 'alta' ? 'bad' : 'neutral'}>{a.nivel === 'alta' ? 'Alta' : 'Normal'}</Chip> },
  { id: 'espera', titulo: 'Sin respuesta', celda: (a) => <>{duracion(a.antiguedadMin)} <span className="rv-vg__faint">(plazo {duracion(a.umbralAplicadoMin)})</span></> },
  { id: 'motivo', titulo: 'Motivo', celda: (a) => a.motivos.map((m) => MOTIVO[m]).join(', ') },
  { id: 'turno', titulo: 'Turno', celda: (a) => TURNO[a.turno] },
  {
    id: 'ultimo', titulo: 'Último mensaje',
    celda: (a) => (
      <>
        {fechaHoraMx(a.ultimoEn)}
        {a.vistaPrevia ? <span className="rv-vg__bloquear rv-vg__muted">{a.vistaPrevia}</span> : null}
      </>
    ),
  },
];

/** La lista de conversaciones sin atender. Pura (sin acciones): sirve igual en servidor y dentro del formulario. */
export function TablaSinAtender({ alertas }: { alertas: readonly AlertaSinAtender[] }) {
  if (alertas.length === 0) {
    return <EstadoVacio titulo="Nada sin atender" contenido>Ninguna conversación pasa de su plazo en los chats subidos.</EstadoVacio>;
  }
  return <TablaBase etiqueta="Conversaciones sin atender" columnas={COLUMNAS} filas={alertas} idFila={(a) => a.clave} densa tarjetaMovil />;
}
