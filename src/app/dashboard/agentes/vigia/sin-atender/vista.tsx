import { fechaHoraMx, numero } from '@/lib/formato';
import type { ResultadoSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import type { DestinatarioResumen } from '@/lib/likida/vigia/sin_atender_aviso/destinatarios';
import { MarcoPagina, Aviso, BotonEnlace, TituloRecuadro } from '@/app/ui-v2/componentes';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import { FormaRevision, type AccionEnviar, type AccionRevisar } from './formas';
import { TablaSinAtender, duracion } from './tabla';

function Seccion({ id, titulo, info, children }: { id: string; titulo: string; info: InfoClave; children: React.ReactNode }) {
  return (
    <section className="card p-4 space-y-3" aria-labelledby={id}>
      <TituloRecuadro id={id} info={info}>{titulo}</TituloRecuadro>
      {children}
    </section>
  );
}

const ORIGEN = { servicio: 'Servicio al cliente', nivel1: 'Nivel 1', nivel2: 'Nivel 2 (solo si hay una alerta alta en un grupo crítico)' } as const;

export function VistaSinAtender({ sufijo, error, resultado, gruposRevisados, gruposOmitidos, destinatarios, correoEncendido, puedeEnviar, flota, acciones }: {
  sufijo: string;
  /** Si no se pudo leer, el motivo en palabras llanas: no se enseña un vacío que parezca «todo atendido». */
  error: string | null;
  resultado: ResultadoSinAtender | null;
  gruposRevisados: number;
  gruposOmitidos: number;
  destinatarios: readonly DestinatarioResumen[];
  correoEncendido: boolean;
  puedeEnviar: boolean;
  flota?: string;
  acciones: { revisar: AccionRevisar; enviar: AccionEnviar };
}) {
  const r = resultado?.resumen;
  return (
    <MarcoPagina
      titulo="Conversaciones sin atender"
      apoyo="Vigía por exportación de chats: sin conexión en tiempo real con WhatsApp."
      acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/vigia${sufijo}`}>Volver al tablero</BotonEnlace>}
    >
      <Aviso tono="info">
        Esta lista sale de los chats exportados que subiste. Likida no lee tus grupos de WhatsApp al instante: cada tiempo se mide contra la hora de la última exportación, no contra este momento. Para ver lo más reciente, sube un chat nuevo en{' '}
        <a className="underline" href={`/dashboard/agentes/vigia/historial${sufijo}`}>Grupos de clientes e histórico</a>.
      </Aviso>

      {error !== null ? (
        <Aviso tono="error">{error}</Aviso>
      ) : (
        <>
          <Seccion id="sin-atender-lista" titulo="Sin atender" info="vigia_sin_atender.lista">
            {r && (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                {numero(gruposRevisados)} grupos revisados · {numero(r.alertas)} conversaciones sin atender ({numero(r.altas)} de prioridad alta)
                {r.masAntiguaMin !== null ? ` · la más antigua lleva ${duracion(r.masAntiguaMin)}` : ''}. Revisión de {fechaHoraMx(resultado?.ahoraEn)}.
                {gruposOmitidos > 0 ? ` Quedaron fuera ${numero(gruposOmitidos)} grupos por el tope de revisión.` : ''}
              </p>
            )}
            <FormaRevision revisar={acciones.revisar} enviar={acciones.enviar} flota={flota} puedeEnviar={puedeEnviar} inicial={<TablaSinAtender alertas={resultado?.alertas ?? []} />} />
          </Seccion>

          <Seccion id="sin-atender-correo" titulo="Resumen por correo" info="vigia_sin_atender.correo">
            <p className="text-[12px]">
              {correoEncendido
                ? 'El envío por correo está encendido. Se manda solo cuando alguien lo pide con el botón; no sale nada automático.'
                : 'El envío por correo está apagado: puedes revisar la lista, pero no se manda nada. Pídele a Likida que lo encienda.'}
            </p>
            {destinatarios.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                Hoy nadie recibiría el resumen: agrega correos en servicio al cliente o en la lista de directores del{' '}
                <a className="underline" href={`/dashboard/agentes/vigia${sufijo}`}>tablero del Vigía</a>. Ahí también eliges quién recibe de noche, en festivos y fines de semana.
              </p>
            ) : (
              <ul className="text-[12px] list-disc pl-5" aria-label="Quién recibiría el resumen ahora">
                {destinatarios.map((d) => <li key={d.correo}>{d.nombre} · {ORIGEN[d.origen]}</li>)}
              </ul>
            )}
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>El correo lleva el grupo, la prioridad, el tiempo sin respuesta y el motivo; no incluye el texto de los mensajes.</p>
            {!puedeEnviar && <p className="text-[11px]" style={{ color: 'var(--muted)' }}>Solo quien administra la flota puede mandar el resumen.</p>}
          </Seccion>
        </>
      )}
    </MarcoPagina>
  );
}
