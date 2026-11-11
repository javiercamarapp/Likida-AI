import Link from 'next/link';
import { Send, UserCog, CircleSlash, Plus, Users, History } from 'lucide-react';
import { ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import {
  getViajes, getOperadoresDetalle, getSerieComparativa,
  type ViajeRow, type OperadorDetalle, type ComparativoPeriodo,
} from '@/lib/likida/analytics';
import {
  getTableroOperacion, getViajesSinAsignar, getCargaOperadores, getIncidencias, getUnidades,
  type TableroOperacion, type ViajesSinAsignar, type CargaOperador, type IncidenciaRow, type UnidadRow,
} from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, avisoVigencias, DIAS_AVISO } from '@/lib/likida/vigencias';
import { EstadoVacio } from './estados';
import { AvisoCompacto, BotonEnlace, MarcoPagina } from '@/app/ui-v2/componentes';
import { TituloSeccion } from './resumen-visual';
import { TableroCifras, TablaCarga, TablaViajesOperacion, type FilaViajeOperacion } from './tablero-operacion';
import AvanceCierre from './avance-cierre';
import type { DiaViajes } from './serie-diaria';
import { getViajesPorDia } from './serie-diaria-servidor';
import { AvisoSinFlota } from './sin-flota';
import { getPrimerosPasos, type PrimerosPasos } from '@/lib/likida/primeros-pasos';
import { PrimeraLiquidacion } from './primera-liquidacion';
import { OperaWhatsApp } from './opera-whatsapp';
import { Bloque, Barra, EsqTabla } from './bloque';
import { getT } from '@/lib/i18n/servidor';
import { TR_OPERACION_ES, saludoTr, type TrOperacion } from '@/lib/i18n/operacion_tr';

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
//
// FE-14 (22-ago-2026): las diez consultas se lanzan juntas y se esperan por
// TARJETA, no en un Promise.all que retenía el HTML hasta la última. Ver la
// nota larga en `bloque.tsx`.
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

const ICONO_SECCION = { width: 14, height: 14, strokeWidth: 1.75, style: { color: 'var(--marca)' } } as const;

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
  const tr = await getT('operacion');
  const { t } = tr;
  const ahora = ahoraMs();
  // El DÍA DE MÉXICO, no el UTC: a las 6pm de CDMX el chip de fecha decía
  // mañana (capturado el 12-ago), y una licencia que vence "hoy" salía
  // vencida. Mismo cálculo que `operadores/page.tsx`.
  const diaMx = hoyMx(new Date(ahora));

  // Lanzadas de una, esperadas por tarjeta. Todas pasan por `safe`: ninguna
  // rechaza, resuelven a `null` y su bloque pinta la leyenda honesta.
  const pTablero = safe<TableroOperacion>(() => getTableroOperacion(tenantId));
  const pSinAsignar = safe<ViajesSinAsignar>(() => getViajesSinAsignar(tenantId));
  const pCarga = safe<CargaOperador[]>(() => getCargaOperadores(tenantId));
  const pIncidencias = safe<IncidenciaRow[]>(() => getIncidencias(tenantId));
  const pViajes = safe<ViajeRow[]>(() => getViajes(tenantId));
  // Las vigencias que anclan (ver `vigencias.ts`): vivían
  // solo en /unidades y /operadores, o sea que avisaban únicamente a quien
  // ya había abierto la página — aquí suben al inicio, que es donde el
  // aviso sirve de algo.
  const pUnidades = safe<UnidadRow[]>(() => getUnidades(tenantId));
  // Solo se usan nombre/activo/licencia — el dinero que este helper trae
  // (anticipos, % comprobado) SE QUEDA EN EL SERVIDOR, igual que en
  // `operadores/page.tsx` (la fuga del 4-ago fue exactamente eso).
  const pOperadores = safe<OperadorDetalle[]>(() => getOperadoresDetalle(tenantId));
  const pPasos = safe(() => getPrimerosPasos(tenantId));
  // FE-5: el "Avance de cierre" contaba en memoria sobre las 100 filas de
  // `viajes` — a 50k viajes/mes eso son ~90 minutos, y los tres botones
  // (7d/30d/Todo) medían exactamente la misma hora y media. Ahora la base
  // cuenta por día y el histórico va por su propia ventana.
  const pViajesPorDia = safe<DiaViajes[]>(() => getViajesPorDia(tenantId, diaMx));
  const pHistorico = safe<ComparativoPeriodo[]>(() => getSerieComparativa(tenantId, 3650, 1, diaMx));

  return (
    // El scroll vive DENTRO del panel (patrón FASE 1.5). El lienzo del
    // contenido es TENUE (`--g1`) y las piezas son tarjetas blancas encima —
    // misma anatomía en toda la app; la barra y el saludo van sobre blanco.
    <MarcoPagina
      titulo={t('ini.titulo')}
      area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
      apoyo={t('ini.op.apoyo', { saludo: saludoTr(tr), nombre: nombre ?? t('ini.op.jefe') })}
      acciones={(
        <>
          {/* Secundario a Operadores — "¿a quién le cargo el siguiente?" es la otra pregunta de la mañana. */}
          <BotonEnlace variante="secondary" tamano="sm" href={`/dashboard/operadores${sufijo}`} icono={<Users width={15} height={15} strokeWidth={1.75} />}>
            {t('ini.op.drivers')}
          </BotonEnlace>
          {/* A DESPACHO (13-ago): ahí vive la forma de crear — junto con asignar, avisar y el alta de operadores. La página
              suelta /viajes/nuevo se retiró: era la misma forma con menos contexto, y dos puertas se desincronizan. */}
          <BotonEnlace variante="primary" tamano="sm" href={`/dashboard/despacho${sufijo}`} icono={<Plus width={15} height={15} strokeWidth={2} />}>
            {t('ini.nuevoviaje')}
          </BotonEnlace>
        </>
      )}
    >
          {/* ANTES QUE NINGUNA CIFRA. Lo de abajo son ceros de una flota que
              no existe, y esa frase tiene que llegar antes que los ceros —
              por eso no depende de ninguna consulta y sale con el primer
              flush del stream. */}
          {!tenantExiste && (
            <div><AvisoSinFlota tenantId={tenantId} /></div>
          )}

          {/* La guía del arranque (auditoría 5) — misma pieza que el Resumen
              del dueño; el encargado también puede llevar a la flota a su
              primera liquidación. Condicional de verdad: sin esqueleto, para
              no reservar un hueco que casi siempre queda vacío. */}
          {tenantExiste && (
            <Bloque mensaje={t('ini.err.arranque')} esqueleto={null}>
              <BloqueArranque pPasos={pPasos} sufijo={sufijo} />
            </Bloque>
          )}

          <Bloque mensaje={t('ini.op.err.alertas')} esqueleto={null}>
            <BloqueAlertas pSinAsignar={pSinAsignar} pIncidencias={pIncidencias} pTablero={pTablero}
              pUnidades={pUnidades} pOperadores={pOperadores} diaMx={diaMx} sufijo={sufijo} />
          </Bloque>

          {/* ── Avance de cierre + la cifra que manda ──────────────────────
              En vez del dinero del dueño, cuántos viajes están vivos ahora
              mismo. Las dos piezas fallan por separado: un `—` con su "no se
              pudo leer" nunca se disfraza de cero. */}
          <div>
            <Bloque mensaje={t('ini.op.err.cierre')} esqueleto={<EsqAvance tr={tr} />}>
              <BloqueAvance pViajesPorDia={pViajesPorDia} pHistorico={pHistorico} pTablero={pTablero} />
            </Bloque>
          </div>

          {/* ── Los 6 números de operación (StatCard, caja interna) ──────── */}
          <div>
            <Bloque mensaje={t('ini.op.err.operacion')} esqueleto={<EsqTablero tr={tr} />}>
              <BloqueTablero pTablero={pTablero} />
            </Bloque>
          </div>

          {/* ── Sin asignar + Carga por operador, como tarjetas blancas ────
              `items-start`: sin él, la tarjeta corta se ESTIRA a la altura de
              la larga y "Sin asignar" vacío queda con media pantalla en
              blanco debajo del mensaje (visto en el render, 14-ago).
              Cada columna es su propio boundary: la carga por operador es
              una agregación pesada y no tiene por qué retener la lista de
              viajes sin chofer, que es la urgencia real de la mañana. */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            <Bloque mensaje={t('ini.op.err.sinchofer')} esqueleto={<EsqTabla filas={4} />}>
              <BloqueSinAsignar pSinAsignar={pSinAsignar} sufijo={sufijo} />
            </Bloque>
            <Bloque mensaje={t('ini.op.err.carga')} esqueleto={<EsqTabla filas={4} />}>
              <BloqueCarga pCarga={pCarga} sufijo={sufijo} />
            </Bloque>
          </div>

          {/* ── Viajes recientes, SIN pesos (ver TablaViajesOperacion) ───── */}
          <div>
            <Bloque mensaje={t('ini.err.recientes')} esqueleto={<EsqTabla filas={8} />}>
              <BloqueViajes pViajes={pViajes} sufijo={sufijo} />
            </Bloque>
          </div>
    </MarcoPagina>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS BLOQUES. Cada uno espera SOLO sus promesas — por eso el de al lado no
// lo espera. Viven en este archivo porque `dinero_por_area.test.ts` lo
// escanea por nombre: una sección mudada afuera se saldría del escaneo.
// ═══════════════════════════════════════════════════════════════════════════

async function BloqueArranque({ pPasos, sufijo }: {
  pPasos: Promise<PrimerosPasos | null>; sufijo: string;
}) {
  const pasos = await pPasos;
  if (!pasos || pasos.completado) return null;
  return (
    <>
      <div><PrimeraLiquidacion datos={pasos} sufijo={sufijo} /></div>
      <div><OperaWhatsApp rol="jefe" sufijo={sufijo} /></div>
    </>
  );
}

async function BloqueAlertas({ pSinAsignar, pIncidencias, pTablero, pUnidades, pOperadores, diaMx, sufijo }: {
  pSinAsignar: Promise<ViajesSinAsignar | null>;
  pIncidencias: Promise<IncidenciaRow[] | null>;
  pTablero: Promise<TableroOperacion | null>;
  pUnidades: Promise<UnidadRow[] | null>;
  pOperadores: Promise<OperadorDetalle[] | null>;
  diaMx: string;
  sufijo: string;
}) {
  const { t: tx } = await getT('resto');
  const { t, tp } = await getT('operacion');
  const [sinAsignar, incidencias, tablero, unidades, operadores] =
    await Promise.all([pSinAsignar, pIncidencias, pTablero, pUnidades, pOperadores]);

  // ── Alertas accionables — SOLO si hay fuego real ─────────────────────────
  // Una banda que siempre dice algo entrena a ignorarla. Cada alerta lleva a
  // LA pantalla donde se resuelve, con el sufijo del superadmin a cuestas —
  // y la que no tiene pantalla va SIN link: las incidencias y los POD hoy no
  // se trabajan en ninguna página (`getIncidencias` no se usa
  // fuera de este inicio; `getPods` se borró en la ronda 16), y un "Ver →" a un 404 es peor que nada.
  const alertas: Array<{ texto: string; href: string | null }> = [];

  if (sinAsignar && sinAsignar.total > 0) {
    alertas.push({
      texto: tp('ini.op.sinchofer', sinAsignar.total),
      href: `/dashboard/despacho${sufijo}`,
    });
  }
  const vencidas = (incidencias ?? []).filter((i) => i.slaVencido);
  if (vencidas.length > 0) {
    alertas.push({
      texto: tp('ini.op.sla', vencidas.length),
      href: null,
    });
  }
  if (tablero && tablero.podPendientes > 0) {
    alertas.push({
      texto: tp('ini.op.pod', tablero.podPendientes),
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
      partes.push(tp('ini.op.licvencida', licVencidas));
    }
    if (licPorVencer > 0) {
      partes.push(tp('ini.op.licporvencer', licPorVencer, { dias: DIAS_AVISO }));
    }
    if (partes.length > 0) {
      alertas.push({ texto: partes.join(' · '), href: `/dashboard/operadores${sufijo}` });
    }
  }

  // Una consulta caída NO es "sin fuego": si una fuente de alertas no se
  // pudo leer, se dice ANTES de la banda — una banda vacía sobre una fuente
  // caída afirmaría "todo en orden" estando ciega.
  const ciegas: string[] = [];
  if (sinAsignar === null) ciegas.push(t('ini.op.ciega.sinasignar'));
  if (incidencias === null) ciegas.push(t('ini.op.ciega.incidencias'));
  if (tablero === null) ciegas.push(t('ini.op.ciega.operacion'));
  if (unidades === null) ciegas.push(t('ini.op.ciega.unidades'));
  if (operadores === null) ciegas.push(t('ini.op.ciega.licencias'));

  if (ciegas.length === 0 && alertas.length === 0) return null;

  return (
    <>
      {ciegas.length > 0 && (
        <AvisoCompacto tono="warn"
          resumen={t('ini.op.nosepudo', { lista: ciegas.join(' · ') })}
          mas={tx('op.las_alertas_de_esa_parte_pueden')} />
      )}

      {alertas.length > 0 && (
        <div className="space-y-1.5">
          {alertas.map((a) => a.href ? (
            <Link key={a.texto} href={a.href}
              className="card p-3 flex items-center gap-2.5 hover:opacity-85 transition-opacity"
              style={{ borderColor: 'var(--warn)' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
              <span className="text-[13px]">{a.texto}</span>
              <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>{t('ini.ver')}</span>
            </Link>
          ) : (
            <div key={a.texto} className="card p-3 flex items-center gap-2.5" style={{ borderColor: 'var(--warn)' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
              <span className="text-[13px]">{a.texto}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** El mismo bulto que la tarjeta de avance: la barra de progreso a la
 *  izquierda y la cifra grande a la derecha. */
function EsqAvance({ tr = TR_OPERACION_ES }: { tr?: TrOperacion }) {
  const { t } = tr;
  return (
    <div className="card p-4 flex flex-wrap items-start gap-x-8 gap-y-3" role="status" aria-label={t('ini.cargando')}>
      <div className="flex-1 min-w-[260px]">
        <Barra alto={13} ancho="40%" />
        <div className="mt-2"><Barra alto={10} /></div>
        <div className="mt-3"><Barra alto={12} ancho="60%" /></div>
      </div>
      <div className="shrink-0 ml-auto w-[110px]">
        <Barra alto={36} />
        <div className="mt-1 ml-auto"><Barra alto={10} ancho="70%" /></div>
      </div>
    </div>
  );
}

async function BloqueAvance({ pViajesPorDia, pHistorico, pTablero }: {
  pViajesPorDia: Promise<DiaViajes[] | null>;
  pHistorico: Promise<ComparativoPeriodo[] | null>;
  pTablero: Promise<TableroOperacion | null>;
}) {
  const { t } = await getT('operacion');
  const [viajesPorDia, historico, tablero] = await Promise.all([pViajesPorDia, pHistorico, pTablero]);
  return (
    <div className="card p-4 flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="flex-1 min-w-[260px]">
        {viajesPorDia === null ? (
          <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
            {t('ini.op.cierre.error')}
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
        <div className="text-[11px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: 'var(--muted)' }}>
          {t('ini.op.activos')}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {tablero === null ? t('ini.op.noleyo') : t('ini.op.abiertos')}
        </div>
      </div>
    </div>
  );
}

/** El mismo bulto que `TableroCifras`: el rótulo, la fila flexible de tres y
 *  la rejilla de seis (2 columnas, 3 desde `md`) — sus mismas clases, para
 *  que el aterrizaje no mueva un pixel. */
function EsqTablero({ tr = TR_OPERACION_ES }: { tr?: TrOperacion }) {
  const { t } = tr;
  return (
    <div role="status" aria-label={t('ini.cargando')}>
      <Barra alto={13} ancho="30%" />
      <div className="mt-2 flex flex-wrap gap-2.5 items-stretch">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex-1 min-w-[200px]"><Barra alto={100} className="rounded-xl" /></div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mt-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Barra key={i} alto={100} className="rounded-xl" />
        ))}
      </div>
    </div>
  );
}

async function BloqueTablero({ pTablero }: { pTablero: Promise<TableroOperacion | null> }) {
  const { t } = await getT('operacion');
  const tablero = await pTablero;
  if (tablero === null) {
    return (
      <div className="card p-6 text-sm" style={{ color: 'var(--muted)' }}>
        {t('ini.op.estado.error')}
      </div>
    );
  }
  return <TableroCifras t={tablero} />;
}

async function BloqueSinAsignar({ pSinAsignar, sufijo }: { pSinAsignar: Promise<ViajesSinAsignar | null>; sufijo: string }) {
  const { t: tx } = await getT('resto');
  const { t, idioma } = await getT('operacion');
  const sinAsignar = await pSinAsignar;
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <CircleSlash {...ICONO_SECCION} />
        <TituloSeccion>{t('ini.op.sinasignar')}</TituloSeccion>
      </div>
      {sinAsignar === null ? (
        <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>{t('ini.op.lista.error')}</div>
      ) : sinAsignar.total === 0 ? (
        <div className="px-5 pb-4">
          <EstadoVacio icono={<Send width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            {t('ini.op.todos')}
          </EstadoVacio>
        </div>
      ) : (
        <ul className="pb-3">
          {sinAsignar.filas.map((v) => (
            <li key={v.id} className="px-5 py-2 border-t flex items-center gap-3 text-sm" style={{ borderColor: 'var(--line2)' }}>
              <span className="font-medium">{v.folio ?? '—'}</span>
              <span className="truncate" style={{ color: 'var(--muted)' }}>
                {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? t('ini.op.sinruta'))}
              </span>
              <span className="ml-auto shrink-0 text-[12px]" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio, idioma)}</span>
            </li>
          ))}
          {sinAsignar.total > sinAsignar.filas.length && (
            <li className="px-5 py-2 border-t text-[12px]" style={{ borderColor: 'var(--line2)', color: 'var(--muted)' }}>{tx('op.se_muestran_hay_mas_sin_chofer', { length: sinAsignar.filas.length, v: sinAsignar.total - sinAsignar.filas.length })}{' '}<Link href={`/dashboard/despacho${sufijo}`} className="underline">{t('ini.op.endespacho')}</Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

async function BloqueCarga({ pCarga, sufijo }: { pCarga: Promise<CargaOperador[] | null>; sufijo: string }) {
  const { t } = await getT('operacion');
  const carga = await pCarga;
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <UserCog {...ICONO_SECCION} />
        <TituloSeccion>{t('ini.op.cargaop')}</TituloSeccion>
      </div>
      {carga === null ? (
        <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>{t('ini.op.carga.error')}</div>
      ) : (
        <TablaCarga carga={carga} sufijo={sufijo} />
      )}
    </section>
  );
}

async function BloqueViajes({ pViajes, sufijo }: {
  pViajes: Promise<ViajeRow[] | null>; sufijo: string;
}) {
  const { t } = await getT('operacion');
  const viajes = await pViajes;
  // Las 100 filas MÁS RECIENTES (tope de `getViajes`), SIN el anticipo: el
  // tipo de la tabla no tiene campo donde ponerlo — ver `FilaViajeOperacion`.
  // "recientes" es literal y el encabezado lo dice: no son todas, y el
  // registro completo vive en /dashboard/viajes.
  const filasViajes: FilaViajeOperacion[] = (viajes ?? []).map((v) => ({
    id: v.id, folio: v.folio, origen: v.origen, destino: v.destino,
    estatus: v.estatus, operadorNombre: v.operadorNombre, fechaInicio: v.fechaInicio,
  }));
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <History {...ICONO_SECCION} />
        <TituloSeccion>{t('ini.op.recientes')}</TituloSeccion>
        {viajes !== null && viajes.length >= 100 && (
          <Link href={`/dashboard/viajes${sufijo}`} className="ml-auto text-[11px] shrink-0 hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>
            {t('ini.op.recientes.link')}
          </Link>
        )}
      </div>
      {viajes === null ? (
        <div className="px-5 pb-4 text-sm" style={{ color: 'var(--muted)' }}>{t('ini.op.recientes.error')}</div>
      ) : (
        <TablaViajesOperacion viajes={filasViajes} />
      )}
    </section>
  );
}
