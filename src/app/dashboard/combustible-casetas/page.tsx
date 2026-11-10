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
export const metadata: Metadata = { title: 'Combustible y casetas' };

export const dynamic = 'force-dynamic';

/** Los mensajes de `ResultadoResolverLinea.motivo` en lenguaje de contador —
 *  ninguno de los cinco es genérico: cada uno le dice a la persona que acaba
 *  de hacer clic exactamente por qué su clic no cerró la línea. */
const MOTIVO_ERROR: Record<string, string> = {
  linea_no_encontrada: 'Esa línea ya no existe.',
  ya_resuelta: 'Alguien más ya la resolvió — revisa el estado actual.',
  candidato_no_ofrecido: 'Ese candidato no es uno de los que el sistema ofreció.',
  gasto_ya_no_disponible: 'El gasto elegido ya quedó ligado a otra línea mientras revisabas.',
  sin_eleccion: 'Elige con qué gasto ligar la línea (o «Ninguno de estos»): con varios candidatos no se adivina cuál.',
  error_bd: 'No se pudo guardar — intenta de nuevo.',
};

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
    <MarcoPagina titulo="Margen y costos" apoyo="Los dos conceptos que más pesan en un viaje, y qué tanto están facturados." acciones={<>
        {sp.ok === 'resuelta' && <StatusChip tono="ok">Línea resuelta</StatusChip>}
        {sp.ok?.startsWith('error_') && (
          <StatusChip tono="bad">
            {MOTIVO_ERROR[sp.ok.slice('error_'.length)] ?? 'No se pudo resolver la línea.'}
          </StatusChip>
        )}
      </>}>
      {porConcepto === null ? (
        <EstadoError reintentar>No se pudo cargar el gasto de la flota.</EstadoError>
      ) : (
        <TiraCifras sello={selloHoy('Gastos de la flota')}>
          <Cifra icono={<Icono icono={Fuel} />}
            // FE-9: `getGastoPorConcepto` no tiene ventana (histórico completo) — junto al tile vecino, que sí declara la suya ("últimos 100 comprobantes"), esto se leía como "del mes". A 15k viajes/mes este acumulado crece sin fin, y ES la pantalla que el contador abre para el cierre.
            etiqueta="Gastado en combustible" info="combustible_casetas.gastado_combustible" valor={diesel?.total ?? 0} formato="mxn"
            nota={diesel ? `histórico · ${numero(diesel.n)} cargas registradas` : 'Sin cargas registradas todavía'} />
          <Cifra icono={<Icono icono={RouteIcon} />}
            etiqueta="Gastado en casetas" info="combustible_casetas.gastado_casetas" valor={caseta?.total ?? 0} formato="mxn"
            nota={caseta ? `histórico · ${numero(caseta.n)} casetas registradas` : 'Sin casetas registradas todavía'} />
          <Cifra icono={<Icono icono={Fuel} />}
            // A23-ALTO: era `acred?.litrosDiesel ?? 0` — una lectura caída se pintaba como "0 litros elegibles", una cifra fiscal FALSA (no es que no haya nada acreditable: es que no se pudo leer). FE-8: el rótulo dice la ventana del ejercicio en curso, la misma que usa el contador.
            etiqueta={vl.rotulo} info="combustible_casetas.litros_elegibles" valor={acred ? acred.litrosDiesel : null} formato="litros"
            mensaje={acred === null ? 'No se pudo leer lo acreditable' : undefined}
            nota={vl.nota} />
          <Cifra icono={<Icono icono={Receipt} />}
            // AUDITORÍA 1, ALTO: sin comprobantes, el valor es null — se PRESERVA para que el encabezado diga "—" y no un "0%" que se lee como "todo facturado". AUDITORÍA 25, MEDIO: "sin comprobantes" (`sin_datos`) y "la consulta falló" (`error`) no comparten mensaje.
            etiqueta="Sin CFDI (combustible y casetas)" info="combustible_casetas.sin_cfdi" valor={sinCfdiEstado.pct} formato="porcentaje"
            mensaje={
              sinCfdiEstado.estado === 'error' ? 'No se pudo leer si hay CFDI de estos conceptos'
              : sinCfdiEstado.estado === 'sin_datos' ? 'Sin comprobantes de estos conceptos todavía'
              : undefined
            }
            nota={sinCfdiEstado.estado === 'ok' ? `${sinCfdiEstado.sinCfdi} de ${sinCfdiEstado.total} sin factura entre los últimos ${numero(VENTANA_DOCUMENTOS)} comprobantes registrados — es deducible que se pierde` : undefined} />
        </TiraCifras>
      )}

      {porConcepto && porConcepto.length > 1 ? (
        <FilaTarjetas variante="6-6">
          <Tarjeta titulo="Gasto por concepto">
            <BarList etiqueta="Gasto por concepto" items={itemsConcepto} formato={mxn} />
          </Tarjeta>
          <Tarjeta titulo="Reparto del gasto">
            <DonaMini etiqueta="Reparto del gasto por concepto" gajos={itemsConcepto.map((i) => ({ etiqueta: i.etiqueta, valor: i.valor }))} formato="mxn" />
          </Tarjeta>
        </FilaTarjetas>
      ) : (
        <Tarjeta titulo="Gasto por concepto" estado="vacio" mensaje="Falta más de un concepto" detalle="Hace falta más de un concepto de gasto registrado para comparar." iconoVacio={Fuel} contenida />
      )}

      <Tarjeta titulo="Posible carga repetida" info="combustible_casetas.carga_repetida"
        estado={anomalias === null ? 'error' : anomaliasCombustible.length === 0 ? 'vacio' : 'ok'}
        mensaje={anomalias === null ? 'No se pudo revisar' : 'Sin cargas repetidas'}
        detalle="Ningún comprobante de combustible o caseta aparece cargado en más de un viaje." iconoVacio={Copy} contenida>
        <ul className="rv-comb__lista">
          {anomaliasCombustible.map((a, i) => (
            <li key={i} className="rv-comb__anomalia">
              <div>
                <div>{a.detalle}</div>
                <div className="rv-comb__tenue">Viajes: {a.viajes.join(' · ')}</div>
              </div>
              <strong className="rv-comb__monto">{mxn(a.monto)}</strong>
            </li>
          ))}
        </ul>
        <p className="rv-comb__nota">
          Coincidencia detectada, no un veredicto: verifica antes de conversarlo con el operador.
        </p>
      </Tarjeta>

      {!conciliacion.ok ? (
        <Tarjeta titulo="CFDI consolidado (monedero y TAG)" info="combustible_casetas.cfdi_consolidado" estado="error" mensaje="No se pudo cargar esta sección" />
      ) : conciliacion.datos === null ? (
        <Tarjeta titulo="CFDI consolidado (monedero y TAG)" info="combustible_casetas.cfdi_consolidado" estado="vacio" mensaje="Sin CFDI consolidado todavía" iconoVacio={FileStack} contenida
          detalle="Todavía no llega ningún CFDI consolidado de esta flota (el que factura el diésel de un monedero o el peaje de un TAG por periodo completo, no ticket por ticket). En cuanto alguien lo reenvíe por WhatsApp, aquí se ve cuánto quedó ligado solo contra cuánto necesita revisión." />
      ) : (
        <>
          <TiraCifras sello={selloHoy('Gastos de la flota')}>
            <Cifra icono={<Icono icono={FileStack} />}
              etiqueta="Líneas ligadas automáticamente" info="combustible_casetas.lineas_ligadas" valor={conciliacion.datos.conciliadas} formato="numero"
              nota={`de ${conciliacion.datos.cfdis} CFDI consolidado${conciliacion.datos.cfdis === 1 ? '' : 's'} recibido${conciliacion.datos.cfdis === 1 ? '' : 's'}`} />
            <Cifra icono={<Icono icono={Receipt} />}
              etiqueta="Por revisar a mano" info="combustible_casetas.por_revisar" valor={conciliacion.datos.porConciliar} formato="numero"
              nota={conciliacion.datos.porConciliar === 0 ? 'Todo lo que llegó, concilió solo' : 'Elige el candidato correcto abajo, o marca que ninguno aplica'} />
            <Cifra icono={<Icono icono={CircleCheck} />}
              etiqueta="Revisadas, sin gasto que corresponda" info="combustible_casetas.sin_gasto" valor={conciliacion.datos.sinMatch} formato="numero"
              nota="Un humano ya las miró — quedan documentadas, sin viaje" />
          </TiraCifras>

          {conciliacion.datos.porConciliar > 0 && (
            lineasPendientes === null ? (
              <EstadoError reintentar>
                No se pudo cargar la lista para resolver a mano. Los conteos de arriba sí son reales, pero
                la lista con los candidatos de cada línea no cargó. Recarga la página.
              </EstadoError>
            ) : (
              <Tarjeta titulo="Líneas por resolver a mano" info="combustible_casetas.por_revisar">
                <p className="rv-comb__nota">
                  Una línea queda aquí cuando no hubo exactamente un ticket que cuadrara por fecha y monto —cero
                  candidatos, o más de uno—: se prefiere pedir una revisión a adivinar cuál gasto es. Elige el
                  viaje correcto o marca &ldquo;ninguno de estos&rdquo; para dejarla documentada.
                </p>
                <LineasPorConciliar lineas={lineasPendientes} accion={accionResolverLinea} />
              </Tarjeta>
            )
          )}
        </>
      )}

      <Disclosure titulo="Qué no mide esta pantalla" variante="tarjeta">
        <p className="rv-comb__nota">
          El rendimiento en km/l no aparece porque nadie captura el kilometraje: el viaje no lo guarda, y el
          tabulador de la configuración es una calibración de litros esperados por placa, no una medición de
          campo. Dividir el gasto entre un kilometraje inventado daría un número con cara de medición.
        </p>
        <p className="rv-comb__nota">
          El cruce del estado de cuenta del monedero de combustible y del TAG de casetas contra el CFDI —el que
          detecta la ordeña de verdad, litros comprados contra litros ingresados— YA EXISTE para lo que llega
          por WhatsApp (ver la sección de arriba). Lo que sigue faltando es una conexión directa al portal del
          monedero/TAG que traiga ese CFDI sola, sin depender de que alguien en la flota lo reenvíe.
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}
