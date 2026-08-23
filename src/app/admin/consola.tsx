import Link from 'next/link';
import {
  LayoutGrid, CalendarDays, Truck, DollarSign, Cpu, CheckCircle2, ReceiptText,
  UserRound, Users, MessageCircle, ChevronDown, ExternalLink, ArrowRight,
  LifeBuoy, UserPlus, Handshake, Bot,
} from 'lucide-react';
import {
  getResumenNegocio, getConversacionesActivas, getConteosPlataforma, TOPE_CONVERSACIONES,
  getUltimaCorridaPorAgente, getCorridasRecientes,
} from '@/lib/admin/negocio';
import { getBandejaEscalaciones } from '@/lib/admin/escalaciones';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { usd, numero } from '@/lib/utils';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, fechaHoraMx, hoyMx } from '@/lib/formato';
import { AGENTES_NOTIFICABLES } from '@/lib/likida/agentes/notificaciones';
import { BarraPagina, ChipFecha, HeroSaludo, TituloSeccion } from '../dashboard/resumen-visual';
import { Dona, BarChartSimple } from './charts';
import GraficaCostoConRango from './rango-costo';
import ContadorRetro from './contador-retro';
import { IconoProveedor } from './proveedor-icono';
import { GlobalFilter, resolverRango } from './ui/global-filter';
import { StatCard, StatusPill, EstadoVacio, VerMas, type Estado } from './ui/kit';
import Notificaciones from './notificaciones';
import { calcularAlertas } from './calcular-alertas';
import { AGENTES } from './rutas';

/** `llm_costo.fase` → cómo se llama el agente en pantalla (para la dona). */
const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/**
 * Qué `llm_costo.fase` deja como rastro cada agente de PLATAFORMA del
 * sidebar. Los tres del pipeline NO escriben en `agente_corrida` (el CHECK
 * de la 0102 solo admite los seis agentes de flota): corren por webhook
 * dentro del pipeline, y su señal real de actividad es la fila por llamada
 * al modelo — eso es lo que su tarjeta enseña, no una corrida que esa tabla
 * no puede contener.
 */
const FASE_POR_RUTA: Record<string, string> = {
  '/admin/agente-ocr': 'ocr',
  '/admin/agente-cuadre': 'cuadre',
  '/admin/agente-whatsapp': 'whatsapp',
};

/** Las dos rutas de AGENTES que no son agentes que corran solos — decirlo es
 *  mejor que un "sin corridas" que sugiera que deberían tener. */
const NOTA_CONSOLA: Record<string, string> = {
  '/admin/model-ops': 'Consola de modelos — no corre sola, no registra corridas.',
  '/admin/playground': 'Banco de pruebas — corre cuando tú lo corres.',
};

/** `agente_corrida.estado` (dominio de la 0102) como pill. Un valor fuera
 *  del dominio se pinta crudo en neutro — visible, no roto (mismo criterio
 *  que `PILL_ESTATUS` en resumen-visual). */
const PILL_CORRIDA: Record<string, { estado: Estado; etiqueta: string }> = {
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: 'Parcial' },
  fallo: { estado: 'bad', etiqueta: 'Falló' },
};

/** El «2/2» de la ficha. NULL en cualquiera de los dos = esta corrida no se
 *  mide en tareas, y no se pinta un 0/0 que parezca medición (0102). */
function tareasDe(c: { tareasHechas: number | null; tareasTotal: number | null }): string | null {
  return c.tareasHechas !== null && c.tareasTotal !== null
    ? `${c.tareasHechas}/${c.tareasTotal} tareas`
    : null;
}

const ICONO_BARRA = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--muted)' } } as const;
const ICONO_KPI = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/**
 * Inicio de /admin — la consola de Javier. Misma anatomía que los
 * otros tres inicios (`inicio-contenido`, `inicio-contador`,
 * `inicio-operacion`): barra de página + saludo sobre el lienzo tenue
 * (`--g1`), tarjetas blancas encima.
 *
 * VIVE EN SU PROPIO ARCHIVO, EXPORTADO, y no dentro de `page.tsx`, por las
 * mismas dos razones que `InicioContenido` documenta (y que ya cobraron una
 * vez cada una): Next rechaza exports extra en una Page, y sin export no se
 * puede montar en un preview headless sin sesión — "verificar mirando" es
 * regla del repo. El gateo (`requireSuperadmin`) queda en `page.tsx`, que le
 * pasa el `nombre` ya resuelto: lo que se verifica es la pantalla real.
 *
 * Todas las cifras son reales y cruzan TODOS los tenants (`lib/admin/
 * negocio.ts`, la única función con ese permiso). Sin `safe()` por sección a
 * propósito: si una lectura falla, la página falla entera y Next enseña su
 * error — una consola de negocio a medias que calla lo que no pudo leer es
 * peor que una caída que lo dice.
 */
export async function ConsolaAdmin({
  nombre, sp,
}: { nombre: string | null; sp: { rango?: string } }) {
  // `GlobalFilter` — 'todo' no cabe en una gráfica de barras por día (sería
  // un muro de barras diminutas), así que esa rama enseña el total histórico
  // real (`facturasTotal`) en vez de fingir una ventana que no existe.
  const filtro = resolverRango(sp?.rango, '7');
  const { rango, ventanaDias } = filtro;

  const [r, conversaciones, conteos, porAgente, corridasRecientes, bandeja] = await Promise.all([
    getResumenNegocio(undefined, ventanaDias),
    getConversacionesActivas(),
    getConteosPlataforma(),
    getUltimaCorridaPorAgente(),
    getCorridasRecientes(8),
    // La bandeja NUNCA lanza: cada fuente cae por su lado y los conteos de
    // esa fuente llegan en null ("no se pudo leer" ≠ 0). Por eso puede vivir
    // en una consola que, en sus lecturas core, prefiere caerse entera.
    getBandejaEscalaciones(ahoraMs()),
  ]);

  // FE-9: el total REAL de conversaciones ya venía en los conteos de
  // plataforma (`wa_conversacion` con head-count). `conversaciones` es solo la
  // página de las 20 más recientes — usarla como cifra convertía un tope en
  // una medición, aquí y en la campana.
  const conversacionesTotal = conteos.conversacionesWa;

  // AUDITORÍA 10, ALTO — "Flota (solo el demo)" era texto fijo: con la base
  // en 0 tenants seguía diciendo que había una. "Solo el demo" es una
  // afirmación verificable: se comprueba contra el id real del tenant demo,
  // no se asume que el único tenant que hay siempre es el demo.
  // (`tenants_reales.test.ts` evalúa la expresión de la etiqueta con 0.)
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();

  const fechaHoyMx = fechaMx(hoyMx(new Date(ahoraMs())));
  const porFase = new Map(r.porFase.map((f) => [f.fase, f]));
  // La llave se abre a `string` a propósito: la bitácora ya admite un agente
  // que NO está en el catálogo de notificaciones (`ventas`, 0105 — corre para
  // Likida misma, no para una flota), y un Map tipado al catálogo no dejaría
  // ni preguntar por él.
  const notifPorId = new Map<string, (typeof AGENTES_NOTIFICABLES)[number]>(AGENTES_NOTIFICABLES.map((a) => [a.id, a]));
  /** Rótulo y casa del agente por id de bitácora. `ventas` no vive en el
   *  catálogo de flota: su ficha es la zona de vendedores del propio /admin. */
  const fichaDe = (agente: string, tenantId: string | null): { nombre: string; href: string | null } => {
    if (agente === 'ventas') return { nombre: 'Agente de Ventas', href: '/admin/vendedores' };
    const info = notifPorId.get(agente);
    return {
      // Un id fuera de ambos catálogos se pinta crudo — visible, no roto.
      nombre: info?.nombre ?? agente,
      // La ficha de un agente de flota vive en el panel de ESA flota (sufijo
      // `?tenant=` del superadmin); sin tenant no hay a dónde llevar.
      href: info && tenantId ? `${info.ruta}?tenant=${tenantId}` : null,
    };
  };
  const bitacoraVacia = porAgente.every((a) => a.ultima === null);

  // ── LA MÉTRICA NORTE: % de liquidaciones sin humano — ESTADO ACTUAL ──────
  // Numerador y denominador de lecturas que ya se pagaron: el total es el
  // head-count de `getConteosPlataforma` y las en `revisar` son la MISMA
  // lectura que pinta /admin/escalaciones (bandeja.conteos). Lo que el dato
  // NO puede afirmar: "nunca la tocó un humano" — `guardar_liquidacion_tx`
  // hace upsert y un re-cuadre reescribe el estatus sin dejar rastro de que
  // pasó por la bandeja (ver getLiquidacionesEnRevisar). Por eso el rótulo
  // dice "hoy", y el pie dice de dónde sale el número.
  const liqTotal = conteos.liquidaciones;
  const liqEnRevision = bandeja.conteos.liquidacionesRevisar;
  const liqSinHumano = liqEnRevision === null ? null : liqTotal - liqEnRevision;

  return (
    // El scroll vive en el marco del layout; el lienzo del contenido es
    // TENUE (`--g1`) y las piezas son tarjetas blancas encima — la misma
    // anatomía de los otros tres inicios, en la casa del superadmin.
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<LayoutGrid {...ICONO_BARRA} />}
          titulo="Consola de Likida"
          derecha={
            <div className="flex items-center gap-2">
              {/* La campana vivía en el sidebar; al volverlo gemelo del de
                  /dashboard (14-ago) se mudó aquí, junto al resto de las
                  señales del Resumen — mismo tradeoff que el cliente: las
                  alertas se miran donde se miran las cifras. */}
              <Notificaciones alertas={calcularAlertas(r, conversaciones, bandeja.conteos, conversacionesTotal)} />
              {/* El DÍA DE MÉXICO, no el UTC — mismo arreglo que los otros
                  inicios (a las 6pm de CDMX el chip decía mañana, 12-ago). */}
              <ChipFecha icono={<CalendarDays {...ICONO_BARRA} />}>{fechaHoyMx}</ChipFecha>
            </div>
          }
        />
        <HeroSaludo
          saludo={saludo()} nombre={nombre ?? 'Javier'}
          tagline="Toda Likida en una pantalla — cifras reales, de todas las flotas"
          derecha={
            // MRR real: $0 — Likida no cobra a ningún cliente todavía. No es
            // un placeholder, es el número verdadero de hoy. 7 dígitos = el
            // ancho de "1,000,000", la meta. Lo ÚNICO que sobrevivió del
            // dashboard anterior, por pedido explícito.
            <ContadorRetro valor={0} digitos={7} prefijo="$" etiqueta="MRR — meta $1,000,000" tamaño="lg" />
          }
        />

        {/* El selector de vistas ("entrar a los otros paneles") vivió aquí
            arriba hasta el 17-ago; Javier lo mandó a /admin/dev — el Inicio
            es de operación diaria y ese bloque es herramienta de desarrollo. */}
        <div className="px-5 pb-5 flex-1 space-y-2.5">
          {/* ── KPIs — StatCard (kit compartido), todo dato real ──────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatCard icono={<Truck {...ICONO_KPI} />}
              etiqueta={r.tenants === 0 ? 'Flotas (ninguna dada de alta)' : esSoloDemo ? 'Flota (solo el demo)' : 'Flotas'}
              valor={r.tenants} formato="entero"
            />
            {/* El costo de IA es TOTAL histórico (la cifra con la que se pone
                el precio del producto — ver negocio.ts); la tendencia sí es
                7 días vs los 7 anteriores, y el pie lo dice. Gastar más no
                es buena noticia aunque el número suba. */}
            <StatCard icono={<DollarSign {...ICONO_KPI} />}
              etiqueta="Gastado en IA — histórico" valor={r.costoIaUsd} formato="usd"
              delta={r.tendenciaCosto === null ? null : { pct: r.tendenciaCosto, bueno: r.tendenciaCosto < 0 }}
              deltaNota="últimos 7 días vs los 7 anteriores"
            />
            <StatCard icono={<Cpu {...ICONO_KPI} />}
              etiqueta="Tokens usados — histórico" valor={r.tokensIn + r.tokensOut} formato="numero"
              delta={r.tendenciaTokens === null ? null : { pct: r.tendenciaTokens, bueno: r.tendenciaTokens < 0 }}
              deltaNota="últimos 7 días vs los 7 anteriores"
            />
            <StatCard icono={<CheckCircle2 {...ICONO_KPI} />}
              etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
              nota={`${numero(conteos.liquidaciones)} ${conteos.liquidaciones === 1 ? 'liquidación generada' : 'liquidaciones generadas'}`}
            />
            <StatCard icono={<ReceiptText {...ICONO_KPI} />}
              etiqueta="Facturas procesadas — histórico" valor={r.facturasTotal} formato="entero"
            />
            <StatCard icono={<UserRound {...ICONO_KPI} />}
              etiqueta="Operadores dados de alta" valor={conteos.operadores} formato="entero"
            />
            <StatCard icono={<Users {...ICONO_KPI} />}
              etiqueta="Usuarios con acceso" valor={conteos.usuarios} formato="entero"
            />
            <StatCard icono={<MessageCircle {...ICONO_KPI} />}
              etiqueta="Conversaciones de WhatsApp" valor={conteos.conversacionesWa} formato="entero"
            />
            {/* La métrica norte. SIEMPRE con el absoluto al lado ("X de N") —
                un porcentaje suelto sobre 2 liquidaciones se leería como una
                estadística que no es. Tres ramas honestas: no se pudo leer,
                no hay liquidaciones (no hay % que afirmar), y el % real. */}
            {liqSinHumano === null ? (
              <StatCard icono={<Bot {...ICONO_KPI} />}
                etiqueta="Liquidaciones (total) — el % sin humano no se pudo medir" valor={liqTotal} formato="entero"
                nota="La lectura de la bandeja «revisar» falló: hay total contado, pero no cuántas esperan humano."
              />
            ) : liqTotal === 0 ? (
              <StatCard icono={<Bot {...ICONO_KPI} />}
                etiqueta="Liquidaciones sin humano — aún no hay liquidaciones" valor={0} formato="entero"
                nota="Sin liquidaciones generadas no hay porcentaje que afirmar."
              />
            ) : (
              <StatCard icono={<Bot {...ICONO_KPI} />}
                etiqueta="Liquidaciones sin humano — hoy" valor={(liqSinHumano / liqTotal) * 100} formato="porcentaje"
                nota={`${numero(liqSinHumano)} de ${numero(liqTotal)} fuera de la bandeja «revisar» AHORA — es el estatus actual, no historial (un re-cuadre lo reescribe).`}
              />
            )}
          </div>
          {r.tenants <= 1 && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Cifras reales, no de ejemplo — Likida todavía no tiene clientes, así que son bajas a propósito.
            </p>
          )}
          {/* Los fantasma "Ver →" (ref. shadcn): cada grupo de métricas
              declara a dónde se profundiza. */}
          <div className="flex justify-end gap-2">
            <VerMas href="/admin/analitica">Ver analítica</VerMas>
            <VerMas href="/admin/costos-facturacion">Ver costos de IA</VerMas>
          </div>

          {/* ── Orquestación de agentes ───────────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>Orquestación de agentes</TituloSeccion>

            {/* Los de PLATAFORMA (sidebar → Agentes): su señal real es
                `llm_costo.fase` — una fila por llamada al modelo. Ver
                FASE_POR_RUTA para por qué aquí no se busca una corrida. */}
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {AGENTES.map((it) => {
                const fase = FASE_POR_RUTA[it.href];
                const actividad = fase ? porFase.get(fase) : undefined;
                return (
                  <Link key={it.href} href={it.href}
                    className="hairline rounded-lg px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-[var(--canvas)]"
                    style={{ background: 'var(--surface)' }}>
                    <it.Icono width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium truncate">{it.nombre}</span>
                        <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0" style={{ color: 'var(--muted)' }} />
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {fase
                          ? actividad
                            ? `${numero(actividad.n)} ${actividad.n === 1 ? 'llamada' : 'llamadas'} al modelo · ${usd(actividad.costoUsd)} — histórico`
                            : 'Sin llamadas al modelo registradas.'
                          : NOTA_CONSOLA[it.href] ?? 'Sin corridas registradas.'}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Los agentes de FLOTA + ventas (bitácora `agente_corrida`,
                0102/0105) — la ficha «Estado · Cuándo · Tareas»,
                cruzada por todas las flotas. El catálogo de nombres es el
                mismo de notificaciones.ts, no una copia. */}
            <div className="mt-4">
              <TituloSeccion>Agentes de las flotas — última corrida</TituloSeccion>
              {bitacoraVacia && (
                <div className="mt-2">
                  <EstadoVacio icono={<Bot width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    La bitácora no tiene ni una corrida registrada — estos agentes trabajan sobre las
                    flotas, y sin flotas operando no tienen sobre qué correr.
                  </EstadoVacio>
                </div>
              )}
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {porAgente.map(({ agente, ultima }) => {
                  const ficha = fichaDe(agente, ultima?.tenantId ?? null);
                  const pill = ultima
                    ? PILL_CORRIDA[ultima.estado] ?? { estado: 'neutral' as Estado, etiqueta: ultima.estado }
                    : null;
                  const tareas = ultima ? tareasDe(ultima) : null;
                  return (
                    <div key={agente} className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium truncate">{ficha.nombre}</span>
                        {pill && <span className="ml-auto shrink-0"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></span>}
                      </div>
                      {ultima ? (
                        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          {fechaHoraMx(ultima.inicio)} · {ultima.disparo}{tareas ? ` · ${tareas}` : ''} · {ultima.tenantNombre}
                          {ficha.href && (
                            <>{' — '}<Link href={ficha.href} className="underline font-medium">ver ficha</Link></>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs mt-1" style={{ color: 'var(--faint)' }}>Sin corridas registradas.</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {corridasRecientes.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: 'var(--muted)' }} className="text-left">
                        <th className="px-2 py-1.5 font-medium">Corrida</th>
                        <th className="px-2 py-1.5 font-medium">Estado</th>
                        <th className="px-2 py-1.5 font-medium">Cuándo</th>
                        <th className="px-2 py-1.5 font-medium">Tareas</th>
                        <th className="px-2 py-1.5 font-medium">Flota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corridasRecientes.map((c, i) => {
                        const pill = PILL_CORRIDA[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado };
                        return (
                          <tr key={`${c.inicio}-${i}`} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                            <td className="px-2 py-1.5 font-medium">{fichaDe(c.agente, null).nombre}</td>
                            <td className="px-2 py-1.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                            <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.inicio)}</td>
                            <td className="px-2 py-1.5 tabular" style={{ color: 'var(--muted)' }}>{tareasDe(c) ?? '—'}</td>
                            <td className="px-2 py-1.5" style={{ color: 'var(--muted)' }}>{c.tenantNombre}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Servicio al cliente: las tres puertas desde donde se atiende
                gente — con el conteo real donde hay uno que afirmar. */}
            <div className="mt-4">
              <TituloSeccion>Servicio al cliente</TituloSeccion>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                <Link href="/admin/conversaciones"
                  className="hairline rounded-lg px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-[var(--canvas)]"
                  style={{ background: 'var(--surface)' }}>
                  <MessageCircle width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">Conversaciones</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {numero(conteos.conversacionesWa)} en WhatsApp
                    </div>
                  </div>
                  <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0" style={{ color: 'var(--muted)' }} />
                </Link>
                <Link href="/admin/soporte"
                  className="hairline rounded-lg px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-[var(--canvas)]"
                  style={{ background: 'var(--surface)' }}>
                  <LifeBuoy width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">Soporte</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Tickets y atención</div>
                  </div>
                  <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0" style={{ color: 'var(--muted)' }} />
                </Link>
                {/* El chat de IA se quitó de la consola entera (14-ago,
                    segunda pasada del pedido "sin asistente de AI"): ni
                    tarjeta aquí, ni item en el sidebar. */}
              </div>
            </div>
          </div>

          {/* ── Usuarios y equipo + Vendedores ────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            <div className="card p-3">
              <div className="flex items-center justify-between gap-3">
                <TituloSeccion>Usuarios y equipo</TituloSeccion>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link href="/admin/usuarios/nuevo"
                    className="h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85"
                    style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                    <UserPlus width={13} height={13} strokeWidth={2} /> Nuevo usuario
                  </Link>
                  <Link href="/admin/equipo"
                    className="hairline h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors hover:bg-[var(--canvas)]"
                    style={{ background: 'var(--surface)' }}>
                    Equipo <ArrowRight width={12} height={12} strokeWidth={1.75} />
                  </Link>
                </div>
              </div>
              {conteos.usuarios === 0 ? (
                <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>Ni un usuario con acceso registrado.</p>
              ) : (
                // El desglose real de `app_user` por rol — el rol se enseña
                // como llave cruda (`code`) a propósito: es el valor que la
                // base guarda, no un rótulo bonito que pueda divergir.
                <div className="mt-2 space-y-1">
                  {conteos.usuariosPorRol.map(({ rol, n }) => (
                    <div key={rol} className="flex items-center justify-between gap-3 text-sm">
                      <code className="text-xs" style={{ color: 'var(--muted)' }}>{rol}</code>
                      <span className="tabular font-medium">{numero(n)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 text-sm border-t pt-1 mt-1" style={{ borderColor: 'var(--line2)' }}>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>Total</span>
                    <span className="tabular font-semibold">{numero(conteos.usuarios)}</span>
                  </div>
                </div>
              )}
            </div>
            <Link href="/admin/vendedores" className="card p-3 flex items-start gap-3 hover:shadow-md transition-shadow">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                <Handshake width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Vendedores</span>
                  <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0" style={{ color: 'var(--muted)' }} />
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Prospectos y comisiones del equipo de ventas.
                </p>
              </div>
            </Link>
          </div>

          {/* ── Facturas procesadas por día (el filtro global mueve TODO lo
              que este bloque enseña — regla del rótulo verdadero) ─────────── */}
          <div className="card p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <TituloSeccion>
                Facturas procesadas — {rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`}
              </TituloSeccion>
              <GlobalFilter base="/admin" r={filtro} />
            </div>
            {/* Facturas = filas de `gasto` (cada una pasó por OCR/CFDI) —
                el mismo dato real de "Costo por modelo", agrupado por día. */}
            {rango === 'todo' ? (
              <div className="flex flex-col items-center justify-center" style={{ height: 160 }}>
                <div className="text-4xl font-semibold tracking-tight tabular">{numero(r.facturasTotal)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Facturas procesadas — total histórico</div>
              </div>
            ) : r.facturasPorDia.some((d) => d.n > 0) ? (
              <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={160} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Aún sin datos suficientes.
              </div>
            )}
          </div>

          {/* ── Costo de IA: por día y por fase ───────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {r.porDia.length > 1 ? (
              <GraficaCostoConRango porDia={r.porDia} anidado />
            ) : (
              <div className="card p-4 flex items-center text-sm" style={{ color: 'var(--muted)' }}>Sin historial suficiente todavía.</div>
            )}
            {r.porFase.length > 0 ? (
              <div className="card p-4">
                <TituloSeccion>Agentes — costo por fase</TituloSeccion>
                <div className="mt-3">
                  <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
                </div>
              </div>
            ) : (
              <div className="card p-4 flex items-center text-sm" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
            )}
          </div>

          {/* ── Costo por modelo ──────────────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1"><TituloSeccion>Costo por modelo</TituloSeccion></div>
            {r.porModelo.length === 0 ? (
              <div className="px-4 pb-3 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="px-4 py-2.5 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{numero(m.n)} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Flotas ────────────────────────────────────────────────────── */}
          <section id="flotas" className="card overflow-hidden scroll-mt-24">
            <div className="px-4 pt-3 pb-1"><TituloSeccion>Flotas</TituloSeccion></div>
            {r.flotas.length === 0 ? (
              <div className="px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>Sin flotas dadas de alta todavía.</div>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-4 py-2 font-medium">Flota</th>
                      <th className="px-4 py-2 font-medium">Plan</th>
                      <th className="px-4 py-2 font-medium text-right">Viajes</th>
                      <th className="px-4 py-2 font-medium text-right">Costo de IA</th>
                      <th className="px-4 py-2 font-medium text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.flotas.map((f) => (
                      <tr key={f.id} className="border-t transition-colors hover:bg-[var(--canvas)]" style={{ borderColor: 'var(--line2)' }}>
                        <td className="px-4 py-2.5 font-medium">{f.nombre}</td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                        <td className="px-4 py-2.5 text-right tabular">{numero(f.viajes)}</td>
                        <td className="px-4 py-2.5 text-right tabular">{usd(f.costoIaUsd)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {/* Los TRES paneles del cliente, con la sesión del
                              superadmin (`?tenant=`). El dueño LLEVA
                              `?rol=flota_admin`: sin él el superadmin no entra
                              al chat de perfil (dashboard/page.tsx solo
                              redirige a onboarding si el rol efectivo es
                              flota_admin). Jefe y contador ya traían `?rol=`. */}
                          <div className="inline-flex items-center gap-1.5">
                            <Link href={`/dashboard?tenant=${f.id}&rol=flota_admin`} target="_blank"
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                              <ExternalLink width={11} height={11} strokeWidth={1.75} /> Panel de dueño
                            </Link>
                            <Link href={`/dashboard?tenant=${f.id}&rol=encargado`} target="_blank"
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                              <ExternalLink width={11} height={11} strokeWidth={1.75} /> Panel de jefe de flota
                            </Link>
                            <Link href={`/dashboard/contador?tenant=${f.id}&rol=contador`} target="_blank"
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                              <ExternalLink width={11} height={11} strokeWidth={1.75} /> Panel de contador
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs px-4 pt-2 pb-3" style={{ color: 'var(--muted)' }}>
              Plan, uso vs. límite y estado de cuenta (activa/en riesgo/morosa) son Fase 1 del roadmap — hoy solo se enseña lo que ya existe.
            </p>
          </section>

          {/* ── Conversaciones de WhatsApp (el detalle expandible) ────────── */}
          <section id="conversaciones" className="card p-3 scroll-mt-24">
            {/* FE-9: la sección listaba 20 y no decía de cuántas. */}
            <TituloSeccion>
              {conversacionesTotal !== null && conversacionesTotal > conversaciones.length
                ? `Conversaciones de WhatsApp — las ${TOPE_CONVERSACIONES} más recientes de ${conversacionesTotal}`
                : 'Conversaciones de WhatsApp'}
            </TituloSeccion>
            {conversaciones.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {conversaciones.map((c) => (
                  <details key={`${c.tenantId ?? "sin-flota"}-${c.telefono}`} className="hairline rounded-lg overflow-hidden group" style={{ background: 'var(--surface)' }}>
                    <summary className="px-3 py-2.5 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[var(--canvas)] transition-colors">
                      <div>
                        <div className="text-sm font-medium">{c.telefono}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{c.tenantNombre}</div>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {c.turns.length > 0 ? `${c.turns.length} mensajes` : 'sin mensajes'}
                        <ChevronDown width={14} height={14} className="transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    {c.turns.length > 0 && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--line2)' }}>
                        {c.turns.slice(-6).map((t, i) => (
                          <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                            <div className="max-w-[80%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap"
                              style={t.role === 'user'
                                ? { background: 'var(--canvas)', border: '1px solid var(--line2)' }
                                : { background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                              {t.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>

          {/* El grid "Todas las páginas" vivió aquí hasta el 17-ago; Javier
              lo mandó borrar del resumen — el sidebar (y ⌘K) ya son ese
              índice, y el Inicio es para operar, no para navegar. */}

          {/* "Salud del sistema" (los 3 links) salió del resumen el 17-ago por
              orden de Javier — viven en el sidebar (Sistema) y en
              Observabilidad; el resumen es de operación. */}
        </div>
      </div>
    </main>
  );
}
