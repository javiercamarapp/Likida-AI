import { fechaHoraMx, numero } from '@/lib/formato';
import { Chip } from '@/app/ui-v2/componentes';
import type { AlertaSinAtender, MotivoSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';

const MOTIVO: Record<MotivoSinAtender, string> = {
  espera_sobre_umbral: 'Plazo vencido', insistencia: 'El cliente insiste', urgencia: 'Urgente', pregunta: 'Pregunta', palabra_clave: 'Tema importante',
};
const TURNO = { dia: 'Día', noche: 'Noche', festivo: 'Festivo o fin de semana' } as const;

export function duracion(min: number): string {
  if (min < 60) return `${numero(min)} min`;
  return `${numero(Math.floor(min / 60))} h ${numero(min % 60)} min`;
}

/** La lista de conversaciones sin atender. Pura (sin acciones): sirve igual en servidor y dentro del formulario. */
export function TablaSinAtender({ alertas }: { alertas: readonly AlertaSinAtender[] }) {
  if (alertas.length === 0) {
    return <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Ninguna conversación pasa de su plazo en los chats subidos.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table aria-label="Conversaciones sin atender" className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[11px]" style={{ color: 'var(--faint)' }}>
            <th scope="col" className="py-1 pr-3">Grupo</th><th scope="col" className="pr-3">Prioridad</th><th scope="col" className="pr-3">Sin respuesta</th>
            <th scope="col" className="pr-3">Motivo</th><th scope="col" className="pr-3">Turno</th><th scope="col">Último mensaje</th>
          </tr>
        </thead>
        <tbody>
          {alertas.map((a) => (
            <tr key={a.clave} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
              <td className="py-2 pr-3">{a.chatNombre}{a.critico ? <> <Chip tono="warn">Crítico</Chip></> : null}</td>
              <td className="pr-3"><Chip tono={a.nivel === 'alta' ? 'bad' : 'neutral'}>{a.nivel === 'alta' ? 'Alta' : 'Normal'}</Chip></td>
              <td className="pr-3">{duracion(a.antiguedadMin)} <span style={{ color: 'var(--faint)' }}>(plazo {duracion(a.umbralAplicadoMin)})</span></td>
              <td className="pr-3">{a.motivos.map((m) => MOTIVO[m]).join(', ')}</td>
              <td className="pr-3">{TURNO[a.turno]}</td>
              <td>
                {fechaHoraMx(a.ultimoEn)}
                {a.vistaPrevia ? <span className="block" style={{ color: 'var(--muted)' }}>{a.vistaPrevia}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
