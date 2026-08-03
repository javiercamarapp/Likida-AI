import { requireSessionTenant } from '@/lib/auth/guard';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getKpis, getAcreditables, detectarAnomalias, type DashboardKpis, type Acreditables, type Anomalia } from '@/lib/cuadra/analytics';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mxn } from '@/lib/utils';
import { LEYENDA_CORTA } from '@/lib/cuadra/cuadre/leyendas';
import { estadoPanel } from './estado';
import { litros, fechaMx } from './formato';
import { puedeExportar } from '@/lib/auth/permisos';

export const dynamic = 'force-dynamic';

const ESTATUS = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
} as const;

/** Resiliencia por sección: si una consulta falla, devuelve null y la tarjeta
 *  muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** `creadoEn` viaja en ISO crudo: la fecha se formatea al pintarla, y en hora
 *  de México. `.slice(0, 10)` se quedaba con el día UTC, así que una
 *  liquidación cerrada el 31-jul a las 20:00 salía listada en agosto — justo en
 *  el corte mensual (auditoría 5, frontend, MEDIO 3). */
interface LiqRow { id: string; folio: string; creadoEn: string; comprobado: number; diferencia: number; estatus: string }

async function getLiquidaciones(tenantId: string): Promise<LiqRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('id, estatus, total_comprobado, diferencia, created_at, viaje:viaje_id(folio)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20);
  // supabase-js reporta el fallo POR VALOR: sin este throw, una lectura caída
  // devolvía `[]` y `safe()` nunca veía el error. La tabla salía con
  // encabezados y cero filas bajo unos KPIs que decían "12 viajes liquidados"
  // (auditoría 5, frontend, CRÍTICO).
  if (error) throw new Error(`getLiquidaciones: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    folio: ((r.viaje as { folio?: string } | null)?.folio) ?? (r.id as string).slice(0, 8),
    creadoEn: r.created_at as string,
    comprobado: Number(r.total_comprobado ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus as string,
  }));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  // Segunda capa: la autorización viaja con la página, no solo con el matcher
  // del proxy. Las dos tienen que fallar a la vez para que esto se sirva.
  const { tenantId, rol } = await requireSessionTenant('/dashboard');
  // Sin esto, un superadmin que llegue aquí por bookmark/historial (no por
  // /login, que es lo único que /auth/callback intercepta) se quedaba
  // viendo el panel del tenant demo en vez de SU consola. /admin enlaza aquí
  // con `?vista=demo` a propósito, cuando de verdad quiere ver lo que ve un
  // cliente.
  const sp = await searchParams;
  if (rol === 'superadmin' && sp?.vista !== 'demo') redirect('/admin');
  const [acred, kpis, liqs, anomalias] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId)),
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<LiqRow[]>(() => getLiquidaciones(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
  ]);

  // La decisión vive en `estado.ts` y está probada. Aquí solo se aplica.
  // Antes eran dos booleanos con una premisa falsa: daban por hecho que una
  // consulta caída llega como `null`, y supabase-js reporta por valor, así que
  // llegaba como ceros y el panel afirmaba "Aún no hay liquidaciones" con la
  // base caída. Las consultas ya lanzan (analytics.ts); falta no volver a
  // afirmar nada cuando UNA sección se cayó.
  const estado = estadoPanel({ acreditables: acred, kpis, liquidaciones: liqs, anomalias });

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-6xl mx-auto px-8 h-16 flex items-center justify-between">
          <h1 className="flex items-center gap-3 m-0 font-normal">
            <span className="font-semibold tracking-tight text-xl">Likida</span>
            <span className="text-base" style={{ color: 'var(--muted)' }}>· Panel de liquidación</span>
          </h1>
          {/* `/cuenta` es el ÚNICO sitio con "Cerrar sesión" y nada en la app
              apuntaba ahí: la página existía y solo se llegaba tecleando la URL.
              Con el passcode no importaba (se cerraba borrando la cookie); con
              cuentas por usuario, salirse es parte del producto. */}
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ color: 'var(--muted)', background: 'color-mix(in srgb, var(--muted) 10%, transparent)' }}>
              datos de demostración
            </span>
            <Link href="/cuenta" className="text-sm px-3 py-1.5 rounded-lg hairline hover:opacity-70">
              Mi cuenta
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10 space-y-10">
        {estado === 'error' ? (
          <div className="card p-12 text-center">
            <p className="text-2xl font-semibold tracking-tight">No se pudieron cargar los datos</p>
            <p className="mt-3 text-base" style={{ color: 'var(--muted)' }}>
              Hubo un problema al leer del sistema. Recarga la página en un momento.
            </p>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
              Esto NO significa que no haya liquidaciones: significa que no se pudieron leer.
            </p>
          </div>
        ) : estado === 'vacio' ? (
          <div className="card p-12 text-center">
            <p className="text-2xl font-semibold tracking-tight">Aún no hay liquidaciones</p>
            <p className="mt-3 text-base" style={{ color: 'var(--muted)' }}>
              En cuanto un operador cierre su primer viaje por WhatsApp, aquí aparecerán los acreditables y el detalle.
            </p>
            <Link href="/demo" className="inline-block mt-6 px-5 py-2.5 rounded-xl text-base font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Ver el demo</Link>
          </div>
        ) : (
          <>
            {/* ── Aviso de carga incompleta ──
                Un fallo PARCIAL callado es peor que uno total: los KPIs dicen
                "12 viajes · $340,000" y la tabla de abajo sale vacía, o la
                sección de duplicados no aparece y se lee como "todo limpio".
                Ninguna cifra de esta pantalla es el corte del periodo mientras
                falte una sección, y eso se dice arriba, no en gris. */}
            {estado === 'parcial' && (
              <div className="card p-5 flex items-start gap-3" style={{ borderColor: 'var(--color-warn)' }}>
                <span className="inline-block w-2.5 h-2.5 rounded-full mt-2 shrink-0" style={{ background: 'var(--color-warn)' }} />
                <div>
                  <p className="text-base font-semibold m-0">Faltan datos por cargar — esta pantalla está incompleta</p>
                  <p className="text-sm mt-1 m-0" style={{ color: 'var(--muted)' }}>
                    Una o más secciones no respondieron. No tomes estas cifras como el corte del periodo:
                    recarga en un momento y vuelve a compararlas.
                  </p>
                </div>
              </div>
            )}

            {/* ── HERO: acreditables del periodo (lo que hace enderezarse al contralor) ── */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
                Estímulos acreditables del periodo
              </h2>
              {acred === null ? (
                <div className="card p-8" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <Acred titulo="Diésel elegible para el estímulo" valor={acred.litrosDiesel} unidad="litros"
                    base="LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente" destacar />
                  <Acred titulo="IVA acreditable" valor={acred.iva} base="LIVA, Art. 5 — CFDI con IVA desglosado" />
                  <Acred titulo="Peaje (50%)" valor={acred.peaje} base="Estímulo de autopistas · LIF 2026, Art. 20-A" />
                </div>
              )}
            </section>

            {/* ── Liquidaciones del periodo ── */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
                Liquidaciones del periodo
              </h2>
              {kpis === null ? (
                <div className="card p-8" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <Kpi label="Viajes liquidados" value={String(kpis.viajesLiquidados)} />
                  <Kpi label="Monto comprobado" value={mxn(kpis.montoComprobado)} />
                  <Kpi label="Con diferencia" value={String(kpis.conDiferencias + kpis.porRevisar)} />
                  <Kpi label="Tasa de cuadre" value={`${kpis.tasaCuadre}%`} />
                </div>
              )}
            </section>

            {/* ── Mismo comprobante en dos viajes ──
                Cada liquidación se ve impecable por separado: esto solo se ve
                mirando TODAS juntas. Se muestra únicamente si hay algo — una
                sección vacía que dice "0 anomalías" entrena a ignorarla. */}
            {anomalias !== null && anomalias.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
                  Revisar · mismo comprobante en varios viajes
                </h2>
                <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
                  {anomalias.map((a, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 p-4">
                      <div>
                        <div className="text-sm">{a.detalle}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                          Viajes: {a.viajes.join(' · ')}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums whitespace-nowrap">{mxn(a.monto)}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                  Coincidencia detectada, no un veredicto: verifica antes de conversarlo con el operador.
                </p>
              </section>
            )}

            {/* ── Tabla (cada fila abre el detalle) ── */}
            <section>
              {/* La ruta de export existía, iba detrás del mismo passcode, tenía
                  rate-limit y devolvía un CSV con `Content-Disposition:
                  attachment` — y NADA en la interfaz apuntaba a ella. En el demo,
                  "¿esto lo puedo bajar a Excel?" se contestaba tecleando una URL
                  a mano (auditoría 5, frontend, MEDIO 5). */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                  Detalle por liquidación
                </h2>
                {puedeExportar(rol) && (
                  <a href="/api/export/liquidaciones" download
                    className="text-sm px-3.5 py-2 rounded-lg hairline hover:opacity-70">
                    Exportar CSV
                  </a>
                )}
              </div>
              {liqs === null ? (
                <div className="card p-8" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado.</div>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-base">
                    <thead>
                      <tr style={{ color: 'var(--muted)' }} className="text-left text-sm">
                        <th className="px-6 py-3 font-medium">Folio</th>
                        <th className="px-6 py-3 font-medium">Fecha</th>
                        <th className="px-6 py-3 font-medium text-right">Comprobado</th>
                        <th className="px-6 py-3 font-medium text-right">Diferencia</th>
                        <th className="px-6 py-3 font-medium">Estatus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liqs.map((l) => {
                        const e = ESTATUS[l.estatus as keyof typeof ESTATUS] ?? { label: l.estatus, color: 'var(--muted)' };
                        return (
                          // `relative` + el pseudo-elemento estirado del <Link>:
                          // la fila entera es el blanco de toque, no un texto de
                          // ~20px dentro de una celda. El <tr> llevaba
                          // `hover:opacity-80` —la señal universal de "esto se
                          // puede clicar"— y solo el folio navegaba; en tableta
                          // no hay hover, así que el único blanco del panel
                          // quedaba muy por debajo de los 44px de toque
                          // (auditoría 5, frontend, BAJO 1). Sigue habiendo UN
                          // solo enlace por fila: cinco celdas enlazadas serían
                          // cinco paradas de tabulación por liquidación.
                          <tr key={l.id} className="relative border-t hover:opacity-80" style={{ borderColor: 'var(--line)' }}>
                            <td className="px-6 py-4 font-medium">
                              <Link href={`/dashboard/${l.id}`}
                                className="hover:underline after:absolute after:inset-0 after:content-['']">{l.folio}</Link>
                            </td>
                            <td className="px-6 py-4" style={{ color: 'var(--muted)' }}>{fechaMx(l.creadoEn)}</td>
                            <td className="px-6 py-4 text-right tabular">{mxn(l.comprobado)}</td>
                            {/* La dirección va PEGADA a la cifra, no en el detalle.
                                `Math.abs()` sin más borraba el signo que el motor
                                define (engine.ts: + sobró anticipo, − el operador
                                puso de su bolsa): dos liquidaciones opuestas
                                —$10,000 de anticipo contra $8,500 comprobados, y
                                contra $11,500— imprimían el MISMO "$1,500.00", con
                                el mismo estatus y la misma tipografía. El contralor
                                escanea la lista y lee todo como dinero a favor de
                                la empresa; en la mitad de los casos la empresa DEBE
                                ese dinero. El detalle ya lo decía bien y la lista no
                                lo heredó (auditoría 5, frontend, ALTO 1). */}
                            <td className="px-6 py-4 text-right">
                              {l.diferencia === 0 ? (
                                <span className="tabular">—</span>
                              ) : (
                                <>
                                  <span className="tabular block">{mxn(Math.abs(l.diferencia))}</span>
                                  <span className="text-xs block whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                                    {l.diferencia > 0 ? 'a favor de la empresa' : 'a favor del operador'}
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: e.color }} />
                              {e.label}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        <p className="text-xs mt-10 pt-6 border-t" style={{ color: 'var(--muted)', borderColor: 'var(--line)' }}>
          {LEYENDA_CORTA}
        </p>
      </main>
    </div>
  );
}

function Acred({ titulo, valor, base, destacar, unidad }: { titulo: string; valor: number; base: string; destacar?: boolean; unidad?: 'litros' }) {
  // `unidad` existe porque no todo lo acreditable son pesos. El estímulo de
  // diésel es cuota semanal disminuida × litros (LIF 2026 art. 20-A), y esa
  // cuota no la tenemos: entregar los litros es honesto, inventar los pesos no.
  //
  // Con `maximumFractionDigits: 0` esta tarjeta decía "152 L" y el detalle,
  // a un clic, "152.35 L" — y el PDF que el contralor le manda a su contador,
  // una tercera cifra. En un dato fiscal, tres representaciones se leen como
  // tres cálculos (auditoría 5, frontend, MEDIO 1). `litros()` es la única.
  const texto = unidad === 'litros' ? litros(valor) : mxn(valor);
  return (
    <div className="card p-7" style={destacar ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="text-sm font-medium" style={{ color: 'var(--muted)' }}>{titulo}</div>
      <div className="text-4xl md:text-5xl font-semibold tracking-tight tabular mt-2"
        style={{ color: destacar ? 'var(--accent)' : 'var(--ink)' }}>{texto}</div>
      <div className="text-xs mt-3" style={{ color: 'var(--muted)' }}>{base}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-6">
      <div className="text-3xl font-semibold tracking-tight tabular">{value}</div>
      <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
