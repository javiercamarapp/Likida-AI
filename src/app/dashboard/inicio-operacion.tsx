import Link from 'next/link';
import { Send, UserCog, CircleSlash, CalendarDays, Plus, Users, History } from 'lucide-react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import {
  getViajes, getOperadoresDetalle, getSerieComparativa,
  type ViajeRow, type OperadorDetalle, type ComparativoPeriodo,
} from '@/lib/likida/analytics';
import {
  getTableroOperacion, getViajesSinAsignar, getCargaOperadores, getIncidencias, getUnidades,
  type TableroOperacion, type ViajeSinAsignar, type CargaOperador, type IncidenciaRow, type UnidadRow,
} from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, avisoVigencias, DIAS_AVISO } from '@/lib/likida/vigencias';
import { EstadoVacio } from '../admin/ui/kit';
import { BarraPagina, ChipFecha, HeroSaludo, TituloSeccion } from './resumen-visual';
import { TableroCifras, TablaCarga, TablaViajesOperacion, type FilaViajeOperacion } from './tablero-operacion';
import AvanceCierre from './avance-cierre';
import { getViajesPorDia, type DiaViajes } from './serie-diaria';
import { AvisoSinFlota } from './sin-flota';
import { getPrimerosPasos } from '@/lib/likida/primeros-pasos';
import { PrimeraLiquidacion } from './primera-liquidacion';
import { OperaWhatsApp } from './opera-whatsapp';

// ═══════════════════════════════════════════════════════════════════════════
// LA CASA DEL ENCARGADO.
//
// El Resumen que existía es del DUEÑO: abre con lo que el motor señaló en
// pesos, los acreditables fiscales y el monto comprobado. El jefe de tráfico
// no ve nada de eso (visibilidad.ts), así que aterrizaba en una pantalla
// llena de huecos o, peor, en una que le enseñaba justo lo que no le toca.
//
// Esta es la misma casa con otro contenido: la MISMA anatomía del
// Resumen (12-ago-2026 — barra de página, saludo sobre el lienzo tenue,
// tarjetas blancas encima), pero lo que hay adentro es lo que él persigue en
// la mañana: qué no tiene chofer, qué papel vence, quién trae cuánto, y qué
// se salió de lo normal. Cero pesos en toda la pantalla — la regla no es de
// estilo: `dinero_por_area.test.ts` escanea este archivo.
//
// Rehecha el 14-ago-2026 del glass-panel viejo a esta anatomía.
// ═══════════════════════════════════════════════════════════════════════════

/** Resiliencia por sección: si una consulta falla, devuelve null y la
 *  tarjeta muestra un fallback en vez de tirar toda la pantalla. NULL ≠ 0 —
 *  el render de abajo nunca convierte un null en un cero que parezca
 *  medición. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** A cuántos días del día de México vence una licencia — misma aritmética
 *  que `operadores/vista.tsx`; las FRONTERAS de estado (30 días, vencido,
 *  sin dato) son las de `vigencias.ts`, para que "por vencer" quiera decir
 *  lo mismo aquí que en su página. */
function diasParaVencer(vence: string, hoy: string): number {
  return Math.round((Date.parse(`${vence}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

export async function InicioOperacion({
  tenantId, tenantNombre, nombre, tenantExiste = true, sufijo = '',
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `sin-flota.tsx`. Aquí importa más que en el Resumen del dueño: sin
   *  flota, "Todo lo que está en curso ya trae chofer" y "0 viajes activos"
   *  se leen como una mañana tranquila, no como una base vacía. */
  tenantExiste?: boolean;
  /** Query string que los links internos deben cargar (`?tenant=`/`?vista=`/
   *  `?rol=` del superadmin) — mismo contrato que `InicioContenido` y el
   *  sidebar; vacío para roles reales. Lo arma `page.tsx`, que es quien
   *  tiene los searchParams. */
  sufijo?: string;
}) {
  const ahora = ahoraMs();
  // El DÍA DE MÉXICO, no el UTC: a las 6pm de CDMX el chip de fecha decía
  // mañana (capturado el 12-ago), y una licencia que vence "hoy" salía
  // vencida. Mismo cálculo que `operadores/page.tsx`.
  const diaMx = hoyMx(new Date(ahora));

  const [
    tablero, sinAsignar, carga, incidencias, viajes, unidades, operadores, pasos,
    viajesPorDia, historico,
  ] = await Promise.all([
    safe<TableroOperacion>(() => getTableroOperacion(tenantId)),
    safe<ViajeSinAsignar[]>(() => getViajesSinAsignar(tenantId)),
    safe<CargaOperador[]>(() => getCargaOperadores(tenantId)),
    safe<IncidenciaRow[]>(() => getIncidencias(tenantId)),
    safe<ViajeRow[]>(() => getViajes(tenantId)),
    // Las vigencias que anclan (ver `vigencias.ts`): vivían
    // solo en /unidades y /operadores, o sea que avisaban únicamente a quien
    // ya había abierto la página — aquí suben al inicio, que es donde el
    // aviso sirve de algo.
    safe<UnidadRow[]>(() => getUnidades(tenantId)),
    // Solo se usan nombre/activo/licencia — el dinero que este helper trae
    // (anticipos, % comprobado) SE QUEDA EN EL SERVIDOR, igual que en
    // `operadores/page.tsx` (la fuga del 4-ago fue exactamente eso).
    safe<OperadorDetalle[]>(() => getOperadoresDetalle(tenantId)),
    safe(() => getPrimerosPasos(tenantId)),
    // FE-5: el "Avance de cierre" contaba en memoria sobre las 100 filas de
    // `viajes` — a 50k viajes/mes eso son ~90 minutos, y los tres botones
    // (7d/30d/Todo) medían exactamente la misma hora y media. Ahora la base
    // cuenta por día y el histórico va por su propia ventana.
    safe<DiaViajes[]>(() => getViajesPorDia(tenantId, diaMx)),
    safe<ComparativoPeriodo[]>(() => getSerieComparativa(tenantId, 3650, 1, diaMx)),
  ]);

  // ── Alertas accionables — SOLO si hay fuego real ─────────────────────────
  // Una banda que siempre dice algo entrena a ignorarla. Cada alerta lleva a
  // LA pantalla donde se resuelve, con el sufijo del superadmin a cuestas —
  // y la que no tiene pantalla va SIN link: las incidencias y los POD hoy no
  // se trabajan en ninguna página (`getIncidencias`/`getPods` no se usan
  // fuera de este inicio), y un "Ver →" a un 404 es peor que nada.
  const alertas: Array<{ texto: string; href: string | null }> = [];

  if (sinAsignar && sinAsignar.length > 0) {
    alertas.push({
      texto: `${sinAsignar.length} viaje${sinAsignar.length === 1 ? '' : 's'} sin chofer — se asigna en Despacho`,
      href: `/dashboard/despacho${sufijo}`,
    });
  }
  const vencidas = (incidencias ?? []).filter((i) => i.slaVencido);
  if (vencidas.length > 0) {
    alertas.push({
      texto: `${vencidas.length} incidencia${vencidas.length === 1 ? '' : 's'} pasada${vencidas.length === 1 ? '' : 's'} de su tiempo comprometido`,
      href: null,
    });
  }
  if (tablero && tablero.podPendientes > 0) {
    alertas.push({
      texto: `${tablero.podPendientes} viaje${tablero.podPendientes === 1 ? '' : 's'} en curso sin evidencia de entrega`,
      href: null,
    });
  }
  // Papeles de unidades: la MISMA frase que el banner de /unidades
  // (`avisoVigencias`), que ya se calla sola cuando no hay nada que decir.
  // Solo las activas: una unidad dada de baja no va a salir a carretera.
  const conteoVigencias = unidades ? contarVigencias(unidades.filter((u) => u.activo)) : null;
  const avisoUnidades = conteoVigencias ? avisoVigencias(conteoVigencias) : null;
  if (avisoUnidades) {
    alertas.push({ texto: avisoUnidades, href: `/dashboard/unidades${sufijo}` });
  }
  // Licencias de operadores — la otra vigencia que ancla (0053). `null` en
  // `licenciaVence` es "sin registrar", no vencida: no alerta.
  if (operadores) {
    const activos = operadores.filter((o) => o.activo && o.licenciaVence !== null);
    const estadoDe = (o: OperadorDetalle) =>
      clasificarVigencia(diasParaVencer(o.licenciaVence!, diaMx), 'Licencia').estado;
    const licVencidas = activos.filter((o) => estadoDe(o) === 'vencido').length;
    const licPorVencer = activos.filter((o) => estadoDe(o) === 'por_vencer').length;
    const partes: string[] = [];
    if (licVencidas > 0) {
      partes.push(licVencidas === 1 ? '1 chofer con la licencia vencida' : `${licVencidas} choferes con la licencia vencida`);
    }
    if (licPorVencer > 0) {
      partes.push(licPorVencer === 1
        ? `1 licencia vence en los próximos ${DIAS_AVISO} días`
        : `${licPorVencer} licencias vencen en los próximos ${DIAS_AVISO} días`);
    }
    if (partes.length > 0) {
      alertas.push({ texto: partes.join(' · '), href: `/dashboard/operadores${sufijo}` });
    }
  }

  // Una consulta caída NO es "sin fuego": si una fuente de alertas no se
  // pudo leer, se dice ANTES de la banda — una banda vacía sobre una fuente
  // caída afirmaría "todo en orden" estando ciega.
  const ciegas: string[] = [];
  if (sinAsignar === null) ciegas.push('los viajes sin chofer');
  if (incidencias === null) ciegas.push('las incidencias');
  if (tablero === null) ciegas.push('el estado de la operación');
  if (unidades === null) ciegas.push('los papeles de las unidades');
  if (operadores === null) ciegas.push('las licencias');

  // Las 100 filas MÁS RECIENTES (tope de `getViajes`), SIN el anticipo: el
  // tipo de la tabla no tiene campo donde ponerlo — ver `FilaViajeOperacion`.
  // "recientes" es literal y el encabezado lo dice: no son todas, y el
  // registro completo vive en /dashboard/viajes.
  const filasViajes: FilaViajeOperacion[] = (viajes ?? []).map((v) => ({
    id: v.id, folio: v.folio, origen: v.origen, destino: v.destino,
    estatus: v.estatus, operadorNombre: v.operadorNombre, fechaInicio: v.fechaInicio,
  }));

  const ICONO_BARRA = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--muted)' } } as const;
  const ICONO_SECCION = { width: 14, height: 14, strokeWidth: 1.75, style: { color: 'var(--marca)' } } as const;

  return (
    // El scroll vive DENTRO del panel (patrón FASE 1.5). El lienzo del
    // contenido es TENUE (`--g1`) y las piezas son tarjetas blancas encima —
    // misma anatomía en toda la app; la barra y el saludo van sobre blanco.
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Send {...ICONO_BARRA} />}
          titulo="Operación"
          derecha={tenantNombre && (
            <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
              viendo como superadmin · {tenantNombre}
            </span>
          )}
        />
        <HeroSaludo
          saludo={saludo()} nombre={nombre ?? 'jefe'}
          tagline="Lo que hay que despachar y perseguir hoy"
          derecha={
            <div className="flex items-center gap-2.5 shrink-0 pt-1">
              <ChipFecha icono={<CalendarDays {...ICONO_BARRA} />}>{fechaMx(diaMx)}</ChipFecha>
              {/* Secundario a Operadores — "¿a quién le cargo el siguiente?"
                  es la otra pregunta de la mañana. `hidden md:` para que en
                  angosto nunca desplace al CTA primario. */}
              <Link href={`/dashboard/operadores${sufijo}`}
                className="hairline h-8 px-3 rounded-lg text-[13px] font-medium hidden md:inline-flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-70"
                style={{ background: 'var(--surface)' }}>
                <Users width={15} height={15} strokeWidth={1.75} /> Operadores
              </Link>
              {/* A DESPACHO (13-ago): ahí vive la forma de crear — junto con
                  asignar, avisar y el alta de operadores. La página suelta
                  /viajes/nuevo se retiró: era la misma forma con menos
                  contexto, y dos puertas se desincronizan. */}
              <Link href={`/dashboard/despacho${sufijo}`}
                className="h-8 px-3 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-85"
                style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                <Plus width={15} height={15} strokeWidth={2} /> Nuevo viaje
              </Link>
            </div>
          }
        />

        <div className="px-5 pb-5 flex-1">
          {/* ANTES QUE NINGUNA CIFRA. Lo de abajo son ceros de una flota que
              no existe, y esa frase tiene que llegar antes que los ceros. */}
          {!tenantExiste && (
            <div className="mt-3"><AvisoSinFlota tenantId={tenantId} /></div>
          )}

          {/* La guía del arranque (auditoría 5) — misma pieza que el Resumen
              del dueño; el encargado también puede llevar a la flota a su
              primera liquidación. */}
          {tenantExiste && pasos && !pasos.completado && (
            <div className="mt-3"><PrimeraLiquidacion datos={pasos} sufijo={sufijo} /></div>
          )}

          {tenantExiste && pasos && !pasos.completado && (
            <div className="mt-3"><OperaWhatsApp rol="jefe" /></div>
          )}

          {ciegas.length > 0 && (
            <div className="card p-3 flex items-start gap-2.5 mt-3" style={{ borderColor: 'var(--warn)' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--warn)' }} />
              <p className="text-[13px] m-0">
                No se pudo leer: {ciegas.join(' · ')}. Las alertas de esa parte pueden faltar —
                es un fallo de lectura, no un &quot;todo en orden&quot;.
              </p>
            </div>
          )}

          {alertas.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {alertas.map((a) => a.href ? (
                <Link key={a.texto} href={a.href}
                  className="card p-3 flex items-center gap-2.5 hover:opacity-85 transition-opacity"
                  style={{ borderColor: 'var(--warn)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
                  <span className="text-[13px]">{a.texto}</span>
                  <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>Ver →</span>
                </Link>
              ) : (
                <div key={a.texto} className="card p-3 flex items-center gap-2.5" style={{ borderColor: 'var(--warn)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
                  <span className="text-[13px]">{a.texto}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Avance de cierre + la cifra que manda ──────────────────────
              En vez del dinero del dueño, cuántos viajes están vivos ahora
              mismo. Las dos piezas fallan por separado: un `—` con su "no se
              pudo leer" nunca se disfraza de cero. */}
          <div className="card p-4 mt-3 flex flex-wrap items-start gap-x-8 gap-y-3">
            <div className="flex-1 min-w-[260px]">
              {viajesPorDia === null ? (
                <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
                  No se pudo leer el avance de cierre — no significa que no haya viajes.
                </p>
              ) : (
                <AvanceCierre
                  porDia={viajesPorDia}
                  historico={historico && historico[0]
                    ? { viajes: historico[0].totalViajes, liquidados: historico[0].viajesLiquidados }
                    : null}
                />
              )}
            </div>
            <div className="text-right shrink-0 ml-auto">
              <div className="font-display text-4xl tracking-tight tabular font-semibold">
                {tablero?.viajesActivos ?? '—'}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: 'var(--muted)' }}>
                Viajes activos
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                {tablero === null ? 'No se pudo leer' : 'Abiertos y en cuadre'}
              </div>
            </div>
          </div>

          {/* ── Los 6 números de operación (StatCard, caja interna) ──────── */}
          <div className="mt-3">
            {tablero === null ? (
              <div className="card p-6 text-sm" style={{ color: 'var(--muted)' }}>
                No se pudo leer el estado de la operación.
              </div>
            ) : (
              <TableroCifras t={tablero} />
            )}
          </div>

          {/* ── Sin asignar + Carga por operador, como tarjetas blancas ────
              `items-start`: sin él, la tarjeta corta se ESTIRA a la altura de
              la larga y "Sin asignar" vacío queda con media pantalla en
              blanco debajo del mensaje (visto en el render, 14-ago). */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3 items-start">
            <section className="card overflow-hidden">
              <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                <CircleSlash {...ICONO_SECCION} />
                <TituloSeccion>Sin asignar</TituloSeccion>
              </div>
              {sinAsignar === null ? (
                <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la lista.</div>
              ) : sinAsignar.length === 0 ? (
                <div className="px-5 pb-4">
                  <EstadoVacio icono={<Send width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    Todo lo que está en curso ya trae chofer.
                  </EstadoVacio>
                </div>
              ) : (
                <ul className="pb-3">
                  {sinAsignar.map((v) => (
                    <li key={v.id} className="px-5 py-2 border-t flex items-center gap-3 text-sm" style={{ borderColor: 'var(--line2)' }}>
                      <span className="font-medium">{v.folio ?? '—'}</span>
                      <span className="truncate" style={{ color: 'var(--muted)' }}>
                        {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? 'sin ruta')}
                      </span>
                      <span className="ml-auto shrink-0 text-[12px]" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                <UserCog {...ICONO_SECCION} />
                <TituloSeccion>Carga por operador</TituloSeccion>
              </div>
              {carga === null ? (
                <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la carga.</div>
              ) : (
                <TablaCarga carga={carga} />
              )}
            </section>
          </div>

          {/* ── Viajes recientes, SIN pesos (ver TablaViajesOperacion) ───── */}
          <section className="card overflow-hidden mt-3">
            <div className="px-5 pt-4 pb-2 flex items-center gap-2">
              <History {...ICONO_SECCION} />
              <TituloSeccion>Viajes recientes</TituloSeccion>
              {viajes !== null && viajes.length >= 100 && (
                <Link href={`/dashboard/viajes${sufijo}`} className="ml-auto text-[11px] shrink-0 hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>
                  Los 100 más recientes · ver el registro completo →
                </Link>
              )}
            </div>
            {viajes === null ? (
              <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer los viajes.</div>
            ) : (
              <TablaViajesOperacion viajes={filasViajes} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
