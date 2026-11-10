import { Tarjeta } from '@/app/ui-v2/componentes';
import '../peajes.css';
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
export function SeccionCruceViajes({ datos }: { datos: CruceViajesVista }) {
  const { activo, fuente, puedeAdministrar, acciones } = datos;
  return (
    <div id="cruce-viajes">
    <Tarjeta titulo="Cruce de cobros con viajes">
      <p className="text-[11px] mb-3 rv-pj-c-faint">
        Liga cada cobro del proveedor con su viaje: primero por <b>Icident</b> (el número de despacho del sistema de transporte), y si el cobro no lo trae,
        por unidad y fecha. Es una señal para revisar, no una acusación. Apagado de origen: sin viajes cargados todo saldría «sin viaje».
      </p>
      {activo === null ? (
        <p className="text-[12px] rv-pj-c-muted">No se pudo leer el estado del cruce ahora mismo.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px]">
            Estado: <b>{activo ? 'encendido' : 'apagado'}</b>.
            {fuente === null
              ? ' No se pudo leer cuántos viajes hay cargados.'
              : ` Hay ${fuente.viajes} viaje(s) cargado(s), ${fuente.viajesConDespacho} con Icident, y ${fuente.posicionesConDespacho} posición(es) con Icident.`}
          </p>
          {fuente !== null && fuente.viajes === 0 && (
            <p role="note" className="rv-pj-caja rv-pj-sub">
              Todavía no hay viajes cargados: si lo enciendes ahora, todos los cobros saldrán «sin viaje». Enciéndelo cuando el sistema de transporte ya entregue los viajes.
            </p>
          )}
          {!puedeAdministrar ? (
            <p className="text-[12px] rv-pj-c-muted">Solo quien administra la flota lo cambia.</p>
          ) : (
            <form action={acciones.guardarCruceViajes} className="flex items-center gap-2 flex-wrap">
              <input type="hidden" name="activo" value={activo ? '0' : '1'} />
              <button type="submit" className="rv-btn rv-btn--primary">{activo ? 'Apagar el cruce' : 'Encender el cruce'}</button>
              <span className="text-[11px] rv-pj-c-faint">Aplica a los archivos que se concilien desde ahora; los anteriores se recalculan al reprocesarlos.</span>
            </form>
          )}
        </div>
      )}
    </Tarjeta>
    </div>
  );
}
