import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import type { Rentabilidad, Cobranza } from '@/lib/likida/comercial';
import { mxn, fechaCorta, numero, porcentaje } from '@/lib/formato';
import { EnlacePagina, NavPaginas } from '../paginador';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { BarList } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  BotonEnlace, StatusChip, TablaBase, Tarjeta, type ColumnaBase,
} from '@/app/ui-v2/componentes';
import { BarraPeriodo } from '@/app/ui-v2/componentes';
import { PERIODOS_RENTABILIDAD, type PeriodoRentabilidad } from './periodo';
import './rentabilidad.css';


/** El href de otra página de la cartera, conservando el sufijo de
 *  previsualización (`?tenant=`/`?vista=`/`?rol=`): si un link lo pierde, el
 *  siguiente clic devuelve al superadmin a otra flota sin avisar. */
export function hrefPagina(sufijo: string, pagina: number, periodo: PeriodoRentabilidad = 'todo'): string {
  const params = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  if (periodo !== 'todo') params.set('periodo', periodo); else params.delete('periodo');
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
  rentabilidad, cobranza, sufijo = '', periodo = 'todo', tr = trEs,
}: {
  rentabilidad: Rentabilidad | null;
  cobranza: Cobranza | null;
  /** El `?tenant=`/`?vista=`/`?rol=` que hay que conservar al pasar de página. */
  sufijo?: string; tr?: Tr;
  /** La ventana de viajes que mide el margen (`?periodo=`). */
  periodo?: PeriodoRentabilidad;
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
  // Cuatro cifras con rótulo de UNA línea (lo largo vive en la ⓘ). El vencido es nota de «Por cobrar». Sin NINGUNA lectura útil no hay tira: las dos tarjetas de abajo
  // ya dicen por qué (no se repite «Sin dato» cinco veces); si una lectura cayó pero la otra no, la celda caída lo dice («No disponible ahora. No es cero.»).
  // La tira SIEMPRE está (Rovaq PC): una cifra sin dato dice «—» con su pista punteada, nunca un cero; el estado de cada celda es el de su propia lectura.
  const cifras: PropsCifra[] = [
    { etiqueta: tr('e27.rent_ingreso'), matiz: 1, info: 'rentabilidad.ingreso', formato: 'mxn', valor: sinRent === 'ok' ? rentabilidad!.ingreso : null, estado: sinRent, reintentar: sinRent === 'error' },
    { etiqueta: tr('e27.rent_costo'), matiz: 1, info: 'rentabilidad.costo', formato: 'mxn', valor: sinRent === 'ok' ? rentabilidad!.costoComprobado : null, estado: sinRent, nota: sinRent === 'ok' ? tr('e27.rent_costo_nota') : undefined },
    { etiqueta: tr('e27.rent_contrib'), matiz: 1, info: 'rentabilidad.contribucion', formato: 'mxn', valor: sinRent === 'ok' ? rentabilidad!.contribucion : null, estado: sinRent },
    { etiqueta: tr('e27.rent_por_cobrar'), matiz: 1, info: 'rentabilidad.por_cobrar', formato: 'mxn', valor: sinCob === 'ok' ? cobranza!.porCobrar : null, estado: sinCob, reintentar: sinCob === 'error', nota: sinCob === 'ok' ? tr('e27.rent_nota_vencido', { v: mxn(cobranza!.vencido) }) : undefined, tono: sinCob === 'ok' && cobranza!.vencido > 0 ? 'bad' : undefined },
  ];

  // «Qué se sabe / Qué no se sabe» (Rovaq PC): solo hechos leídos de las dos consultas; lo que no se mide se DICE, no se rellena.
  const seSabe: string[] = [];
  const noSeSabe: string[] = [];
  if (rentabilidad !== null && rentabilidad.viajesConIngreso > 0) {
    seSabe.push(tr('e26b.rent_se_sabe_viajes', { n: numero(rentabilidad.viajesConIngreso) }));
    noSeSabe.push(tr('rentabilidad.vista.contribucionNoEsUtilidad'));
  } else {
    noSeSabe.push(tr('e26b.rent_no_sabe_margen'));
  }
  if (rentabilidad !== null && rentabilidad.viajesSinIngreso > 0) noSeSabe.push(rentabilidad.viajesSinIngreso === 1 ? tr('e27.rent_sin_ing_uno') : tr('rentabilidad.vista.viajesSinIngresoQuedan', { v: numero(rentabilidad.viajesSinIngreso) }));
  if (rentabilidad !== null && rentabilidad.viajesSinLiquidar !== null && rentabilidad.viajesSinLiquidar > 0) noSeSabe.push(rentabilidad.viajesSinLiquidar === 1 ? tr('e27.rent_sin_liq_uno') : tr('rentabilidad.vista.viajesSinLiquidacionVigente', { v: numero(rentabilidad.viajesSinLiquidar) }));
  if (cobranza !== null && cobranza.total > 0) seSabe.push(tr('e26b.rent_se_sabe_facturas', { n: numero(cobranza.total) }));
  if (cobranza !== null && cobranza.sinCondiciones > 0) noSeSabe.push(cobranza.sinCondiciones === 1 ? tr('rentabilidad.vista.1FacturaNoTiene') : tr('rentabilidad.vista.facturasNoTienenFecha', { sinCondiciones: cobranza.sinCondiciones }));
  if (rentabilidad === null) noSeSabe.push(tr('rentabilidad.vista.noPudeLeerLos'));
  if (cobranza === null) noSeSabe.push(tr('rentabilidad.vista.noPudeLeerLas'));
  if (seSabe.length === 0) seSabe.push(tr('e26b.rent_se_sabe_nada'));

  const hrefPeriodo = (p: PeriodoRentabilidad) => hrefPagina(sufijo, 1, p);
  const filtros = (
    <BarraPeriodo etiqueta={tr('r4.rent_periodo')}
      periodo={{ etiqueta: tr('r4.rent_periodo'), valor: periodo, opciones: PERIODOS_RENTABILIDAD.map((p) => ({ valor: p, etiqueta: tr(`r4.rent_p_${p}` as 'r4.rent_p_todo'), href: hrefPeriodo(p) })) }} />
  );
  const accionRegistrar = <BotonEnlace href={`/dashboard/facturacion${sufijo}`} variante="secondary" tamano="sm">{tr('rentabilidad.vista.registrarUnaFactura')}</BotonEnlace>;
  const titular = sinRent === 'ok' && rentabilidad!.margenPct !== null
    ? tr('e26b.rent_titular', { pct: porcentaje(rentabilidad!.margenPct), n: numero(rentabilidad!.viajesConIngreso) })
    : sinNada ? tr('rentabilidad.vista.sinDatosTodavia') : undefined;

  // Las gráficas: cada tarjeta dice su propio estado. Sin dato es «No disponible ahora. No es cero.», nunca una barra en cero.
  const graficaMargen = (
    <Tarjeta key="margen" titulo={tr('e26b.rent_grafica_margen')} info="rentabilidad.contribucion"
      estado={sinRent === 'ok' ? 'ok' : sinRent}
      mensaje={sinRent === 'error' ? tr('rentabilidad.vista.noPudeLeerLos') : sinNada ? tr('rentabilidad.vista.faltanIngresoYFacturas') : tr('rentabilidad.vista.sinIngresoDeFlete')}
      detalle={sinRent === 'vacio' ? (sinNada ? tr('rentabilidad.vista.conElIngresoDe') : tr('rentabilidad.vista.ningunViajeTraeIngreso')) : undefined}
      accionVacio={sinNada ? accionRegistrar : undefined} reintentar={sinRent === 'error'} contenida className="rv-rent__graf">
      {sinRent === 'ok' ? (
        <BarList etiqueta={tr('e26b.rent_grafica_margen')} formato={mxn} matiz={1} items={[
          { clave: 'ingreso', etiqueta: tr('e26b.rent_barra_ingreso'), valor: rentabilidad!.ingreso },
          { clave: 'costo', etiqueta: tr('e26b.rent_barra_costo'), valor: rentabilidad!.costoComprobado },
          { clave: 'contribucion', etiqueta: tr('e26b.rent_barra_contribucion'), valor: Math.max(0, rentabilidad!.contribucion), texto: mxn(rentabilidad!.contribucion) },
        ]} />
      ) : null}
    </Tarjeta>
  );
  const graficaCartera = (
    <Tarjeta key="cartera" titulo={tr('e26b.rent_grafica_cartera')} info="rentabilidad.por_cobrar"
      estado={sinCob === 'ok' ? 'ok' : sinCob}
      mensaje={sinCob === 'error' ? tr('rentabilidad.vista.noPudeLeerLas') : tr('rentabilidad.vista.sinFacturasEmitidas')}
      detalle={sinCob === 'vacio' ? tr('rentabilidad.vista.aunNoHayFacturas') : undefined}
      accionVacio={sinCob === 'vacio' && !sinNada ? accionRegistrar : undefined} reintentar={sinCob === 'error'} contenida className="rv-rent__graf">
      {sinCob === 'ok' ? (
        <BarList etiqueta={tr('e26b.rent_grafica_cartera')} formato={mxn} matiz={2} items={[
          { clave: 'por_cobrar', etiqueta: tr('e26b.rent_barra_por_cobrar'), valor: cobranza!.porCobrar },
          { clave: 'vencido', etiqueta: tr('rentabilidad.vista.vencido'), valor: cobranza!.vencido },
        ]} />
      ) : null}
    </Tarjeta>
  );

  return (
    <EsqueletoPanelCifras
      titulo={tr('rentabilidad.vista.margenYCostos')} apoyo={tr('rentabilidad.vista.margenRealContraLo')} titular={titular} filtros={filtros} metodo={tr('r4.rent_metodo')}
      cifras={cifras} etiquetaCifras={tr('rentabilidad.vista.margenYCostos')}
      selloCifras={sinNada ? tr('rentabilidad.vista.sinDatosTodavia') : selloHoy(tr('rentabilidad.vista.selloViajesLiquidados'))}
      graficas={[graficaMargen, graficaCartera]}
      saberes={{ seSabe: { titulo: tr('e26b.rent_se_sabe'), items: seSabe }, noSeSabe: { titulo: tr('e26b.rent_no_se_sabe'), items: noSeSabe } }}
    >
      {cobranza !== null && cobranza.total > 0 ? (
        <Tarjeta titulo={tr('rentabilidad.vista.carteraPorCobrar')}>
          {cobranza.facturas.length === 0 ? (
            // `total > 0` pero esta página no trajo filas: es un `?p=` fuera de rango, NO una cartera vacía — las cifras de arriba (de la cartera completa) siguen siendo ciertas. El renglón de paginación de abajo ya trae "Anteriores"
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
                {cobranza.pagina > 1 && <EnlacePagina href={hrefPagina(sufijo, cobranza.pagina - 1, periodo)} direccion="anterior" />}
                {hayMas && <EnlacePagina href={hrefPagina(sufijo, cobranza.pagina + 1, periodo)} direccion="siguiente" />}
              </NavPaginas>
            )}
          </div>
        </Tarjeta>
      ) : null}
    </EsqueletoPanelCifras>
  );
}
