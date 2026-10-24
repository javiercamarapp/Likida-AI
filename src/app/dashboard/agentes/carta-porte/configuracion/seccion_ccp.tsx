'use client';

import { MailCheck } from 'lucide-react';
import type { CcpRecibidoVista } from '@/lib/likida/carta_porte_docs/ccp_respuesta_repo';
import type { EstadoCcpTimbrado } from '@/lib/likida/carta_porte_docs/ccp_respuesta';
import { fechaHoraMx } from '@/lib/formato';
import { BotonEnvio, CAMPO, ETIQUETA, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';

/**
 * A37-A3-01 · «CCP timbrados recibidos»: el interruptor de la respuesta al cliente (apagado de arranque) y la lista de los CCP
 * que el sistema del cliente avisó, con la confirmación humana de la primera respuesta por cliente. NADA sale sin que una
 * persona lo confirme la primera vez; el correo lleva el PDF y el XML timbrados tal como llegaron.
 */

export interface VerComo { tenant?: string; rol?: string; vista?: string }
export interface AccionesCcp { fijar: AccionDoc; confirmar: AccionDoc }

const ROTULO: Record<EstadoCcpTimbrado, string> = {
  guardado: 'Guardado (la respuesta estaba apagada)',
  pendiente_confirmacion: 'Espera tu confirmación',
  respondido: 'Respondido al cliente',
  error_envio: 'El correo no salió: reintenta',
};

const ESTILO = { background: 'var(--surface)' } as const;

export function SeccionCcp({ activa, filas, ver, acciones }: {
  activa: boolean | 'sin_migracion';
  filas: CcpRecibidoVista[] | 'sin_migracion';
  ver: VerComo;
  acciones: AccionesCcp;
}) {
  const oculto = (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
    </>
  );
  return (
    <section className="space-y-4 pt-4" aria-label="CCP timbrados recibidos">
      <header className="space-y-1">
        <h2 className="text-[16px] font-semibold flex items-center gap-2"><MailCheck width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--muted)' }} /> CCP timbrados recibidos</h2>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Cuando el sistema del cliente timbra la carta porte y avisa a Likida, el PDF y el XML se guardan aquí. Si encendes la respuesta, se le manda el CCP al cliente;
          la primera vez por cliente (o si el remitente no se reconoce) necesita tu confirmación.
        </p>
        <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
          Para que un aviso se asocie a un envío, el envío debe tener la referencia del sistema del cliente: se captura al marcar la plantilla como «subida a mano»
          o la guarda el envío automático. Un aviso sin referencia conocida se rechaza.
        </p>
      </header>
      {activa === 'sin_migracion' || filas === 'sin_migracion' ? (
        <p className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Esta función todavía no está disponible en tu entorno.</p>
      ) : (
        <>
          <section className="card p-4 space-y-2" aria-label="Respuesta al cliente">
            <p className="text-[13px] font-medium">Responder al cliente con el CCP timbrado: {activa === true ? 'ENCENDIDO' : 'APAGADO'}</p>
            <FormaAccion accion={acciones.fijar} className="space-y-2">
              {oculto}
              <input type="hidden" name="activo" value={activa === true ? 'no' : 'si'} />
              <BotonEnvio variante="secundario" etiqueta={activa === true ? 'Apagar la respuesta' : 'Encender la respuesta'} pendiente="Guardando…" />
            </FormaAccion>
          </section>

          <section className="space-y-2" aria-label="CCP recibidos">
            {filas.length === 0 ? (
              <p className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Todavía no ha llegado ningún CCP timbrado.</p>
            ) : filas.map((f) => (
              <article key={f.id} className="card p-3.5 space-y-2" aria-label={`CCP ${f.uuid}`}>
                <p className="text-[12.5px]"><strong className="break-all">{f.uuid}</strong> · {ROTULO[f.estado]}</p>
                <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  Recibido {fechaHoraMx(f.creadoEn)}{f.documentoNombre ? ` · documento «${f.documentoNombre}»` : ''}
                  {f.destinoCorreo ? ` · cliente ${f.destinoCorreo}` : ' · sin correo del cliente'}
                  {f.respondidoEn ? ` · respondido ${fechaHoraMx(f.respondidoEn)}` : ''}
                </p>
                {(f.estado === 'pendiente_confirmacion' || f.estado === 'error_envio') && (
                  <FormaAccion accion={acciones.confirmar} className="space-y-2">
                    {oculto}
                    <input type="hidden" name="ccpId" value={f.id} />
                    <label htmlFor={`d-${f.id}`} className={ETIQUETA}>Correo del cliente al que se le responde</label>
                    <input id={`d-${f.id}`} name="destino" type="email" defaultValue={f.destinoCorreo ?? ''} autoComplete="off" className={CAMPO} style={ESTILO} />
                    <BotonEnvio etiqueta="Confirmar y responder al cliente" pendiente="Enviando…" />
                  </FormaAccion>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
