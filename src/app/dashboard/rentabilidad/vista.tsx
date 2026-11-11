import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import type { Rentabilidad, Cobranza } from '@/lib/likida/comercial';
import { mxn, fechaCorta, numero, porcentaje } from '@/lib/formato';
import { EnlacePagina, NavPaginas } from '../paginador';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPortada } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  BotonEnlace, EstadoError, EstadoVacio, StatusChip, TablaBase, Tarjeta, type ColumnaBase,
} from '@/app/ui-v2/componentes';
import './rentabilidad.css';


/** El href de otra página de la cartera, conservando el sufijo de
 *  previsualización (`?tenant=`/`?vista=`/`?rol=`): si un link lo pierde, el
 *  siguiente clic devuelve al superadmin a otra flota sin avisar. */
export function hrefPagina(sufijo: string, pagina: number): string {
  const params = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  if (pagina > 1) params.set('p', String(pagina)); else params.delete('p');
  const qs = params.toString();
  return `/dashboard/rentabilidad${qs ? `?${qs}` : ''}`;
}

/**
 * La vista de Rentabilidad y cobranza — pura props para poder verificarla
 * mirando con fixtures. Tres estados por bloque: datos reales, vacío que
 * explica qué lo enciende, o el error dicho (nunca un vacío fingido sobre
 * una tabla ilegible).
 */
type FilaCartera = NonNullable<Cobranza['facturas']>[number];

export function VistaRentabilidad({
  rentabilidad, cobranza, sufijo = '', tr = trEs,
}: {
  rentabilidad: Rentabilidad | null;
  cobranza: Cobranza | null;
  /** El `?tenant=`/`?vista=`/`?rol=` que hay que conservar al pasar de página. */
  sufijo?: string; tr?: Tr;
}) {
  const sinNada = rentabilidad !== null && cobranza !== null
    && rentabilidad.viajesConIngreso === 0 && cobranza.total === 0;

  // El rango de la página, para decirlo en palabras. `desde` y `hasta` son lo
  // que se IMPRIME: los dos son 0 cuando la página quedó vacía (alguien tecleó
  // `?p=99`), y entonces el renglón dice "0–0 de N", que es la verdad, en vez
  // de un rango inventado — `(99−1)·100 + 0` imprimía "0–9,800 de 350".
  // `hayMas` NO se calcula sobre lo impreso sino sobre el desplazamiento real
  // (`consumidas`), para no ofrecer "Siguientes" hacia otra página vacía.
  const consumidas = cobranza
    ? (cobranza.pagina - 1) * cobranza.porPagina + cobranza.facturas.length : 0;
  const desde = cobranza && cobranza.facturas.length
    ? (cobranza.pagina - 1) * cobranza.porPagina + 1 : 0;
  const hasta = cobranza && cobranza.facturas.length ? consumidas : 0;
  const hayMas = cobranza ? consumidas < cobranza.total : false;

  const columnas: ColumnaBase<FilaCartera>[] = [
    {
      id: 'folio', titulo: tr('rentabilidad.vista.folio'), principal: true,
      celda: (f) => (
        <>
          {f.folio ?? '—'}
          <span className="rv-rent__tenue">{fechaCorta(f.fecha)}</span>
        </>
      ),
    },
    { id: 'cliente', titulo: tr('rentabilidad.vista.cliente'), celda: (f) => f.cliente },
    { id: 'total', titulo: tr('rentabilidad.vista.total'), alinear: 'der', celda: (f) => mxn(f.total) },
    { id: 'pagado', titulo: tr('rentabilidad.vista.pagado'), alinear: 'der', celda: (f) => mxn(f.pagado) },
    { id: 'saldo', titulo: tr('rentabilidad.vista.saldo'), alinear: 'der', celda: (f) => <strong>{mxn(f.saldo)}</strong> },
    {
      id: 'vence', titulo: tr('rentabilidad.vista.vence'),
      celda: (f) => (f.vencida
        ? <StatusChip tono="bad">{`venció ${fechaCorta(f.venceEn)}`}</StatusChip>
        : (f.venceEn ? fechaCorta(f.venceEn) : <span className="rv-rent__tenue">{tr('rentabilidad.vista.sinCondiciones')}</span>)),
    },
  ];

  const sinRent = rentabilidad === null ? 'error' : rentabilidad.viajesConIngreso === 0 ? 'vacio' : 'ok';
  const sinCob = cobranza === null ? 'error' : cobranza.total === 0 ? 'vacio' : 'ok';
  // UNA tira de cinco (Rovaq `pc-kpis`): cada celda dice su propio estado — una lectura caída es «No disponible ahora. No es cero.», nunca un 0.
  const cifras: PropsCifra[] = [
    { etiqueta: tr('rentabilidad.vista.ingresoDeFletesLiquidados'), info: 'rentabilidad.ingreso', formato: 'mxn', valor: sinRent === 'ok' ? rentabilidad!.ingreso : null, estado: sinRent, mensaje: sinRent === 'vacio' ? tr('rentabilidad.vista.sinIngresoDeFlete') : undefined, reintentar: sinRent === 'error' },
    { etiqueta: tr('rentabilidad.vista.costoComprobadoEsosMismos'), info: 'rentabilidad.costo', formato: 'mxn', valor: sinRent === 'ok' ? rentabilidad!.costoComprobado : null, estado: sinRent },
    { etiqueta: tr('rentabilidad.vista.contribucionIngresoComprobad'), info: 'rentabilidad.contribucion', formato: 'mxn', valor: sinRent === 'ok' ? rentabilidad!.contribucion : null, estado: sinRent },
    { etiqueta: tr('rentabilidad.vista.porCobrarFacturasVivas'), info: 'rentabilidad.por_cobrar', formato: 'mxn', valor: sinCob === 'ok' ? cobranza!.porCobrar : null, estado: sinCob, mensaje: sinCob === 'vacio' ? tr('rentabilidad.vista.sinFacturasEmitidas') : undefined, reintentar: sinCob === 'error' },
    { etiqueta: tr('rentabilidad.vista.vencido'), info: 'rentabilidad.vencido', formato: 'mxn', valor: sinCob === 'ok' ? cobranza!.vencido : null, estado: sinCob, tono: sinCob === 'ok' && cobranza!.vencido > 0 ? 'bad' : undefined },
  ];

  return (
    <EsqueletoPortada
      titulo={tr('rentabilidad.vista.margenYCostos')} apoyo={tr('rentabilidad.vista.margenRealContraLo')}
      cifras={cifras} etiquetaCifras={tr('rentabilidad.vista.margenYCostos')}
      selloCifras={sinNada ? tr('rentabilidad.vista.sinDatosTodavia') : selloHoy(tr('rentabilidad.vista.selloViajesLiquidados'))}
      metodo={rentabilidad !== null && rentabilidad.viajesConIngreso > 0 ? tr('rentabilidad.vista.contribucionNoEsUtilidad') : undefined}
    >
      {sinNada ? (
        <EstadoVacio titulo={tr('rentabilidad.vista.faltanIngresoYFacturas')} contenido
          accion={<BotonEnlace href={`/dashboard/facturacion${sufijo}`} variante="secondary" tamano="sm">{tr('rentabilidad.vista.registrarUnaFactura')}</BotonEnlace>}>
          {tr('rentabilidad.vista.conElIngresoDe')}
        </EstadoVacio>
      ) : (
        <>
          {rentabilidad === null ? (
            <EstadoError>{tr('rentabilidad.vista.noPudeLeerLos')}</EstadoError>
          ) : rentabilidad.viajesConIngreso === 0 ? (
            <EstadoVacio titulo={tr('rentabilidad.vista.sinIngresoDeFlete')} contenido>
              {tr('rentabilidad.vista.ningunViajeTraeIngreso')}
            </EstadoVacio>
          ) : (
            <p className="rv-rent__nota">
              {rentabilidad.margenPct !== null
                ? tr('rentabilidad.vista.margenMedidoSoloSobre', { v: porcentaje(rentabilidad.margenPct), v2: numero(rentabilidad.viajesConIngreso) })
                : tr('rentabilidad.vista.sinIngresoCapturadoEl')}
              {rentabilidad.viajesSinIngreso > 0
                && ' ' + tr('rentabilidad.vista.viajesSinIngresoQuedan', { v: numero(rentabilidad.viajesSinIngreso) })}
              {rentabilidad.viajesSinLiquidar !== null && rentabilidad.viajesSinLiquidar > 0
                && ' ' + tr('rentabilidad.vista.viajesSinLiquidacionVigente', { v: numero(rentabilidad.viajesSinLiquidar) })}
            </p>
          )}

          {cobranza === null ? (
            <EstadoError>{tr('rentabilidad.vista.noPudeLeerLas')}</EstadoError>
          ) : cobranza.total === 0 ? (
            <EstadoVacio titulo={tr('rentabilidad.vista.sinFacturasEmitidas')} contenido>
              {tr('rentabilidad.vista.aunNoHayFacturas')}
            </EstadoVacio>
          ) : (
            <>
              {cobranza.sinCondiciones > 0 && (
                <p className="rv-rent__nota" data-tono="warn">
                  {cobranza.sinCondiciones === 1
                    ? tr('rentabilidad.vista.1FacturaNoTiene')
                    : tr('rentabilidad.vista.facturasNoTienenFecha', { sinCondiciones: cobranza.sinCondiciones })}
                </p>
              )}
              <Tarjeta titulo={tr('rentabilidad.vista.carteraPorCobrar')}>
                {cobranza.facturas.length === 0 ? (
                  // `total > 0` pero esta página no trajo filas: es un `?p=` fuera de rango, NO una cartera vacía — las cifras de arriba (de la cartera completa) siguen siendo ciertas. El renglón de paginación de abajo ya trae "Anteriores".
                  <p className="rv-rent__nota">
                    {tr('rentabilidad.vista.estaPaginaNoTiene', { v: numero(cobranza.total) })}
                  </p>
                ) : (
                  <TablaBase<FilaCartera> etiqueta={tr('rentabilidad.vista.rentabilidadPorFolioY')} columnas={columnas} filas={cobranza.facturas}
                    idFila={(f) => f.id} densa altoMaximo={false} tarjetaMovil />
                )}

                {/* La cartera viene PAGINADA (mig. 0152): se dice el rango Y el total. Las cifras de arriba son de TODAS las facturas, no de esta página. */}
                <div className="rv-rent__pie-lista">
                  <span className="rv-rent__pie">
                    {tr('rentabilidad.vista.facturasDe', { v: numero(desde), v2: numero(hasta), v3: numero(cobranza.total) }) + ' '}
                    {tr('rentabilidad.vista.lasVencidasPrimeroPor')}
                  </span>
                  {(cobranza.pagina > 1 || hayMas) && (
                    <NavPaginas>
                      {cobranza.pagina > 1 && <EnlacePagina href={hrefPagina(sufijo, cobranza.pagina - 1)} direccion="anterior" />}
                      {hayMas && <EnlacePagina href={hrefPagina(sufijo, cobranza.pagina + 1)} direccion="siguiente" />}
                    </NavPaginas>
                  )}
                </div>
              </Tarjeta>
            </>
          )}
        </>
      )}
    </EsqueletoPortada>
  );
}
