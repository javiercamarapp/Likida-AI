import { Tarjeta } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';
type Accion = (fd: FormData) => Promise<void>;

export interface CruceViajesVista {
  /** `null` = no se pudo leer. */
  activo: boolean | null;
  /** Lo que la flota ya tiene cargado y alimenta el cruce. `null` = no se pudo leer. */
  fuente: { viajes: number; viajesConDespacho: number; posicionesConDespacho: number } | null;
  puedeAdministrar: boolean;
  acciones: { guardarCruceViajes: Accion };
}


/**
 * CRUCE COBRO ↔ VIAJE: el interruptor por flota (apagado de origen). Encendido, cada archivo conciliado liga sus cobros con el
 * viaje del TMS por `Icident` (columna del cobro, `despacho_ref` del viaje y de las posiciones) y, si no hay, por unidad + ventana
 * de días. Sin viajes cargados todo saldría «sin viaje»: eso es ruido, no un hallazgo, por eso nace apagado.
 */
export function SeccionCruceViajes({ datos, tr = TR_ES }: { datos: CruceViajesVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { activo, fuente, puedeAdministrar, acciones } = datos;
  return (
    <div id="cruce-viajes">
    <Tarjeta titulo={tx('rest.cruce_de_cobros_con_viajes')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.liga_cada_cobro_del_proveedor_con'), { b: (c) => <b>{c}</b> })}</p>
      {activo === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_el_estado_2')}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px]">{tx('rest.estado')}{' '}<b>{activo ? 'encendido' : 'apagado'}</b>.
            {fuente === null
              ? tx('rest.no_se_pudo_leer_cuantos_viajes')
              : tx('rest.hay_viaje_s_cargado_s_con', { viajes: fuente.viajes, viajesConDespacho: fuente.viajesConDespacho, posicionesConDespacho: fuente.posicionesConDespacho })}
          </p>
          {fuente !== null && fuente.viajes === 0 && (
            <p role="note" className="rv-pj-caja rv-pj-sub">{tx('rest.todavia_no_hay_viajes_cargados_si')}</p>
          )}
          {!puedeAdministrar ? (
            <p className="text-[12px] rv-pj-c-muted">{tx('rest.solo_quien_administra_la_flota_lo')}</p>
          ) : (
            <form action={acciones.guardarCruceViajes} className="flex items-center gap-2 flex-wrap">
              <input type="hidden" name="activo" value={activo ? '0' : '1'} />
              <button type="submit" className="rv-btn rv-btn--primary">{activo ? tx('rest.apagar_el_cruce') : tx('rest.encender_el_cruce')}</button>{ricoT(tx('rest.e0_aplica_a_los_archivos_que'), { e0: (c) => <span className="text-[11px] rv-pj-c-faint">{c}</span> })}</form>
          )}
        </div>
      )}
    </Tarjeta>
    </div>
  );
}
