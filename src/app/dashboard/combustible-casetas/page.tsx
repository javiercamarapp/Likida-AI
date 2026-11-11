import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Fuel, Route as RouteIcon, Receipt, Copy, FileStack, CircleCheck } from 'lucide-react';
import {
  getGastoPorConcepto, getAcreditables, detectarAnomalias, getDocumentos, getConciliacionConsolidado,
  getLineasPorConciliar,
  type GastoPorConcepto, type Acreditables, type Anomalia, type DocumentoRow, type ConciliacionConsolidado,
  type LineaPorConciliar,
} from '@/lib/likida/analytics';
import { resolverLineaAMano, type ResolucionLineaManual } from '@/lib/likida/intake/consolidado';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn } from '@/lib/utils';
import { numero, hoyMx } from '@/lib/formato';
import { ventanaLitrosElegibles } from '@/lib/likida/fiscal';
import { ahoraMs } from '@/lib/saludo';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { sufijoTenant, querystringCompleto } from '../sufijo';
import { LineasPorConciliar, NINGUNO_VALOR } from './vista-consolidado';
import { calcularSinCfdi } from './sin-cfdi';
import type { Metadata } from 'next';
import { Disclosure, EstadoError, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { BarList, Cifra, DonaMini, TiraCifras } from '@/app/ui-v2/graficas';
import './combustible.css';
import { selloHoy } from '@/app/dashboard/sello-hoy';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.combustibleCasetas') };
}

export const dynamic = 'force-dynamic';

/** Los mensajes de `ResultadoResolverLinea.motivo` en lenguaje de contador —
 *  ninguno de los cinco es genérico: cada uno le dice a la persona que acaba
 *  de hacer clic exactamente por qué su clic no cerró la línea. */
const motivoError = (tr: Tr): Record<string, string> => ({
  linea_no_encontrada: tr('combustibleCasetas.page.esaLineaYaNo'),
  ya_resuelta: tr('combustibleCasetas.page.alguienMasYaLa'),
  candidato_no_ofrecido: tr('combustibleCasetas.page.eseCandidatoNoEs'),
  gasto_ya_no_disponible: tr('combustibleCasetas.page.elGastoElegidoYa'),
  sin_eleccion: tr('combustibleCasetas.page.eligeConQueGasto'),
  error_bd: tr('combustibleCasetas.page.noSePudoGuardar'),
});
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * A qué tenant escribe la Server Action. Vive a nivel de MÓDULO, no dentro del
 * componente: una función anidada capturada por el closure de un `'use
 * server'` cuenta como valor a serializar hacia el cliente, y una función
 * plana no lo es — "Functions cannot be passed directly to Client
 * Components". Por eso recibe `sufijo`/`tenantPedido` como parámetros en vez
 * de cerrarlos del render. Mismo patrón que `incidencias/page.tsx`:
 * `requireSessionTenant` da la sesión REAL (no la previsualizada por
 * `resolverTenantEfectivo`, que solo aplica a la LECTURA de esta página), y
 * se revalida `puedeVerRuta` aquí porque una Server Action es un endpoint
 * POST alcanzable por su cuenta — el gateo de la página (arriba) no la
 * protege.
 */
async function tenantYUsuarioDelAction(
  sufijo: string,
  sp: { vista?: string; tenant?: string },
  tenantId: string,
) {
  // MX-002: la línea se resuelve en la flota que la página PINTÓ (`tenantId` del render, por closure), no en la de la cookie
  // de selección (compartida entre pestañas). `resolverTenantEfectivo` ya valida `?tenant=` (inexistente = 404) y firma la
  // impersonación; `resolverTenantAtadoOLanza` exige además que caiga en la flota pintada.
  const s = await resolverTenantAtadoOLanza('/dashboard/combustible-casetas', sp, tenantId);
  if (!puedeVerRuta(s.rol, '/dashboard/combustible-casetas')) {
    redirect(`/dashboard/combustible-casetas${sufijo}`);
  }
  return { tenantId: s.tenantId, userId: s.userId };
}

/**
 * `getConciliacionConsolidado` YA usa `null` con un significado real ("este
 * tenant nunca mandó un consolidado"), así que envolverlo con `safe()` a
 * secas confundiría eso con "la consulta falló" — justo la trampa que
 * CLAUDE.md pide evitar (fallar cerrado y DECIRLO, no disfrazarlo de "no hay
 * nada"). `ok: false` es el único caso de error real.
 */
async function safeConciliacion(tenantId: string): Promise<{ ok: true; datos: ConciliacionConsolidado | null } | { ok: false }> {
  try { return { ok: true, datos: await getConciliacionConsolidado(tenantId) }; }
  catch { return { ok: false }; }
}

/**
 * Combustible & Casetas (PASO 11) — el gasto real de `gasto`, agrupado.
 *
 * El rendimiento km/l NO se calcula aquí aunque el PASO 11 lo pida: `viaje`
 * no guarda kilómetros recorridos, y el `tabulador` de la config del tenant
 * es una CALIBRACIÓN por placa (litros esperados), no una medición de campo.
 * Dividir gasto entre un kilometraje que nadie capturó daría un número con
 * apariencia de medición y sin nada detrás.
 *
 * La detección de "ordeña" que sí existe es la de comprobantes repetidos
 * entre viajes (`detectarAnomalias`, probada).
 *
 * ── AUDITORÍA 10 — EL CRUCE DEL CFDI CONSOLIDADO YA EXISTE (5-ago-2026) ────
 * Diésel por monedero y peaje por TAG (una fracción grande del gasto real,
 * por estimación interna SIN FUENTE CONFIRMADA — ver `intake/cfdi_xml.ts`)
 * llegan como UN CFDI que ampara muchos días de consumo, no un ticket por
 * transacción. `intake/consolidado.ts` recibe ese XML por el MISMO WhatsApp
 * por el que ya llega cualquier otro CFDI, separa sus líneas y las liga por
 * fecha+monto contra los tickets que el operador ya fotografió — o las deja
 * en una cola para que un contador las revise, cuando el match no es único.
 * `getConciliacionConsolidado` es ese resumen. Lo que SÍ EXISTE desde esta
 * ronda (5-ago-2026, el otro lado del mismo hallazgo): la sección de abajo
 * donde un contador/dueño resuelve a mano cada línea de la cola —elige el
 * candidato correcto o declara que ninguno aplica— vía `resolverLineaAMano`.
 * Lo que SIGUE sin existir: una conexión directa al portal del monedero/TAG
 * que traiga el CFDI sola —hoy depende de que alguien en la flota lo
 * reenvíe—, un aviso proactivo (WhatsApp o correo) cuando la cola crece —hoy
 * hay que abrir este panel para enterarse—, y, para las líneas que NO traen
 * ECC12 (TAG sin ese complemento), el estándar del CFDI no da fecha por
 * transacción, así que esas quedan en la cola casi siempre y sin candidato
 * (ver `cfdi_xml.ts`) — la única resolución posible para ellas es "ninguno
 * aplica" o esperar a que alguien identifique el viaje por otro medio.
 */
/** ESCALA 50k (22-ago-2026): la ventana de comprobantes sobre la que se
 *  calcula "Sin CFDI". Eran 1,000 — a 300k gastos/mes, 1,000 es el 0.3 % del
 *  mes y encima costaba 1,000 filas por carga. Con 100 la lectura es la misma
 *  que la de `getDocumentos` en el resto del producto, y el rótulo DICE que
 *  es una ventana ("de los últimos 100 comprobantes"), no un total. */
const VENTANA_DOCUMENTOS = 100;

export default async function CombustibleCasetasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string }>;
}) {
  const { t: tr } = await getT('dinero');
  const sp = await searchParams;
  // Querystring REAL (`?ok=`): si la sesión expira a media navegación, el
  // rebote a /login la conserva — ver el comentario largo en guard.ts.
  const { tenantId } = await resolverTenantEfectivo('/dashboard/combustible-casetas', sp, querystringCompleto(sp));
  const sufijo = sufijoTenant(sp);

  // FE-8: LA MISMA función que el contador (`inicio-contador.tsx`) y el chat
  // (`chat/page.tsx`) — antes cada pantalla medía "litros elegibles para el
  // estímulo, LIF 20-A" con su propio cálculo de ventana, la misma cita legal
  // con dos o tres cifras distintas. CLAUDE.md: una cifra fiscal que se lee
  // distinto en dos pantallas se lee como dos cálculos.
  const hoy = hoyMx(new Date(ahoraMs()));
  const vl = ventanaLitrosElegibles(hoy);

  const [porConcepto, acred, anomalias, docs, conciliacion, lineasPendientes] = await Promise.all([
    safe<GastoPorConcepto[]>(() => getGastoPorConcepto(tenantId)),
    safe<Acreditables>(() => getAcreditables(tenantId, vl.dias)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    safe<DocumentoRow[]>(() => getDocumentos(tenantId, VENTANA_DOCUMENTOS)),
    safeConciliacion(tenantId),
    safe<LineaPorConciliar[]>(() => getLineasPorConciliar(tenantId)),
  ]);

  async function accionResolverLinea(formData: FormData) {
    'use server';
    const { tenantId: t, userId } = await tenantYUsuarioDelAction(sufijo, sp, tenantId);
    const lineaId = String(formData.get('lineaId') ?? '');
    const eleccion = String(formData.get('eleccion') ?? '');
    const volver = (ok: string): never => redirect(`/dashboard/combustible-casetas${sufijo ? `${sufijo}&` : '?'}ok=${ok}`);
    if (!lineaId) redirect(`/dashboard/combustible-casetas${sufijo}`);
    // A37-S17-01: sin elección explícita (p. ej. un POST a mano con el valor vacío) NO se liga nada ni se adivina un candidato.
    if (!eleccion) volver('error_sin_eleccion');

    const resolucion: ResolucionLineaManual = eleccion === NINGUNO_VALOR
      ? { tipo: 'sin_match' }
      : { tipo: 'ligar', gastoId: eleccion };
    let r: Awaited<ReturnType<typeof resolverLineaAMano>>;
    try {
      r = await resolverLineaAMano(t, lineaId, resolucion, userId);
    } catch {
      return volver('error_error_bd');
    }

    revalidatePath('/dashboard/combustible-casetas');
    const ok = r.ok ? 'resuelta' : `error_${r.motivo ?? 'error_bd'}`;
    redirect(`/dashboard/combustible-casetas${sufijo ? `${sufijo}&` : '?'}ok=${ok}`);
  }

  const diesel = porConcepto?.find((c) => c.concepto === 'diesel');
  const caseta = porConcepto?.find((c) => c.concepto === 'caseta');
  // "Sin CFDI" solo se puede afirmar sobre los comprobantes que SÍ se
  // leyeron; si la consulta falló, no se afirma nada — y se distingue de
  // "la consulta funcionó y no hay comprobantes" (auditoría 25, MEDIO:
  // antes las dos se leían como la misma frase).
  const sinCfdiEstado = calcularSinCfdi(docs);
  const anomaliasCombustible = anomalias?.filter((a) => /diesel|caseta/i.test(a.detalle)) ?? [];

  const itemsConcepto = (porConcepto ?? []).map((c) => ({ clave: c.concepto, etiqueta: etiquetaConcepto(c.concepto), valor: c.total }));

  return (
    <MarcoPagina titulo={tr('combustibleCasetas.page.margenYCostos')} apoyo={tr('combustibleCasetas.page.losDosConceptosQue')} acciones={<>
        {sp.ok === 'resuelta' && <StatusChip tono="ok">{tr('combustibleCasetas.page.lineaResuelta')}</StatusChip>}
        {sp.ok?.startsWith('error_') && (
          <StatusChip tono="bad">
            {motivoError(tr)[sp.ok.slice('error_'.length)] ?? tr('combustibleCasetas.page.noSePudoResolver')}
          </StatusChip>
        )}
      </>}>
      {porConcepto === null ? (
        <EstadoError reintentar>{tr('combustibleCasetas.page.noSePudoCargar')}</EstadoError>
      ) : (
        <TiraCifras sello={selloHoy(tr('combustibleCasetas.page.gastosDeLaFlota'))}>
          <Cifra icono={<Icono icono={Fuel} />}
            // FE-9: `getGastoPorConcepto` no tiene ventana (histórico completo) — junto al tile vecino, que sí declara la suya ("últimos 100 comprobantes"), esto se leía como "del mes". A 15k viajes/mes este acumulado crece sin fin, y ES la pantalla que el contador abre para el cierre.
            etiqueta={tr('combustibleCasetas.page.gastadoEnCombustible')} info="combustible_casetas.gastado_combustible" valor={diesel?.total ?? 0} formato="mxn"
            nota={diesel ? tr('combustibleCasetas.page.historicoCargasRegistradas', { v: numero(diesel.n) }) : tr('combustibleCasetas.page.sinCargasRegistradasTodavia')} />
          <Cifra icono={<Icono icono={RouteIcon} />}
            etiqueta={tr('combustibleCasetas.page.gastadoEnCasetas')} info="combustible_casetas.gastado_casetas" valor={caseta?.total ?? 0} formato="mxn"
            nota={caseta ? tr('combustibleCasetas.page.historicoCasetasRegistradas', { v: numero(caseta.n) }) : tr('combustibleCasetas.page.sinCasetasRegistradasTodavia')} />
          <Cifra icono={<Icono icono={Fuel} />}
            // A23-ALTO: era `acred?.litrosDiesel ?? 0` — una lectura caída se pintaba como "0 litros elegibles", una cifra fiscal FALSA (no es que no haya nada acreditable: es que no se pudo leer). FE-8: el rótulo dice la ventana del ejercicio en curso, la misma que usa el contador.
            etiqueta={vl.rotulo} info="combustible_casetas.litros_elegibles" valor={acred ? acred.litrosDiesel : null} formato="litros"
            mensaje={acred === null ? tr('combustibleCasetas.page.noSePudoLeer') : undefined}
            nota={vl.nota} />
          <Cifra icono={<Icono icono={Receipt} />}
            // AUDITORÍA 1, ALTO: sin comprobantes, el valor es null — se PRESERVA para que el encabezado diga "—" y no un "0%" que se lee como "todo facturado". AUDITORÍA 25, MEDIO: "sin comprobantes" (`sin_datos`) y "la consulta falló" (`error`) no comparten mensaje.
            etiqueta={tr('combustibleCasetas.page.sinCfdiCombustibleY')} info="combustible_casetas.sin_cfdi" valor={sinCfdiEstado.pct} formato="porcentaje"
            mensaje={
              sinCfdiEstado.estado === 'error' ? tr('combustibleCasetas.page.noSePudoLeer2')
              : sinCfdiEstado.estado === 'sin_datos' ? tr('combustibleCasetas.page.sinComprobantesDeEstos')
              : undefined
            }
            nota={sinCfdiEstado.estado === 'ok' ? tr('combustibleCasetas.page.deSinFacturaEntre', { sinCfdi: sinCfdiEstado.sinCfdi, total: sinCfdiEstado.total, v: numero(VENTANA_DOCUMENTOS) }) : undefined} />
        </TiraCifras>
      )}

      {porConcepto && porConcepto.length > 1 ? (
        <FilaTarjetas variante="6-6">
          <Tarjeta titulo={tr('combustibleCasetas.page.gastoPorConcepto')}>
            <BarList etiqueta={tr('combustibleCasetas.page.gastoPorConcepto')} items={itemsConcepto} formato={mxn} />
          </Tarjeta>
          <Tarjeta titulo={tr('combustibleCasetas.page.repartoDelGasto')}>
            <DonaMini etiqueta={tr('combustibleCasetas.page.repartoDelGastoPor')} gajos={itemsConcepto.map((i) => ({ etiqueta: i.etiqueta, valor: i.valor }))} formato="mxn" />
          </Tarjeta>
        </FilaTarjetas>
      ) : (
        <Tarjeta titulo={tr('combustibleCasetas.page.gastoPorConcepto')} estado="vacio" mensaje={tr('combustibleCasetas.page.faltaMasDeUn')} detalle={tr('combustibleCasetas.page.haceFaltaMasDe')} iconoVacio={Fuel} contenida />
      )}

      <Tarjeta titulo={tr('combustibleCasetas.page.posibleCargaRepetida')} info="combustible_casetas.carga_repetida"
        estado={anomalias === null ? 'error' : anomaliasCombustible.length === 0 ? 'vacio' : 'ok'}
        mensaje={anomalias === null ? tr('combustibleCasetas.page.noSePudoRevisar') : tr('combustibleCasetas.page.sinCargasRepetidas')}
        detalle={tr('combustibleCasetas.page.ningunComprobanteDeCombustib')} iconoVacio={Copy} contenida>
        <ul className="rv-comb__lista">
          {anomaliasCombustible.map((a, i) => (
            <li key={i} className="rv-comb__anomalia">
              <div>
                <div>{a.detalle}</div>
                <div className="rv-comb__tenue">{tr('combustibleCasetas.page.viajesDosPuntos')} {a.viajes.join(' · ')}</div>
              </div>
              <strong className="rv-comb__monto">{mxn(a.monto)}</strong>
            </li>
          ))}
        </ul>
        <p className="rv-comb__nota">
          {tr('combustibleCasetas.page.coincidenciaDetectadaNoUn')}
        </p>
      </Tarjeta>

      {!conciliacion.ok ? (
        <Tarjeta titulo={tr('combustibleCasetas.page.cfdiConsolidadoMonederoY')} info="combustible_casetas.cfdi_consolidado" estado="error" mensaje={tr('combustibleCasetas.page.noSePudoCargar2')} />
      ) : conciliacion.datos === null ? (
        <Tarjeta titulo={tr('combustibleCasetas.page.cfdiConsolidadoMonederoY')} info="combustible_casetas.cfdi_consolidado" estado="vacio" mensaje={tr('combustibleCasetas.page.sinCfdiConsolidadoTodavia')} iconoVacio={FileStack} contenida
          detalle={tr('combustibleCasetas.page.todaviaNoLlegaNingun')} />
      ) : (
        <>
          <TiraCifras sello={selloHoy(tr('combustibleCasetas.page.gastosDeLaFlota'))}>
            <Cifra icono={<Icono icono={FileStack} />}
              etiqueta={tr('combustibleCasetas.page.lineasLigadasAutomaticamente')} info="combustible_casetas.lineas_ligadas" valor={conciliacion.datos.conciliadas} formato="numero"
              nota={tr(conciliacion.datos.cfdis === 1 ? 'combustibleCasetas.page.cfdiRecibidoUno' : 'combustibleCasetas.page.cfdiRecibidosVarios', { n: conciliacion.datos.cfdis })} />
            <Cifra icono={<Icono icono={Receipt} />}
              etiqueta={tr('combustibleCasetas.page.porRevisarAMano')} info="combustible_casetas.por_revisar" valor={conciliacion.datos.porConciliar} formato="numero"
              nota={conciliacion.datos.porConciliar === 0 ? tr('combustibleCasetas.page.todoLoQueLlego') : tr('combustibleCasetas.page.eligeElCandidatoCorrecto')} />
            <Cifra icono={<Icono icono={CircleCheck} />}
              etiqueta={tr('combustibleCasetas.page.revisadasSinGastoQue')} info="combustible_casetas.sin_gasto" valor={conciliacion.datos.sinMatch} formato="numero"
              nota={tr('combustibleCasetas.page.unHumanoYaLas')} />
          </TiraCifras>

          {conciliacion.datos.porConciliar > 0 && (
            lineasPendientes === null ? (
              <EstadoError reintentar>
                {tr('combustibleCasetas.page.noSePudoCargar3')}
              </EstadoError>
            ) : (
              <Tarjeta titulo={tr('combustibleCasetas.page.lineasPorResolverA')} info="combustible_casetas.por_revisar">
                <p className="rv-comb__nota">
                  {tr('combustibleCasetas.page.unaLineaQuedaAqui')}
                </p>
                <LineasPorConciliar tr={tr} lineas={lineasPendientes} accion={accionResolverLinea} />
              </Tarjeta>
            )
          )}
        </>
      )}

      <Disclosure titulo={tr('combustibleCasetas.page.queNoMideEsta')} variante="tarjeta">
        <p className="rv-comb__nota">
          {tr('combustibleCasetas.page.elRendimientoEnKm')}
        </p>
        <p className="rv-comb__nota">
          {tr('combustibleCasetas.page.elCruceDelEstado')}
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}
