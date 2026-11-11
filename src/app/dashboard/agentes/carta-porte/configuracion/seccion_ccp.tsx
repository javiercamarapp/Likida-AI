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
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }
export interface AccionesCcp { fijar: AccionDoc; confirmar: AccionDoc }

const rotulo = (tx: TAgentes = TR_ES.t): Record<EstadoCcpTimbrado, string> => ({
  guardado: 'Guardado (la respuesta estaba apagada)',
  pendiente_confirmacion: tx('rest.espera_tu_confirmacion'),
  respondido: tx('rest.respondido_al_cliente'),
  error_envio: tx('rest.el_correo_no_salio_reintenta'),
});

const TONO: Record<EstadoCcpTimbrado, TonoEstado> = { guardado: 'muted', pendiente_confirmacion: 'warn', respondido: 'ok', error_envio: 'bad' };

export function SeccionCcp({ activa, filas, ver, acciones }: {
  activa: boolean | 'sin_migracion';
  filas: CcpRecibidoVista[] | 'sin_migracion';
  ver: VerComo;
  acciones: AccionesCcp;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const oculto = (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
    </>
  );
  return (
    <Tarjeta titulo={tx('rest.ccp_timbrados_recibidos')}>
      <div className="rv-cp__pila">
        <p className="rv-cp__nota">{tx('rest.cuando_el_sistema_del_cliente_timbra')}</p>
        <p className="rv-cp__nota" data-tono="faint">{tx('rest.para_que_un_aviso_se_asocie')}</p>
        {activa === 'sin_migracion' || filas === 'sin_migracion' ? (
          <p className="rv-cp__nota">{tx('rest.esta_funcion_todavia_no_esta_disponible')}</p>
        ) : (
          <>
            <section className="rv-cp__bloque" aria-label={tx('rest.respuesta_al_cliente')}>
              <p className="rv-cp__frase">{tx('rest.responder_al_cliente_con_el_ccp')}{' '}{activa === true ? 'ENCENDIDO' : 'APAGADO'}</p>
              <FormaAccion accion={acciones.fijar} className="rv-cp__pila">
                {oculto}
                <input type="hidden" name="activo" value={activa === true ? 'no' : 'si'} />
                <BotonEnvio variante="secundario" etiqueta={activa === true ? tx('rest.apagar_la_respuesta') : tx('rest.encender_la_respuesta')} pendiente={tx('cobranza.formagasto.guardando')} />
              </FormaAccion>
            </section>

            <section className="rv-cp__pila" aria-label={tx('rest.ccp_recibidos')}>
              {filas.length === 0 ? (
                <p className="rv-cp__nota">{tx('rest.todavia_no_ha_llegado_ningun_ccp')}</p>
              ) : filas.map((f) => (
                <article key={f.id} className="rv-cp__bloque" aria-label={`CCP ${f.uuid}`}>
                  <p className="rv-cp__nota"><strong className="rv-cp__romper">{f.uuid}</strong> · <StatusChip tono={TONO[f.estado]}>{rotulo(tx)[f.estado]}</StatusChip></p>
                  <p className="rv-cp__nota">{tx('rest.recibido')}{' '}{fechaHoraMx(f.creadoEn)}{f.documentoNombre ? ` · documento «${f.documentoNombre}»` : ''}
                    {f.destinoCorreo ? ` · cliente ${f.destinoCorreo}` : tx('rest.sin_correo_del_cliente')}
                    {f.respondidoEn ? ` · respondido ${fechaHoraMx(f.respondidoEn)}` : ''}
                  </p>
                  {/* A37-P-04: el PDF y el XML guardados, por la ruta autenticada y filtrada por flota (nunca una URL pública). */}
                  <p className="rv-cp__acciones">
                    {(['pdf', 'xml'] as const).map((tipo) => (
                      <a key={tipo} className="rv-cp__enlace" href={`/api/export/carta-porte-docs?ccp=${encodeURIComponent(f.id)}&archivo=${tipo}${ver.tenant ? `&tenant=${encodeURIComponent(ver.tenant)}` : ''}`}
                        download aria-label={tx('rest.descargar_el_del_ccp', { tipo: tipo.toUpperCase(), uuid: f.uuid })}>{tx('rest.descargar')}{' '}{tipo.toUpperCase()}</a>
                    ))}
                  </p>
                  {(f.estado === 'pendiente_confirmacion' || f.estado === 'error_envio') && (
                    <FormaAccion accion={acciones.confirmar} className="rv-cp__form">
                      {oculto}
                      <input type="hidden" name="ccpId" value={f.id} />
                      <CampoTexto id={`d-${f.id}`} etiqueta={tx('rest.correo_del_cliente_al_que_se')} name="destino" tipo="email" defaultValue={f.destinoCorreo ?? ''} autoComplete="off" />
                      <BotonEnvio etiqueta={tx('rest.confirmar_y_responder_al_cliente')} pendiente={tx('rest.enviando')} />
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
