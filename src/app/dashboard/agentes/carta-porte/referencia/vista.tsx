import { ArrowLeft } from 'lucide-react';
import '../carta-porte.css';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { numero } from '@/lib/formato';
import type { ClienteRef, Tablero } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import { REFERENCIA_MAX } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import { BotonEnvio, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';
import { Aviso, BotonEnlace, CampoTexto, EstadoError, EstadoVacio, Icono, MarcoPagina, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }

function Ocultos({ ver }: { ver: VerComo }) {
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
    </>
  );
}

export function VistaReferencia({ tablero, clientes, exigen, folios, truncado, sufijo, ver, acciones, tr = TR_ES }: {
  /** `null` = la lectura falló (se dice, no se pinta «sin pendientes»). */
  tablero: Tablero | null;
  clientes: ClienteRef[];
  exigen: ReadonlySet<string>;
  folios: Record<string, string | null>;
  truncado: boolean;
  sufijo: string;
  ver: VerComo;
  acciones: { capturar: AccionDoc; exigencia: AccionDoc }; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('rest.referencia_del_cliente')} apoyo={tx('rest.algunos_clientes_necesitan_su_referencia_para')} acciones={<BotonEnlace tamano="sm" href={`/dashboard/agentes/carta-porte${sufijo}`} icono={<Icono icono={ArrowLeft} tam={14} />}>{tx('rest.volver_al_agente_de_carta_porte_2')}</BotonEnlace>}>
      <Aviso tono="info">{tx('rest.es_un_aviso_para_quien_la')}</Aviso>

      {tablero === null ? (
        <EstadoError>{tx('rest.no_se_pudieron_leer_los_viajes')}</EstadoError>
      ) : tablero.total === 0 ? (
        <EstadoVacio titulo={tx('rest.sin_viajes_pendientes_de_referencia')} contenido>
          {exigen.size === 0 ? tx('rest.ningun_cliente_exige_referencia_todavia_enciende') : tx('rest.no_hay_viajes_cargados_sin_referencia')}
        </EstadoVacio>
      ) : (
        <section aria-label={tx('rest.pendientes')} className="rv-cp__pila">
          <p className="rv-cp__nota"><strong>{numero(tablero.total)}</strong> {tablero.total === 1 ? 'viaje' : 'viajes'}{' '}{tx('rest.sin_referencia')}{truncado ? tx('rest.la_lectura_llego_a_su_tope') : ''}.</p>
          {tablero.clientes.map((c) => (
            <Tarjeta key={c.clienteId} titulo={tx('rest.el_mas_antiguo_lleva_h', { clienteNombre: c.clienteNombre, numero: numero(c.pendientes), numero2: numero(c.masAntiguoHoras) })} info="carta_porte_referencia.pendientes_cliente">
              <ul className="rv-cp__filas">
                {c.viajes.slice(0, 50).map((v) => (
                  <li key={v.viajeId}>
                    <FormaAccion accion={acciones.capturar} className="rv-cp__fila">
                      <Ocultos ver={ver} />
                      <input type="hidden" name="viajeId" value={v.viajeId} />
                      <CampoTexto id={`ref-${v.viajeId}`} etiqueta={`Viaje ${folios[v.viajeId] ?? v.viajeId.slice(0, 8)} · ${numero(v.antiguedadHoras)} h`} ayuda={tx('rest.referencia_del_cliente')}
                        name="referencia" maxLength={REFERENCIA_MAX} placeholder={tx('rest.referencia_del_cliente')} />
                      <BotonEnvio variante="secundario" etiqueta={tx('rest.guardar')} pendiente={tx('cobranza.formagasto.guardando')} />
                    </FormaAccion>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          ))}
        </section>
      )}

      <Tarjeta titulo={tx('rest.clientes_que_exigen_referencia')} info="carta_porte_referencia.exigen" estado={clientes.length === 0 ? 'vacio' : 'ok'} mensaje={tx('rest.aun_no_hay_clientes')} detalle={tx('rest.aun_no_hay_clientes_en_la')}>
        <ul className="rv-cp__filas">
          {clientes.map((c) => (
            <li key={c.id}>
              <FormaAccion accion={acciones.exigencia} className="rv-cp__fila">
                <Ocultos ver={ver} />
                <input type="hidden" name="clienteId" value={c.id} />
                <input type="hidden" name="exige" value={exigen.has(c.id) ? '0' : '1'} />
                <span className="rv-cp__nota"><strong>{c.nombre}</strong> · <StatusChip tono={exigen.has(c.id) ? 'info' : 'muted'}>{exigen.has(c.id) ? tx('rest.la_exige') : tx('rest.no_la_exige')}</StatusChip></span>
                <BotonEnvio variante="secundario" etiqueta={exigen.has(c.id) ? tx('rest.dejar_de_exigir') : tx('rest.exigir')} pendiente={tx('cobranza.formagasto.guardando')} />
              </FormaAccion>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </MarcoPagina>
  );
}
