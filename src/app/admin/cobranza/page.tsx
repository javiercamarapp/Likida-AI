import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import { hoyMx, mxn } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { getPorCobrarTodas } from '@/lib/saas/transferencia';
import { getPiezasDunningPlataforma, getUltimaCorridaDunningPlataforma, type CorridaDunning, type PiezaDunning } from '@/lib/likida/repo';
import { armarEstadoDunning, type SelloToque } from '@/lib/likida/cobranza_estado';
import { toquesDeHoy, tituloToque } from '@/lib/likida/agentes/exito';
import type { FacturaPorCobrar } from '@/lib/saas/transferencia';
import { Aviso, AvisoCompacto, Disclosure, MarcoPagina, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import '../dinero.css';

export const dynamic = 'force-dynamic';

/**
 * Facturación › Cobranza. Likida cobrando a SUS clientes (no confundir con `gasto`: los comprobantes de gasto de un viaje son recibos
 * del conductor, un concepto totalmente distinto).
 *
 * El agente `cobranza_saas` (`agentes/exito.ts`) corre la cadencia de cinco toques −3/0/+3/+7/+15 contra `factura_saas`. Esta pantalla
 * muestra el estado REAL: qué facturas están por cobrar, qué toque le toca a cada una, y si su propuesta está pendiente, aprobada,
 * rechazada o enviada.
 *
 * LO QUE EL DUNNING NO HACE, y la página lo dice: produce PROPUESTAS a la bandeja de aprobación, no envíos — no hay canal de correo al
 * cliente aprobado, así que nada sale solo (MX-003: cablear el envío es mandar correo a clientes, un efecto externo que se decide aparte;
 * mientras tanto el texto no promete un «editar y mandar» que no existe). Y `null` es «no se pudo leer», `[]` es «no hay nada»: cada
 * lectura falla por separado y se avisa, para no decir «nada por cobrar» con la base caída.
 */
const ROTULO_SELLO: Record<SelloToque, { texto: string; tono: TonoEstado }> = {
  sin_propuesta: { texto: 'sin propuesta', tono: 'bad' },
  superado: { texto: 'sin propuesta (el agente solo propone el toque más alto)', tono: 'neutral' },
  pendiente: { texto: 'propuesta pendiente', tono: 'warn' },
  aprobada: { texto: 'aprobada, sin enviar', tono: 'warn' },
  rechazada: { texto: 'rechazada', tono: 'neutral' },
  enviada: { texto: 'enviada', tono: 'ok' },
};

/** Filas de la lista; las cifras de arriba cubren todas las facturas, no solo estas. */
const FILAS_MOSTRADAS = 50;

const hito = (h: number) => `D${h >= 0 ? '+' : ''}${h}`;

async function leer<T>(nombre: string, f: () => Promise<T>): Promise<{ dato: T | null; error: boolean }> {
  try { return { dato: await f(), error: false }; }
  catch (e) { logger.error(`admin.cobranza.${nombre}`, { err: e instanceof Error ? e.message : String(e) }); return { dato: null, error: true }; }
}


export default async function CobranzaPage() {
  // La puerta de la PÁGINA, no solo la del layout: en Next un layout no se vuelve a ejecutar si la petición RSC declara que el cliente
  // ya lo tiene, así que lo único que protege estos datos de TODAS las flotas (service role) es esta llamada.
  await requireSuperadmin();
  const hoy = hoyMx();
  // Los totales se calculan sobre TODAS las pendientes/fallidas (conteo exacto de la base), no sobre las filas que se pintan; la lista
  // se acota a FILAS_MOSTRADAS y lo dice.
  const [facturas, corrida] = await Promise.all([
    leer<{ facturas: FacturaPorCobrar[]; total: number }>('por_cobrar', getPorCobrarTodas),
    leer<CorridaDunning | null>('corrida', getUltimaCorridaDunningPlataforma),
  ]);
  // Las piezas se piden por los títulos de los toques de esas facturas: nunca «las N más nuevas», que dejaba a las facturas viejas con
  // un falso «sin propuesta».
  const piezas = facturas.dato
    ? await leer<PiezaDunning[]>('piezas', () => getPiezasDunningPlataforma(toquesDeHoy(facturas.dato!.facturas, hoy).map(tituloToque)))
    : { dato: null as PiezaDunning[] | null, error: false };
  const estado = facturas.dato ? armarEstadoDunning(facturas.dato.facturas, piezas.dato ?? [], hoy) : null;
  const filasVistas = estado ? estado.facturas.slice(0, FILAS_MOSTRADAS) : [];
  const totalBase = facturas.dato?.total ?? 0;
  const truncada = !!facturas.dato && totalBase > facturas.dato.facturas.length;
  // Sin facturas leídas, sin total en la base y sin propuestas: ninguna de las 4 cifras tiene base real que medir.
  const sinBase = !!estado && totalBase === 0 && estado.facturas.length === 0 && estado.propuestasPendientes === 0 && estado.propuestasEnviadas === 0;
  const hayError = facturas.error || piezas.error || corrida.error;

  return (
    <MarcoPagina titulo="Facturación" apoyo="Seguimiento de lo que las flotas deben: recordatorios preparados, toques sin propuesta y la última corrida del agente.">
      {hayError ? (
        <Aviso tono="error" titulo="No se pudo leer todo el estado del dunning">
          {facturas.error && 'Las facturas por cobrar no cargaron (no se afirma que no haya ninguna). '}
          {piezas.error && 'Las propuestas de recordatorio no cargaron (los toques no pueden mostrarse como «con propuesta» ni «sin propuesta»). '}
          {corrida.error && 'La última corrida del agente no cargó. '}
          Recarga la página; si persiste, revisa los registros.
        </Aviso>
      ) : null}

      <AvisoCompacto
        tono="info"
        resumen="El dunning de las mensualidades de Likida ya corre: prepara recordatorios en cinco toques, como propuestas a la bandeja de aprobación, no envíos."
        mas={(
          <>
            El agente de cobranza recorre las facturas pendientes o fallidas y, para cada una, prepara un recordatorio —3 días antes del corte, el día, y +3, +7 y +15—.
            Son <strong>propuestas a la bandeja de aprobación, no envíos</strong>: no hay canal de correo al cliente aprobado y nada sale solo. En{' '}
            <Link href="/admin/aprobaciones">Aprobaciones</Link> el dueño solo aprueba o rechaza la propuesta; el envío al cliente lo hace por su cuenta y el sistema no lo registra,
            así que «enviadas» seguirá en 0 hasta que exista ese canal. Emitir la mensualidad, conciliar el pago contra el banco y timbrar el CFDI se hace en{' '}
            <Link href="/admin/costos-facturacion">Planes y cobro</Link>. El vencimiento se toma como el inicio del periodo (la mensualidad se cobra por adelantado).
          </>
        )}
      />

      {estado ? (
        /* Sin una sola factura ni propuesta no hay base que medir: cuatro «0 · $0.00» se leerían como medición. Se marcan «—» y lo dicen. */
        <TiraCifras etiqueta="Cobranza de las mensualidades" items={sinBase
          ? ['Por cobrar', 'Vencidas', 'Toques sin propuesta', 'Propuestas pendientes / enviadas por el sistema'].map((e) => ({ etiqueta: e, valor: null, estado: 'vacio' as const, mensaje: 'Sin facturas que medir todavía' }))
          : [
            { etiqueta: 'Por cobrar', valor: `${totalBase} · ${mxn(estado.montoPorCobrar)}`, nota: truncada ? 'Incompleto: hay más facturas de las que se leyeron.' : undefined, tono: truncada ? 'warn' as const : undefined },
            { etiqueta: 'Vencidas', valor: `${estado.vencidas} · ${mxn(estado.montoVencido)}`, tono: estado.vencidas > 0 ? 'bad' as const : undefined },
            {
              etiqueta: 'Toques sin propuesta', valor: String(estado.toquesSinPropuesta),
              nota: estado.toquesSinPropuesta > 0 ? 'El agente no ha preparado toques que ya tocaban.' : undefined,
              tono: estado.toquesSinPropuesta > 0 && !piezas.error ? 'warn' as const : undefined,
            },
            { etiqueta: 'Propuestas pendientes / enviadas por el sistema', valor: `${estado.propuestasPendientes} / ${estado.propuestasEnviadas}` },
          ]} />
      ) : null}

      <Tarjeta titulo="Última corrida del agente" estado={corrida.error ? 'error' : 'ok'} mensaje="No se pudo leer la última corrida" reintentar>
        {corrida.dato === null ? (
          <p className="adm-din-nota">
            <StatusChip tono="warn">Nunca ha corrido</StatusChip> No hay una sola corrida registrada de cobranza: ningún toque se ha preparado todavía.
          </p>
        ) : (
          <>
            <p className="adm-din-nota">
              <StatusChip tono={corrida.dato.estado === 'ok' ? 'ok' : 'bad'}>{corrida.dato.estado === 'ok' ? 'Última corrida OK' : 'Última corrida con fallo'}</StatusChip>{' '}
              {corrida.dato.fin.slice(0, 16).replace('T', ' ')} UTC
            </p>
            {corrida.dato.error ? <Aviso tono="error">{corrida.dato.error}</Aviso> : null}
          </>
        )}
      </Tarjeta>

      {estado ? (
        <Tarjeta
          titulo="Facturas por cobrar y su cadencia" estado={estado.facturas.length === 0 ? 'vacio' : 'ok'}
          mensaje="0 mensualidades por cobrar" detalle="No hay ninguna factura pendiente ni fallida. Es el estado real del negocio, no un error de lectura."
        >
          {estado.facturas.length > filasVistas.length || truncada ? (
            <p className="adm-din-nota" role="note">
              Mostrando {filasVistas.length} de {totalBase}; las cifras de arriba cubren {truncada ? `las ${estado.facturas.length} leídas (hay más en la base: sus totales están incompletos)` : 'todas'}.
            </p>
          ) : null}
          <TablaBase
            etiqueta="Facturas por cobrar y su cadencia" idFila={(f) => f.factura.id} tarjetaMovil densa filas={filasVistas}
            columnas={[
              { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.factura.tenantNombre },
              { id: 'monto', titulo: 'Total', alinear: 'der', celda: (f) => mxn(f.factura.monto) },
              {
                id: 'corte', titulo: 'Corte',
                celda: (f) => (
                  <>
                    <StatusChip tono={f.vencida ? 'bad' : 'neutral'}>{f.dias >= 0 ? `${f.dias} días desde el corte` : `faltan ${-f.dias} días`}</StatusChip>
                    <span className="adm-din-sub">{f.factura.estado} · {f.factura.periodoInicio} a {f.factura.periodoFin}</span>
                  </>
                ),
              },
              {
                id: 'toques', titulo: 'Toques',
                celda: (f) => (f.toques.length === 0 ? (
                  <>Aún no alcanza el primer toque ({hito(f.proximoHito ?? -3)}).</>
                ) : (
                  <span className="adm-din-acciones">
                    {f.toques.map((t) => (
                      <StatusChip key={t.hito} tono={piezas.error ? 'neutral' : ROTULO_SELLO[t.sello].tono}>
                        {hito(t.hito)} · {piezas.error ? 'estado de la propuesta no disponible' : ROTULO_SELLO[t.sello].texto}
                      </StatusChip>
                    ))}
                    {f.proximoHito !== null ? <span className="adm-din-sub">siguiente: {hito(f.proximoHito)}</span> : null}
                  </span>
                )),
              },
            ]}
          />
        </Tarjeta>
      ) : null}

      <Disclosure titulo="Qué no se mide todavía" resumen="Días de cobro y recuperación">
        <p className="adm-din-nota">
          Pendiente de construir: los días promedio de cobro y la tasa de recuperación de vencidos necesitan historial de facturas pagadas que aún no existe. El monto facturado y el
          cobrado por estado están en la pestaña Facturas.
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Cobranza' };
