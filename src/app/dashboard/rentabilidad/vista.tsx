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
  rentabilidad, cobranza, sufijo = '',
}: {
  rentabilidad: Rentabilidad | null;
  cobranza: Cobranza | null;
  /** El `?tenant=`/`?vista=`/`?rol=` que hay que conservar al pasar de página. */
  sufijo?: string;
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
      id: 'folio', titulo: 'Folio', principal: true,
      celda: (f) => (
        <>
          {f.folio ?? '—'}
          <span className="rv-rent__tenue">{fechaCorta(f.fecha)}</span>
        </>
      ),
    },
    { id: 'cliente', titulo: 'Cliente', celda: (f) => f.cliente },
    { id: 'total', titulo: 'Total', alinear: 'der', celda: (f) => mxn(f.total) },
    { id: 'pagado', titulo: 'Pagado', alinear: 'der', celda: (f) => mxn(f.pagado) },
    { id: 'saldo', titulo: 'Saldo', alinear: 'der', celda: (f) => <strong>{mxn(f.saldo)}</strong> },
    {
      id: 'vence', titulo: 'Vence',
      celda: (f) => (f.vencida
        ? <StatusChip tono="bad">{`venció ${fechaCorta(f.venceEn)}`}</StatusChip>
        : (f.venceEn ? fechaCorta(f.venceEn) : <span className="rv-rent__tenue">sin condiciones</span>)),
    },
  ];

  return (
    <MarcoPagina titulo="Margen y costos" apoyo="Margen real contra lo comprobado, cartera por cobrar y lo vencido por cliente. Si el dato no existe, se dice.">
      {sinNada ? (
        <>
          {/* Cinco cifras SIN DATO: la estructura de la pantalla, no ceros que parezcan medición. */}
          <TiraCifras sello="Sin datos todavía">
            <Cifra icono={<Icono icono={Banknote} />} etiqueta="Ingreso de fletes liquidados" valor={null} estado="vacio" info="rentabilidad.ingreso" />
            <Cifra icono={<Icono icono={ReceiptText} />} etiqueta="Costo comprobado" valor={null} estado="vacio" info="rentabilidad.costo" />
            <Cifra icono={<Icono icono={TrendingUp} />} etiqueta="Contribución" valor={null} estado="vacio" info="rentabilidad.contribucion" />
            <Cifra icono={<Icono icono={Wallet} />} etiqueta="Por cobrar" valor={null} estado="vacio" info="rentabilidad.por_cobrar" />
            <Cifra icono={<Icono icono={CalendarClock} />} etiqueta="Vencido" valor={null} estado="vacio" info="rentabilidad.vencido" />
          </TiraCifras>
          <EstadoVacio titulo="Faltan ingreso y facturas" contenido
            accion={<BotonEnlace href={`/dashboard/facturacion${sufijo}`} variante="secondary" tamano="sm">Registrar una factura</BotonEnlace>}>
            Con el ingreso de cada flete y las facturas, aquí se mide el margen contra lo comprobado, la cartera por cobrar y lo vencido por cliente. Nada de esta pantalla se estima.
          </EstadoVacio>
        </>
      ) : (
        <>
          {/* ── Rentabilidad ─────────────────────────────────────── */}
          {rentabilidad === null ? (
            <EstadoError>No pude leer los viajes y liquidaciones para medir la rentabilidad.</EstadoError>
          ) : rentabilidad.viajesConIngreso === 0 ? (
            <EstadoVacio titulo="Sin ingreso de flete" contenido>
              Ningún viaje trae ingreso de flete capturado todavía: sin ese dato el margen
              no se calcula (y no se estima con el anticipo: eso es lo que la empresa le
              adelanta al operador, no lo que cobra).
            </EstadoVacio>
          ) : (
            <>
              <TiraCifras sello={selloHoy('Viajes liquidados')}>
                <Cifra
                  icono={<Icono icono={Banknote} />}
                  etiqueta="Ingreso de fletes liquidados" valor={rentabilidad.ingreso} formato="mxn"
                  info="rentabilidad.ingreso" />
                <Cifra
                  icono={<Icono icono={ReceiptText} />}
                  etiqueta="Costo comprobado (esos mismos viajes)" valor={rentabilidad.costoComprobado} formato="mxn"
                  info="rentabilidad.costo" />
                <Cifra
                  icono={<Icono icono={TrendingUp} />}
                  etiqueta="Contribución (ingreso − comprobado)" valor={rentabilidad.contribucion} formato="mxn"
                  info="rentabilidad.contribucion" />
              </TiraCifras>
              <p className="rv-rent__nota">
                {rentabilidad.margenPct !== null
                  ? `Margen: ${porcentaje(rentabilidad.margenPct)} — medido solo sobre los ${numero(rentabilidad.viajesConIngreso)} viajes liquidados con ingreso capturado.`
                  : 'Sin ingreso capturado, el margen no se calcula.'}
                {rentabilidad.viajesSinIngreso > 0
                  && ` ${numero(rentabilidad.viajesSinIngreso)} viajes sin ingreso quedan fuera de esta medición.`}
                {rentabilidad.viajesSinLiquidar !== null && rentabilidad.viajesSinLiquidar > 0
                  && ` ${numero(rentabilidad.viajesSinLiquidar)} viajes sin liquidación vigente (abiertos, en cuadre o rechazada) tampoco entran: su costo todavía no existe y sumar solo su ingreso inflaría el margen.`}
              </p>
              {/* Qué NO trae esa cifra. Va aquí y no en un tooltip porque es la diferencia entre "este viaje dejó dinero" y "este viaje dejó dinero ANTES de pagar al operador y el taller", y de esa distinción dependen decisiones de tarifa. */}
              <p className="rv-rent__pie">
                Contribución NO es utilidad: es el ingreso menos lo que se comprobó en el viaje.
                Todavía no resta sueldo del operador, mantenimiento, llantas, seguro, depreciación
                ni administración. Un viaje puede salir con contribución sana y aun así haber
                perdido dinero — para eso hace falta tu costo por kilómetro, que Likida no conoce.
              </p>
            </>
          )}

          {/* ── Cobranza a clientes ──────────────────────────────── */}
          {cobranza === null ? (
            <EstadoError>No pude leer las facturas emitidas para armar la cartera.</EstadoError>
          ) : cobranza.total === 0 ? (
            <EstadoVacio titulo="Sin facturas emitidas" contenido>
              Aún no hay facturas emitidas registradas: al registrar la primera, aquí
              aparece la cartera, es decir, cuánto te deben, qué ya venció y qué factura no tiene
              condiciones de crédito pactadas.
            </EstadoVacio>
          ) : (
            <>
              <TiraCifras sello={selloHoy('Viajes liquidados')}>
                <Cifra
                  icono={<Icono icono={Wallet} />}
                  etiqueta="Por cobrar (facturas vivas)" valor={cobranza.porCobrar} formato="mxn"
                  info="rentabilidad.por_cobrar" />
                <Cifra
                  icono={<Icono icono={CalendarClock} />}
                  etiqueta="Vencido" valor={cobranza.vencido} formato="mxn"
                  info="rentabilidad.vencido" />
              </TiraCifras>
              {cobranza.sinCondiciones > 0 && (
                <p className="rv-rent__nota" data-tono="warn">
                  {cobranza.sinCondiciones === 1
                    ? '1 factura no tiene fecha de vencimiento porque su cliente no tiene crédito pactado — no entra al conteo de vencidas.'
                    : `${cobranza.sinCondiciones} facturas no tienen fecha de vencimiento porque su cliente no tiene crédito pactado — no entran al conteo de vencidas.`}
                </p>
              )}
              <Tarjeta titulo="Cartera por cobrar">
                {cobranza.facturas.length === 0 ? (
                  // `total > 0` pero esta página no trajo filas: es un `?p=` fuera de rango, NO una cartera vacía — las cifras de arriba (de la cartera completa) siguen siendo ciertas. El renglón de paginación de abajo ya trae "Anteriores".
                  <p className="rv-rent__nota">
                    Esta página no tiene facturas — hay {numero(cobranza.total)} en la cartera completa.
                  </p>
                ) : (
                  <TablaBase<FilaCartera> etiqueta="Rentabilidad por folio y cliente" columnas={columnas} filas={cobranza.facturas}
                    idFila={(f) => f.id} altoMaximo={false} tarjetaMovil />
                )}

                {/* ── La cartera viene PAGINADA (mig. 0152) ── Se dice el rango Y el total: recortar la lista está bien, recortar la cifra sin decirlo no. Las cifras de arriba (por cobrar, vencido) son de TODAS las facturas, no de esta página — por eso el renglón lo aclara. */}
                <div className="rv-rent__pie-lista">
                  <span className="rv-rent__pie">
                    {`Facturas ${numero(desde)}–${numero(hasta)} de ${numero(cobranza.total)}, `}
                    {'las vencidas primero. Por cobrar y vencido de arriba son de la cartera completa.'}
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
