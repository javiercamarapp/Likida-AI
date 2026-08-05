import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Fuel, Route as RouteIcon, Receipt, Copy, FileStack, CircleCheck } from 'lucide-react';
import {
  getGastoPorConcepto, getAcreditables, detectarAnomalias, getDocumentos, getConciliacionConsolidado,
  getLineasPorConciliar,
  type GastoPorConcepto, type Acreditables, type Anomalia, type DocumentoRow, type ConciliacionConsolidado,
  type LineaPorConciliar,
} from '@/lib/cuadra/analytics';
import { resolverLineaAMano, type ResolucionLineaManual } from '@/lib/cuadra/intake/consolidado';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { KpiTile, EstadoVacio, ChartCard, StatusPill } from '../../admin/ui/kit';
import { HBars } from '../../admin/ui/graficas';
import { Dona } from '../../admin/charts';
import { sufijoTenant } from '../sufijo';
import { LineasPorConciliar, NINGUNO_VALOR } from './vista-consolidado';

export const dynamic = 'force-dynamic';

/** Los mensajes de `ResultadoResolverLinea.motivo` en lenguaje de contador —
 *  ninguno de los cinco es genérico: cada uno le dice a la persona que acaba
 *  de hacer clic exactamente por qué su clic no cerró la línea. */
const MOTIVO_ERROR: Record<string, string> = {
  linea_no_encontrada: 'Esa línea ya no existe.',
  ya_resuelta: 'Alguien más ya la resolvió — revisa el estado actual.',
  candidato_no_ofrecido: 'Ese candidato no es uno de los que el sistema ofreció.',
  gasto_ya_no_disponible: 'El gasto elegido ya quedó ligado a otra línea mientras revisabas.',
  error_bd: 'No se pudo guardar — intenta de nuevo.',
};

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
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
 * Diésel por monedero y peaje por TAG (~54% del gasto real, INEGI EAT 2024)
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
export default async function CombustibleCasetasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/combustible-casetas', sp);
  const sufijo = sufijoTenant(sp);

  const [porConcepto, acred, anomalias, docs, conciliacion, lineasPendientes] = await Promise.all([
    safe<GastoPorConcepto[]>(() => getGastoPorConcepto(tenantId)),
    safe<Acreditables>(() => getAcreditables(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    safe<DocumentoRow[]>(() => getDocumentos(tenantId, 1000)),
    safeConciliacion(tenantId),
    safe<LineaPorConciliar[]>(() => getLineasPorConciliar(tenantId)),
  ]);

  /**
   * A qué tenant escribe la Server Action. Mismo patrón que
   * `incidencias/page.tsx`: `requireSessionTenant` da la sesión REAL (no la
   * previsualizada por `resolverTenantEfectivo`, que solo aplica a la
   * LECTURA de esta página), y se revalida `puedeVerRuta` aquí porque una
   * Server Action es un endpoint POST alcanzable por su cuenta — el gateo de
   * la página (arriba) no la protege.
   */
  async function tenantYUsuarioDelAction() {
    const s = await requireSessionTenant('/dashboard/combustible-casetas');
    if (!puedeVerRuta(s.rol, '/dashboard/combustible-casetas')) {
      redirect(`/dashboard/combustible-casetas${sufijo}`);
    }
    if (s.rol === 'superadmin' && sp?.tenant) {
      const t = await resolverTenantPedido(supabaseAdmin(), s.tenantId, sp.tenant);
      return { tenantId: t, userId: s.userId };
    }
    return { tenantId: s.tenantId, userId: s.userId };
  }

  async function accionResolverLinea(formData: FormData) {
    'use server';
    const { tenantId: t, userId } = await tenantYUsuarioDelAction();
    const lineaId = String(formData.get('lineaId') ?? '');
    const eleccion = String(formData.get('eleccion') ?? '');
    if (!lineaId || !eleccion) redirect(`/dashboard/combustible-casetas${sufijo}`);

    const resolucion: ResolucionLineaManual = eleccion === NINGUNO_VALOR
      ? { tipo: 'sin_match' }
      : { tipo: 'ligar', gastoId: eleccion };
    const r = await resolverLineaAMano(t, lineaId, resolucion, userId);

    revalidatePath('/dashboard/combustible-casetas');
    const ok = r.ok ? 'resuelta' : `error_${r.motivo ?? 'error_bd'}`;
    redirect(`/dashboard/combustible-casetas${sufijo ? `${sufijo}&` : '?'}ok=${ok}`);
  }

  const diesel = porConcepto?.find((c) => c.concepto === 'diesel');
  const caseta = porConcepto?.find((c) => c.concepto === 'caseta');
  // "Sin CFDI" solo se puede afirmar sobre los comprobantes que SÍ se leyeron;
  // si la consulta falló, no se afirma nada.
  const combustibleYCasetas = docs?.filter((d) => d.concepto === 'diesel' || d.concepto === 'caseta') ?? [];
  const sinCfdi = combustibleYCasetas.filter((d) => !d.cfdiUuid).length;
  const pctSinCfdi = combustibleYCasetas.length > 0 ? Math.round((sinCfdi / combustibleYCasetas.length) * 100) : null;
  const anomaliasCombustible = anomalias?.filter((a) => /diesel|caseta/i.test(a.detalle)) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Fuel width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">Combustible & Casetas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Los dos conceptos que más pesan en un viaje, y qué tanto están facturados
          </span>
        </div>
        {sp.ok === 'resuelta' && <StatusPill estado="ok">Línea resuelta</StatusPill>}
        {sp.ok?.startsWith('error_') && (
          <StatusPill estado="bad">
            {MOTIVO_ERROR[sp.ok.slice('error_'.length)] ?? 'No se pudo resolver la línea.'}
          </StatusPill>
        )}
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            El gasto
          </h2>
          {porConcepto === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Gastado en combustible" valor={diesel?.total ?? 0} formato="mxn"
                nota={diesel ? `${diesel.n} cargas registradas` : 'Sin cargas registradas todavía'} />
              <KpiTile icono={<RouteIcon width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Gastado en casetas" valor={caseta?.total ?? 0} formato="mxn"
                nota={caseta ? `${caseta.n} casetas registradas` : 'Sin casetas registradas todavía'} />
              <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Litros elegibles para el estímulo" valor={acred?.litrosDiesel ?? 0} formato="litros"
                nota="LIF 2026, Art. 20-A" />
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Sin CFDI (combustible y casetas)" valor={pctSinCfdi ?? 0} formato="porcentaje"
                vacio={pctSinCfdi === null ? 'Sin comprobantes de estos conceptos todavía' : undefined}
                nota={pctSinCfdi === null ? undefined : `${sinCfdi} de ${combustibleYCasetas.length} sin factura — es deducible que se pierde`} />
            </div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {porConcepto && porConcepto.length > 1 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard titulo="Gasto por concepto" tamano="M">
                <HBars datos={porConcepto.map((c) => ({ etiqueta: etiquetaConcepto(c.concepto), valor: c.total }))} formato="mxn" />
              </ChartCard>
              <ChartCard titulo="Reparto del gasto" tamano="M">
                <Dona segmentos={porConcepto.map((c) => ({ etiqueta: etiquetaConcepto(c.concepto), valor: c.total }))} />
              </ChartCard>
            </div>
          ) : (
            <ChartCard titulo="Gasto por concepto" tamano="S">
              <EstadoVacio icono={<Fuel width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Hace falta más de un concepto de gasto registrado para comparar.
              </EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Posible carga repetida
          </h2>
          {anomalias === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo revisar.</div>
          ) : anomaliasCombustible.length === 0 ? (
            <div className="mt-3">
              <EstadoVacio icono={<Copy width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Ningún comprobante de combustible o caseta aparece cargado en más de un viaje.
              </EstadoVacio>
            </div>
          ) : (
            <>
              <div className="divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
                {anomaliasCombustible.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm">{a.detalle}</div>
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Viajes: {a.viajes.join(' · ')}</div>
                    </div>
                    <div className="text-sm font-semibold tabular whitespace-nowrap shrink-0">{mxn(a.monto)}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                Coincidencia detectada, no un veredicto: verifica antes de conversarlo con el operador.
              </p>
            </>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            CFDI consolidado (monedero y TAG)
          </h2>
          {!conciliacion.ok ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
          ) : conciliacion.datos === null ? (
            <div className="mt-3">
              <EstadoVacio icono={<FileStack width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Todavía no llega ningún CFDI consolidado de esta flota (el que factura el diésel de un monedero o
                el peaje de un TAG por periodo completo, no ticket por ticket). En cuanto alguien lo reenvíe por
                WhatsApp, aquí se ve cuánto quedó ligado solo contra cuánto necesita revisión.
              </EstadoVacio>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                <KpiTile icono={<FileStack width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Líneas ligadas automáticamente" valor={conciliacion.datos.conciliadas} formato="numero"
                  nota={`de ${conciliacion.datos.cfdis} CFDI consolidado${conciliacion.datos.cfdis === 1 ? '' : 's'} recibido${conciliacion.datos.cfdis === 1 ? '' : 's'}`} />
                <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Por revisar a mano" valor={conciliacion.datos.porConciliar} formato="numero"
                  nota={conciliacion.datos.porConciliar === 0 ? 'Todo lo que llegó, concilió solo' : 'Elige el candidato correcto abajo, o marca que ninguno aplica'} />
                <KpiTile icono={<CircleCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Revisadas, sin gasto que corresponda" valor={conciliacion.datos.sinMatch} formato="numero"
                  nota="Un humano ya las miró — quedan documentadas, sin viaje" />
              </div>

              {conciliacion.datos.porConciliar > 0 && (
                lineasPendientes === null ? (
                  <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>
                    No se pudo cargar la lista para resolver a mano — los conteos de arriba sí son reales, pero
                    la lista con los candidatos de cada línea no cargó. Recarga la página.
                  </div>
                ) : (
                  <>
                    <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                      Una línea queda aquí cuando no hubo exactamente un ticket que cuadrara por fecha y monto —cero
                      candidatos, o más de uno—: se prefiere pedir una revisión a adivinar cuál gasto es. Elige el
                      viaje correcto o marca &ldquo;ninguno de estos&rdquo; para dejarla documentada.
                    </p>
                    <LineasPorConciliar lineas={lineasPendientes} accion={accionResolverLinea} />
                  </>
                )
              )}
            </>
          )}
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            El rendimiento en km/l no aparece porque nadie captura el kilometraje: `viaje` no lo guarda, y el
            tabulador de la configuración es una calibración de litros esperados por placa, no una medición de
            campo. Dividir el gasto entre un kilometraje inventado daría un número con cara de medición.
            <br /><br />
            El cruce del estado de cuenta del monedero de combustible y del TAG de casetas contra el CFDI —el que
            detecta la ordeña de verdad, litros comprados contra litros ingresados— YA EXISTE para lo que llega
            por WhatsApp (ver la sección de arriba). Lo que sigue faltando es una conexión directa al portal del
            monedero/TAG que traiga ese CFDI sola, sin depender de que alguien en la flota lo reenvíe.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
