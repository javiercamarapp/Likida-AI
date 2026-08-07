// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN DE NEGOCIO — la consola de superadmin, no el panel de una flota.
//
// Cruza TODOS los tenants a propósito: es la única función del repo con
// permiso de ver toda la base a la vez. `usd()` (formato.ts) ya lo advierte
// en su propio comentario — "nunca para el cliente" — y esta es la primera
// pantalla que de verdad lo pinta: costo de IA en dólares, por fase, de
// Likida completa. Vive fuera de analytics.ts (tenant-scoped en cada línea)
// para que nadie copie un patrón de aquí a una consulta de cliente y filtre
// de menos.
//
// PAGINADO DESDE EL 4-AGO-2026. El comentario anterior decía "hoy son 131
// filas de llm_costo y 1 tenant; el día que crezca de verdad, esto necesita el
// mismo `traerTodo` que ya usa analytics.ts — no antes". Ese día es el mes 1:
// `llm_costo` recibe una fila POR LLAMADA al modelo (OCR de cada foto, cuadre,
// router), así que una sola flota operando en serio lo pasa de mil en semanas.
// Y estas cuatro consultas iban SIN paginar y SIN `limit`, cruzando todos los
// tenants: PostgREST las recortaba a `max_rows` en silencio y la consola de
// superadmin reportaba una fracción del gasto de IA —la cifra con la que se
// decide el precio del producto— sin marca de que estuviera incompleta.
//
// Y AGREGADO EN SQL DESDE EL 5-AGO-2026 (mig. 0062). Paginar arregló el recorte
// silencioso pero no el fondo: `traerTodo` LANZA al agotar sus 100 páginas
// (100,000 filas), y `llm_costo` recibe ~2,000 filas diarias. 100,000 / 2,000 =
// **día 50**. La consola no iba a mentir, iba a dejar de cargar, y la fecha se
// puede calcular con una división. `resumen_costo_ia()` suma en la base y cruza
// la red UNA fila: el tamaño del payload pasa a depender del número de GRUPOS
// (fases, modelos, días, flotas), no del número de llamadas al modelo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { round2 } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LA AGREGACIÓN DE `llm_costo`, EN SQL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que devuelve `resumen_costo_ia()` (mig. 0062): las seis agregaciones de
 * `llm_costo` en un solo `jsonb`, calculadas en UN recorrido de la tabla.
 *
 * Los costos vienen SIN REDONDEAR, en la precisión completa del `numeric(10,6)`
 * sumado en la base. El redondeo a centavos sigue siendo de `round2()`
 * (formato.ts), que es el único sitio del repo donde se redondea dinero;
 * redondear en los dos lados sería redondear dos veces.
 */
interface ResumenCostoIa {
  /** `n` distingue "no hay NI UNA llamada registrada" de "las llamadas costaron
   *  $0" — la misma distinción que exige `ResumenCosto` en costos.ts. */
  totales: { n: number; costoUsd: number; tokensIn: number; tokensOut: number };
  porFase: Array<{ fase: string; n: number; costoUsd: number }>;
  porModelo: Array<{ modelo: string; n: number; costoUsd: number }>;
  porFaseModelo: Array<{ fase: string; modelo: string; n: number; costoUsd: number }>;
  /** DISPERSA: solo los días con actividad, igual que cuando se agrupaba en JS. */
  porDia: Array<{ dia: string; costoUsd: number; tokens: number }>;
  porTenant: Array<{ tenantId: string; costoUsd: number }>;
}

/**
 * Llama a la agregación y **falla cerrado**.
 *
 * Dos comprobaciones, no una. La primera es la de siempre: supabase-js reporta
 * el error POR VALOR, así que sin mirar `.error` una base caída se leería como
 * "$0 de gasto de IA".
 *
 * La segunda es nueva y hace falta justo por haber movido esto a la base: si la
 * función no existe todavía (una rama sin la 0062 aplicada) o devuelve otra
 * forma, `data` llega como algo que no es este objeto y cada `?? 0` de abajo
 * pintaría un cero que nadie midió. Por eso se valida la FORMA antes de leerla:
 * el modo de fallo que importa aquí no es "se cayó", es "bajó sola".
 */
async function traerResumenCostoIa(
  desde: string | null = null,
  hasta: string | null = null,
): Promise<ResumenCostoIa> {
  const { data, error } = await supabaseAdmin()
    .rpc('resumen_costo_ia', { p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(`resumen_costo_ia: ${error.message}`);

  const r = data as Partial<ResumenCostoIa> | null;
  const t = r?.totales;
  if (
    !t || typeof t.n !== 'number' || typeof t.costoUsd !== 'number'
    || typeof t.tokensIn !== 'number' || typeof t.tokensOut !== 'number'
    || !Array.isArray(r?.porFase) || !Array.isArray(r?.porModelo)
    || !Array.isArray(r?.porFaseModelo) || !Array.isArray(r?.porDia)
    || !Array.isArray(r?.porTenant)
  ) {
    throw new Error(
      'resumen_costo_ia: la respuesta no tiene la forma esperada (¿migración 0062 sin aplicar?). '
      + 'No se devuelve un resumen a medias: un cero aquí se lee como "la IA salió gratis".',
    );
  }
  return r as ResumenCostoIa;
}

export interface ResumenNegocio {
  tenants: number;
  flotas: Array<{ id: string; nombre: string; plan: string; viajes: number; costoIaUsd: number; facilidad15?: { dedicacionExclusivaCarga?: boolean; regimenElegible?: boolean } }>;
  viajesProcesados: number;
  costoIaUsd: number;
  tokensIn: number;
  tokensOut: number;
  porFase: Array<{ fase: string; n: number; costoUsd: number }>;
  porModelo: Array<{ modelo: string; n: number; costoUsd: number }>;
  porDia: Array<{ dia: string; costoUsd: number; tokens: number }>;
  /** Facturas (filas de `gasto` — cada una es un comprobante que pasó por
   *  OCR/CFDI) procesadas por día, ventana de `ventanaDias` (default 7) —
   *  siempre TODAS las fechas de la ventana, con `n: 0` en las que no hubo
   *  actividad, para que la gráfica de barras no comprima el periodo a un
   *  solo día real. */
  facturasPorDia: Array<{ dia: string; n: number }>;
  /** Total histórico de facturas (todas las filas de `gasto`, sin filtro
   *  de fecha) — para el contador retro junto al saludo. */
  facturasTotal: number;
  /** % de cambio de los últimos 7 días vs los 7 anteriores — `null` sin
   *  suficiente historia (menos de 14 días con datos) para no inventar una
   *  tendencia de dos puntos. */
  tendenciaCosto: number | null;
  tendenciaTokens: number | null;
}

/**
 * `hoy` es inyectable (default: fecha real) — mismo criterio que
 * `cuadrarViaje({ hoy })` en el motor: una prueba de tendencia no puede
 * depender del reloj del sistema el día que corra.
 *
 * `ventanaDias` (default 7) es lo que mueve el `<GlobalFilter>` de Inicio
 * (7d/30d) — solo afecta `facturasPorDia`; el resto de los números
 * (costoIaUsd, tendencias, etc.) son totales o comparativos de 7 días fijos
 * a propósito, no se re-derivan por ventana todavía.
 *
 * Esa deuda NO la salda la 0062. `resumen_costo_ia()` acepta `p_desde`/`p_hasta`
 * y aquí se le mandan NULL a propósito: acotar el costo de IA a la ventana
 * cambiaría la cifra con la que se pone el precio del producto, y eso es un
 * cambio de producto, no de rendimiento. El día que se decida, es un argumento.
 */
export async function getResumenNegocio(
  hoy: string = new Date().toISOString().slice(0, 10),
  ventanaDias: number = 7,
): Promise<ResumenNegocio> {
  const admin = supabaseAdmin();
  // `traerTodo` cubre los DOS bordes de PostgREST de una vez: el error que llega
  // por valor (una base caída se leía "0 tenants, $0 gastados", indistinguible
  // de que Likida de verdad no tenga nada) y el recorte silencioso a `max_rows`.
  // Y si la lectura no se puede completar, LANZA — la consola de superadmin
  // enseña su estado de error en vez de una cifra de gasto que no se midió.
  //
  // `llm_costo` YA NO SE TRAE: se agrega en la base (mig. 0062). Era la tabla
  // que más rápido crece —una fila por llamada al modelo, ~790 mil al año— y la
  // única de las cuatro que iba a rebasar las 100,000 filas de `traerTodo` en el
  // primer par de meses. `gasto` es la siguiente en la fila (~240 mil al año) y
  // sigue viniendo entera: cuando le toque, el camino ya está trazado.
  const [tenantsData, viajesData, costoIa, gastosData] = await Promise.all([
    traerTodo<{ id: string; nombre: string; plan: string; config: unknown }>(
      (d, h) => admin.from('tenant').select('id, nombre, plan, config', conteo(d)).order('id').range(d, h),
      'getResumenNegocio/tenant',
    ),
    traerTodo<{ tenant_id: string }>(
      (d, h) => admin.from('viaje').select('id, tenant_id', conteo(d)).order('id').range(d, h),
      'getResumenNegocio/viaje',
    ),
    traerResumenCostoIa(),
    traerTodo<{ created_at: string }>(
      (d, h) => admin.from('gasto').select('created_at', conteo(d)).order('id').range(d, h),
      'getResumenNegocio/gasto',
    ),
  ]);
  const costoIaUsd = costoIa.totales.costoUsd;
  const tokensIn = costoIa.totales.tokensIn;
  const tokensOut = costoIa.totales.tokensOut;
  const costoPorTenant = new Map<string, number>(
    costoIa.porTenant.map((t) => [t.tenantId, t.costoUsd]),
  );
  // El orden ya viene de SQL (costo desc, y el día ascendente), así que aquí
  // solo se redondea. Reordenar en JS sobre la cifra YA redondeada es lo que
  // hacía la versión anterior, y con dos fases que redondeen al mismo centavo
  // el desempate quedaba a merced del orden de un `Map`.
  const porFase = costoIa.porFase.map((f) => ({ ...f, costoUsd: round2(f.costoUsd) }));
  const porModelo = costoIa.porModelo.map((m) => ({ ...m, costoUsd: round2(m.costoUsd) }));
  // `dia` es el corte UTC que hace la 0062 (`created_at at time zone 'UTC'`),
  // el mismo que daba el viejo `created_at.slice(0, 10)`: es una gráfica de
  // tendencia, no un dato fiscal, y moverlo a hora de México cambiaría la serie
  // histórica sin que nadie lo pidiera.
  const porDia = costoIa.porDia.map((d) => ({ ...d, costoUsd: round2(d.costoUsd) }));

  // Tendencia real, no de adorno: si la ventana ANTERIOR está vacía (Likida
  // lleva menos de 7 días con actividad), "creció ∞%" no dice nada — se
  // calla en vez de inventar una flecha.
  const cortes = (diasAtras: number) => {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - diasAtras);
    return d.toISOString().slice(0, 10);
  };
  const [inicioActual, inicioAnterior] = [cortes(7), cortes(14)];
  const sumaEnVentana = (desde: string, hasta: string, campo: 'costoUsd' | 'tokens') =>
    porDia.filter((d) => d.dia >= desde && d.dia < hasta).reduce((s, d) => s + d[campo], 0);
  const tendencia = (campo: 'costoUsd' | 'tokens'): number | null => {
    const actual = sumaEnVentana(inicioActual, cortes(0), campo);
    const anterior = sumaEnVentana(inicioAnterior, inicioActual, campo);
    if (anterior === 0) return null;
    return round2(((actual - anterior) / anterior) * 100);
  };

  const viajesPorTenant = new Map<string, number>();
  for (const v of viajesData) {
    viajesPorTenant.set(v.tenant_id, (viajesPorTenant.get(v.tenant_id) ?? 0) + 1);
  }
  // Últimos 7 días, siempre las 7 fechas (0 donde no hubo facturas) — el
  // mismo criterio de `cortes()` de arriba, para que "hoy" sea inyectable
  // en las pruebas en vez de depender del reloj real.
  const facturasPorDiaMap = new Map<string, number>();
  for (const g of gastosData) {
    const dia = g.created_at.slice(0, 10);
    facturasPorDiaMap.set(dia, (facturasPorDiaMap.get(dia) ?? 0) + 1);
  }
  const facturasPorDia = Array.from({ length: ventanaDias }, (_, i) => {
    const dia = cortes(ventanaDias - 1 - i);
    return { dia, n: facturasPorDiaMap.get(dia) ?? 0 };
  });

  const flotas = tenantsData.map((t) => {
    const cfg = (t.config as { facilidadCombustibleEfectivo?: { dedicacionExclusivaCarga?: boolean; regimenElegible?: boolean } } | null) ?? null;
    return {
      ...t,
      viajes: viajesPorTenant.get(t.id) ?? 0,
      costoIaUsd: round2(costoPorTenant.get(t.id) ?? 0),
      // La declaración del 15% (RFA 2.9) viaja al panel para verse y corregirse.
      facilidad15: cfg?.facilidadCombustibleEfectivo,
    };
  });
  return {
    tenants: flotas.length,
    flotas,
    viajesProcesados: viajesData.length,
    costoIaUsd: round2(costoIaUsd),
    tokensIn,
    tokensOut,
    porFase,
    porModelo,
    porDia,
    facturasPorDia,
    facturasTotal: gastosData.length,
    tendenciaCosto: tendencia('costoUsd'),
    tendenciaTokens: tendencia('tokens'),
  };
}

export interface CostoPorFaseModelo { fase: string; modelo: string; n: number; costoUsd: number }

/**
 * `llm_costo` agrupado por fase Y modelo A LA VEZ (no cada uno por separado
 * como en `getResumenNegocio`) — para Model Ops y Agente OCR, que necesitan
 * saber qué modelo corrió DENTRO de una fase específica (p. ej. "¿qué costó
 * OCR, desglosado por modelo?"), algo que `porFase`/`porModelo` no pueden
 * responder solos porque cada uno agrupa por un solo eje. Mismo dato real
 * de siempre, solo agrupado más fino — nada nuevo que instrumentar.
 *
 * Sale del MISMO `resumen_costo_ia()` que `getResumenNegocio` (mig. 0062), como
 * un sexto corte del `grouping sets`. Antes esto volvía a arrastrar `llm_costo`
 * entera por segunda vez en las páginas que piden las dos cosas (Model Ops,
 * Agente OCR): dos recorridos de la tabla que más rápido crece para pintar una
 * sola pantalla. Ahora el corte (fase, modelo) sale del recorrido que ya se
 * estaba pagando; el costo extra es una llave de hash más sobre ~60 grupos.
 */
export async function getCostoPorFaseModelo(): Promise<CostoPorFaseModelo[]> {
  const { porFaseModelo } = await traerResumenCostoIa();
  // Ya viene ordenado por costo desc (y fase, modelo como desempate estable):
  // aquí solo se redondea a centavos.
  return porFaseModelo.map((v) => ({ ...v, costoUsd: round2(v.costoUsd) }));
}

export interface TurnoConversacion { role: 'user' | 'assistant'; content: string }

export interface ConversacionActiva {
  telefono: string;
  tenantNombre: string;
  turns: TurnoConversacion[];
  actualizadaEn: string;
}

/**
 * CORRECCIÓN (2-ago-2026, tras verla mal renderizada): `wa_conversacion.
 * estado` SÍ trae el historial de mensajes — `{ turns: ConvTurn[] }`, la
 * misma forma que `conv.ts` (`loadConversation`/`saveConversation`) lee y
 * escribe, acotada a `MAX_TURNS` recientes. El comentario anterior de esta
 * función decía que Likida "no guarda el texto de la conversación" — estaba
 * mal: sí lo guarda, solo que en una ventana rodante, no para siempre.
 */
export async function getConversacionesActivas(): Promise<ConversacionActiva[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('wa_conversacion')
    .select('telefono, estado, updated_at, tenant:tenant_id(nombre)')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getConversacionesActivas: ${error.message}`);
  return (data ?? []).map((c) => {
    const estado = (c.estado as { turns?: TurnoConversacion[] }) ?? {};
    return {
      telefono: c.telefono as string,
      tenantNombre: ((c.tenant as { nombre?: string } | null)?.nombre) ?? '—',
      turns: Array.isArray(estado.turns) ? estado.turns : [],
      actualizadaEn: c.updated_at as string,
    };
  });
}

export interface MiembroEquipo {
  id: string;
  email: string;
  nombre: string | null;
  rol: string;
  tenantId: string | null;
  tenantNombre: string | null;
  operadorId: string | null;
}

/**
 * Roster real de `app_user` para la página Equipo/RBAC — mismo patrón de
 * error que el resto del archivo (falla por valor, se revisa `.error` a
 * mano). `tenant_id` es nullable (superadmin no pertenece a ninguna flota,
 * 0001_init.sql:21), así que el join a `tenant` viene NULL en esas filas —
 * no un error, un superadmin de verdad no tiene flota.
 */
export async function getEquipo(): Promise<MiembroEquipo[]> {
  const admin = supabaseAdmin();
  // Paginado como el resto del archivo. El orden es `rol, id` y no solo `rol`:
  // el rol se repite muchísimo, y paginar por un campo con empates puede
  // repetir o saltarse filas entre páginas. `id` desempata.
  const data = await traerTodo<Record<string, unknown>>(
    (d, h) => admin
      .from('app_user')
      .select('id, tenant_id, rol, nombre, email, operador_id, tenant:tenant_id(nombre)', conteo(d))
      .order('rol', { ascending: true }).order('id').range(d, h),
    'getEquipo',
  );
  return data.map((u) => ({
    id: u.id as string,
    email: u.email as string,
    nombre: (u.nombre as string | null) ?? null,
    rol: u.rol as string,
    tenantId: (u.tenant_id as string | null) ?? null,
    tenantNombre: ((u.tenant as { nombre?: string } | null)?.nombre) ?? null,
    operadorId: (u.operador_id as string | null) ?? null,
  }));
}
