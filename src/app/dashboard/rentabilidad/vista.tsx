import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { Banknote, ReceiptText, TrendingUp, Wallet, CalendarClock } from 'lucide-react';
import type { Rentabilidad, Cobranza } from '@/lib/likida/comercial';
import { mxn, fechaCorta, numero, porcentaje } from '@/lib/formato';
import { EnlacePagina, NavPaginas } from '../paginador';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  BotonEnlace, EstadoError, EstadoVacio, Icono, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase,
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

  return (
    <MarcoPagina titulo={tr('rentabilidad.vista.margenYCostos')} apoyo={tr('rentabilidad.vista.margenRealContraLo')}>
      {sinNada ? (
        <>
          {/* Cinco cifras SIN DATO: la estructura de la pantalla, no ceros que parezcan medición. */}
          <TiraCifras sello={tr('rentabilidad.vista.sinDatosTodavia')}>
            <Cifra icono={<Icono icono={Banknote} />} etiqueta={tr('rentabilidad.vista.ingresoDeFletesLiquidados')} valor={null} estado="vacio" info="rentabilidad.ingreso" />
            <Cifra icono={<Icono icono={ReceiptText} />} etiqueta={tr('rentabilidad.vista.costoComprobado')} valor={null} estado="vacio" info="rentabilidad.costo" />
            <Cifra icono={<Icono icono={TrendingUp} />} etiqueta={tr('rentabilidad.vista.contribucion')} valor={null} estado="vacio" info="rentabilidad.contribucion" />
            <Cifra icono={<Icono icono={Wallet} />} etiqueta={tr('rentabilidad.vista.porCobrar')} valor={null} estado="vacio" info="rentabilidad.por_cobrar" />
            <Cifra icono={<Icono icono={CalendarClock} />} etiqueta={tr('rentabilidad.vista.vencido')} valor={null} estado="vacio" info="rentabilidad.vencido" />
          </TiraCifras>
          <EstadoVacio titulo={tr('rentabilidad.vista.faltanIngresoYFacturas')} contenido
            accion={<BotonEnlace href={`/dashboard/facturacion${sufijo}`} variante="secondary" tamano="sm">{tr('rentabilidad.vista.registrarUnaFactura')}</BotonEnlace>}>
            {tr('rentabilidad.vista.conElIngresoDe')}
          </EstadoVacio>
        </>
      ) : (
        <>
          {/* ── Rentabilidad ─────────────────────────────────────── */}
          {rentabilidad === null ? (
            <EstadoError>{tr('rentabilidad.vista.noPudeLeerLos')}</EstadoError>
          ) : rentabilidad.viajesConIngreso === 0 ? (
            <EstadoVacio titulo={tr('rentabilidad.vista.sinIngresoDeFlete')} contenido>
              {tr('rentabilidad.vista.ningunViajeTraeIngreso')}
            </EstadoVacio>
          ) : (
            <>
              <TiraCifras sello={selloHoy(tr('rentabilidad.vista.selloViajesLiquidados'))}>
                <Cifra
                  icono={<Icono icono={Banknote} />}
                  etiqueta={tr('rentabilidad.vista.ingresoDeFletesLiquidados')} valor={rentabilidad.ingreso} formato="mxn"
                  info="rentabilidad.ingreso" />
                <Cifra
                  icono={<Icono icono={ReceiptText} />}
                  etiqueta={tr('rentabilidad.vista.costoComprobadoEsosMismos')} valor={rentabilidad.costoComprobado} formato="mxn"
                  info="rentabilidad.costo" />
                <Cifra
                  icono={<Icono icono={TrendingUp} />}
                  etiqueta={tr('rentabilidad.vista.contribucionIngresoComprobad')} valor={rentabilidad.contribucion} formato="mxn"
                  info="rentabilidad.contribucion" />
              </TiraCifras>
              <p className="rv-rent__nota">
                {rentabilidad.margenPct !== null
                  ? tr('rentabilidad.vista.margenMedidoSoloSobre', { v: porcentaje(rentabilidad.margenPct), v2: numero(rentabilidad.viajesConIngreso) })
                  : tr('rentabilidad.vista.sinIngresoCapturadoEl')}
                {rentabilidad.viajesSinIngreso > 0
                  && ' ' + tr('rentabilidad.vista.viajesSinIngresoQuedan', { v: numero(rentabilidad.viajesSinIngreso) })}
                {rentabilidad.viajesSinLiquidar !== null && rentabilidad.viajesSinLiquidar > 0
                  && ' ' + tr('rentabilidad.vista.viajesSinLiquidacionVigente', { v: numero(rentabilidad.viajesSinLiquidar) })}
              </p>
              {/* Qué NO trae esa cifra. Va aquí y no en un tooltip porque es la diferencia entre "este viaje dejó dinero" y "este viaje dejó dinero ANTES de pagar al operador y el taller", y de esa distinción dependen decisiones de tarifa. */}
              <p className="rv-rent__pie">
                {tr('rentabilidad.vista.contribucionNoEsUtilidad')}
              </p>
            </>
          )}

          {/* ── Cobranza a clientes ──────────────────────────────── */}
          {cobranza === null ? (
            <EstadoError>{tr('rentabilidad.vista.noPudeLeerLas')}</EstadoError>
          ) : cobranza.total === 0 ? (
            <EstadoVacio titulo={tr('rentabilidad.vista.sinFacturasEmitidas')} contenido>
              {tr('rentabilidad.vista.aunNoHayFacturas')}
            </EstadoVacio>
          ) : (
            <>
              <TiraCifras sello={selloHoy(tr('rentabilidad.vista.selloViajesLiquidados'))}>
                <Cifra
                  icono={<Icono icono={Wallet} />}
                  etiqueta={tr('rentabilidad.vista.porCobrarFacturasVivas')} valor={cobranza.porCobrar} formato="mxn"
                  info="rentabilidad.por_cobrar" />
                <Cifra
                  icono={<Icono icono={CalendarClock} />}
                  etiqueta={tr('rentabilidad.vista.vencido')} valor={cobranza.vencido} formato="mxn"
                  info="rentabilidad.vencido" />
              </TiraCifras>
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
                    idFila={(f) => f.id} altoMaximo={false} tarjetaMovil />
                )}

                {/* ── La cartera viene PAGINADA (mig. 0152) ── Se dice el rango Y el total: recortar la lista está bien, recortar la cifra sin decirlo no. Las cifras de arriba (por cobrar, vencido) son de TODAS las facturas, no de esta página — por eso el renglón lo aclara. */}
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
    </MarcoPagina>
  );
}
