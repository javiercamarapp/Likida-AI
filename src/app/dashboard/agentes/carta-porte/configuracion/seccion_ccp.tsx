'use client';

import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import type { CcpRecibidoVista } from '@/lib/likida/carta_porte_docs/ccp_respuesta_repo';
import type { EstadoCcpTimbrado } from '@/lib/likida/carta_porte_docs/ccp_respuesta';
import { fechaHoraMx } from '@/lib/formato';
import { BotonEnvio, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';

/**
 * A37-A3-01 · «CCP timbrados recibidos»: el interruptor de la respuesta al cliente (apagado de arranque) y la lista de los CCP
 * que el sistema del cliente avisó, con la confirmación humana de la primera respuesta por cliente. NADA sale sin que una
 * persona lo confirme la primera vez; el correo lleva el PDF y el XML timbrados tal como llegaron.
 */

import '../carta-porte.css';
import { CampoTexto, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';

export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }
export interface AccionesCcp { fijar: AccionDoc; confirmar: AccionDoc }

const ROTULO: Record<EstadoCcpTimbrado, string> = {
  guardado: 'Guardado (la respuesta estaba apagada)',
  pendiente_confirmacion: 'Espera tu confirmación',
  respondido: 'Respondido al cliente',
  error_envio: 'El correo no salió: reintenta',
};

const TONO: Record<EstadoCcpTimbrado, TonoEstado> = { guardado: 'muted', pendiente_confirmacion: 'warn', respondido: 'ok', error_envio: 'bad' };

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
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
    </>
  );
  return (
    <Tarjeta titulo="CCP timbrados recibidos">
      <div className="rv-cp__pila">
        <p className="rv-cp__nota">
          Cuando el sistema del cliente timbra la carta porte y avisa a Likida, el PDF y el XML se guardan aquí. Si encendes la respuesta, se le manda el CCP al cliente;
          la primera vez por cliente (o si el remitente no se reconoce) necesita tu confirmación. El aviso automático desde el sistema del cliente está por conectar.
        </p>
        <p className="rv-cp__nota" data-tono="faint">
          Para que un aviso se asocie a un envío, el envío debe tener la referencia del sistema del cliente: se captura al marcar la plantilla como «subida a mano»
          o la guardará el envío automático cuando esté conectado (hoy está por conectar). Un aviso sin referencia conocida se rechaza.
        </p>
        {activa === 'sin_migracion' || filas === 'sin_migracion' ? (
          <p className="rv-cp__nota">Esta función todavía no está disponible en tu entorno.</p>
        ) : (
          <>
            <section className="rv-cp__bloque" aria-label="Respuesta al cliente">
              <p className="rv-cp__frase">Responder al cliente con el CCP timbrado: {activa === true ? 'ENCENDIDO' : 'APAGADO'}</p>
              <FormaAccion accion={acciones.fijar} className="rv-cp__pila">
                {oculto}
                <input type="hidden" name="activo" value={activa === true ? 'no' : 'si'} />
                <BotonEnvio variante="secundario" etiqueta={activa === true ? 'Apagar la respuesta' : 'Encender la respuesta'} pendiente="Guardando…" />
              </FormaAccion>
            </section>

            <section className="rv-cp__pila" aria-label="CCP recibidos">
              {filas.length === 0 ? (
                <p className="rv-cp__nota">Todavía no ha llegado ningún CCP timbrado.</p>
              ) : filas.map((f) => (
                <article key={f.id} className="rv-cp__bloque" aria-label={`CCP ${f.uuid}`}>
                  <p className="rv-cp__nota"><strong className="rv-cp__romper">{f.uuid}</strong> · <StatusChip tono={TONO[f.estado]}>{ROTULO[f.estado]}</StatusChip></p>
                  <p className="rv-cp__nota">
                    Recibido {fechaHoraMx(f.creadoEn)}{f.documentoNombre ? ` · documento «${f.documentoNombre}»` : ''}
                    {f.destinoCorreo ? ` · cliente ${f.destinoCorreo}` : ' · sin correo del cliente'}
                    {f.respondidoEn ? ` · respondido ${fechaHoraMx(f.respondidoEn)}` : ''}
                  </p>
                  {/* A37-P-04: el PDF y el XML guardados, por la ruta autenticada y filtrada por flota (nunca una URL pública). */}
                  <p className="rv-cp__acciones">
                    {(['pdf', 'xml'] as const).map((tipo) => (
                      <a key={tipo} className="rv-cp__enlace" href={`/api/export/carta-porte-docs?ccp=${encodeURIComponent(f.id)}&archivo=${tipo}${ver.tenant ? `&tenant=${encodeURIComponent(ver.tenant)}` : ''}`}
                        download aria-label={`Descargar el ${tipo.toUpperCase()} del CCP ${f.uuid}`}>Descargar {tipo.toUpperCase()}</a>
                    ))}
                  </p>
                  {(f.estado === 'pendiente_confirmacion' || f.estado === 'error_envio') && (
                    <FormaAccion accion={acciones.confirmar} className="rv-cp__form">
                      {oculto}
                      <input type="hidden" name="ccpId" value={f.id} />
                      <CampoTexto id={`d-${f.id}`} etiqueta="Correo del cliente al que se le responde" name="destino" tipo="email" defaultValue={f.destinoCorreo ?? ''} autoComplete="off" />
                      <BotonEnvio etiqueta="Confirmar y responder al cliente" pendiente="Enviando…" />
                    </FormaAccion>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </Tarjeta>
  );
}
