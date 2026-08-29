// ═══════════════════════════════════════════════════════════════════════════
// INGENIERÍA (0234) — los ocho que quedaban en 'disenado' del departamento que
// cuida la máquina por dentro:
//
//   · migraciones          — el contrato de la base contra lo aplicado.
//   · seguridad            — los advisors, en SQL y con evidencia citable.
//   · rendimiento          — peso, crecimiento y patrón de acceso reales.
//   · pruebas              — los RESULTADOS que llegan a la base + el encargo local.
//   · auditor_codigo       — el artefacto DESPLEGADO contra la base.
//   · releases             — qué SHA corre, desde cuándo, y qué se movió después.
//   · producto             — señal real → backlog priorizado. Propone, no decide.
//   · datos_instrumentacion— qué pregunta del negocio NO tiene dato hoy.
//
// ── LA REGLA QUE GOBIERNA EL ARCHIVO ENTERO ───────────────────────────────
//
// ESTE CÓDIGO CORRE EN UNA FUNCIÓN SERVERLESS DE VERCEL. No hay repo, no hay
// `git`, no hay `tsc`, no hay `vitest`, no hay linter y no se puede abrir un
// solo archivo .sql. Un agente de ingeniería que desde aquí escribiera «revisé
// el código» estaría mintiendo — y esa es exactamente la falla que este
// producto no perdona.
//
// Así que los ocho miden SOLO lo que de verdad se ve desde el servidor:
//
//   · el catálogo de PostgreSQL, por las cuatro funciones de la 0234
//     (`migraciones_aplicadas`, `postura_seguridad`, `perfil_almacenamiento`,
//     `contrato_de_esquema`) — RLS, grants, SECURITY DEFINER, constraints,
//     tamaños, seq_scan, consultas lentas y qué migración se aplicó CUÁNDO;
//   · la conducta real de la compañía agente (`agente_corrida`,
//     `cola_aprobacion`, `cron_latido`, `agente_definicion`, `sitio_evento`);
//   · el SHA que Vercel expone en la propia función, contra el reloj de las
//     migraciones.
//
// Y DECLARAN, en el cuerpo de su parte, lo que NO alcanzan: la auditoría de
// código y la suite viven en la RUTINA LOCAL de la Mac de Javier
// (`auditoria-diaria`, `scripts/mejora-diaria/auditor.mjs` a las 05:30,
// `npx tsc --noEmit`, `npx vitest run`, la batería SQL). El parte de `pruebas`
// y el de `auditor_codigo` dicen QUÉ correr allá y SOBRE QUÉ SHA. Ninguno de
// los ocho finge una corrida que no hizo.
//
// ── LAS OTRAS CINCO REGLAS ────────────────────────────────────────────────
//
//  1. CERO LLM. Los ocho son deterministas: las reglas calculan Y redactan con
//     plantilla fija. Un agente que audita seguridad no puede permitirse
//     alucinar el hallazgo que acusa; el modo más barato de no inventarlo es
//     no tener quién lo invente. El techo se declara igual (candado 3 del
//     runner) y el día que alguno redacte con modelo el freno ya está puesto.
//  2. NULL ≠ 0. Un `seq_scan` nulo es «el colector no tiene fila», no «cero
//     escaneos». Un `costo_usd` nulo es «no se midió», no «$0». Una fuente que
//     contestó `disponible: false` es «no se pudo mirar», JAMÁS «no hay nada».
//  3. FAIL-CLOSED Y DICHO. Cada lectura va POR VALOR (`Lectura<T>`): una
//     fuente ciega se escribe «no se pudo leer» con su nombre y el parte sigue
//     con lo que sí tiene. Lo que no se pudo mirar no se afirma.
//  4. EL HUMANO DECIDE. Ninguno de los ocho aplica una migración, cambia un
//     grant, crea un índice, cierra una incidencia ni prioriza un backlog.
//     Miden, citan la evidencia y dejan la pieza en la bandeja.
//  5. IDEMPOTENCIA POR CONSTRAINT. Un parte por (agente, periodo): el título es
//     determinista y el árbitro es el índice único parcial
//     `cola_parte_ingenieria_por_periodo` (0234), no un `if` (estándar §7).
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { hoyMx, numero, usd, usd4, round2 } from '@/lib/formato';
import { alertarOperador } from '@/lib/observability/alerta';
import { encolarPieza } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { logger } from '@/lib/logger';

export const AGENTES_INGENIERIA = [
  'migraciones', 'seguridad', 'rendimiento', 'pruebas',
  'auditor_codigo', 'releases', 'producto', 'datos_instrumentacion',
] as const;
export type AgenteIngenieria = (typeof AGENTES_INGENIERIA)[number];

export function esAgenteIngenieria(id: string): id is AgenteIngenieria {
  return (AGENTES_INGENIERIA as readonly string[]).includes(id);
}

/** Lo que una corrida de ingeniería le reporta al runner. Misma forma que la
 *  de éxito (0218) y crecimiento (0230): `resultado` distingue «no tocaba» de
 *  «corrió y no fabricó», que en un cron cada 4 horas no es lo mismo. */
export interface ResultadoIngenieria {
  resultado: 'corrio' | 'saltado';
  /** Piezas que ENTRARON a la bandeja en esta corrida (0 o 1). */
  piezas: number;
  /** Por qué no se fabricó, cuando piezas = 0 y no es un fallo. */
  motivo?: string;
  /** Gasto de modelo MEDIDO. $0 en los ocho: ninguno llama a un modelo. */
  costoUsd: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTRATO DE ESQUEMA QUE ESTE BUNDLE EXIGE.
//
// POR QUÉ NO ES EL LISTADO COMPLETO DE `supabase/migrations`: el bundle de
// Vercel no incluye ese directorio, así que la lista tendría que vivir aquí
// como espejo generado — y un espejo exacto del directorio convierte cada PR
// que agrega una migración en un PR que además tiene que tocar este archivo.
// Con seis ramas en paralelo agregando migraciones el mismo día, eso no rompe
// el PR de nadie: rompe MASTER después del merge, que es peor.
//
// Lo que sí es honesto y estable: la lista CURADA de migraciones cuyos objetos
// este código lee de verdad. Si lo que una de estas crea no está en la base,
// el bundle desplegado está hablándole a un esquema que no existe — y eso sí
// es un hallazgo, no un detalle de bookkeeping. `ingenieria.test.ts` verifica
// que cada `nombre` de esta lista exista como archivo en `supabase/migrations`
// (esa dirección nunca se rompe sola: agregar migraciones en otra rama no la
// invalida).
//
// ── EL INCIDENTE DE LOS 5 CORREOS (noche del 28-ago-2026) ─────────────────
//
// La primera versión de este contrato era una lista de NOMBRES y el detector
// comparaba rótulo contra rótulo (`nombres.has(m)`). Esa misma noche,
// `releases` y `migraciones` mandaron dos correos «Urgente» acusando que
// 0102/0116/0117/0123/0155 «no constan aplicadas» — y las tablas de las cinco
// EXISTÍAN todas en producción, con 60 agentes vivos leyéndolas. La causa: el
// registro de la base no guarda los nombres canónicos. La 0155 se aplicó
// PARTIDA en cuatro piezas (`0155_purgas_parte1`, `0155_purgas_parte2`,
// `0155_resumen_costo_ia_latido_bucket`, `0155_purgas_permisos`), la 0150 en
// tres, y las cuatro primeras entraron SIN prefijo (`agente_corrida`,
// `agente_definicion`, `cola_aprobacion`, `runner_y_campanas`). Todo medido
// contra `supabase_migrations.schema_migrations` de producción.
//
// La lección quedó escrita como estructura: el registro es un RÓTULO y el
// esquema es el HECHO. Cada exigida declara ahora las TABLAS que crea y que
// este bundle lee, y ningún detector afirma «falta la migración X» sin haber
// comprobado que lo que X crea NO está en el catálogo. Una migración aplicada
// en piezas, o registrada con otro nombre, sigue estando aplicada.
// ═══════════════════════════════════════════════════════════════════════════

export interface MigracionExigida {
  /** El basename canónico del archivo en `supabase/migrations`. */
  nombre: string;
  /** El prefijo numérico del archivo: cualquier registro `0155_*` cuenta como
   *  la 0155 aunque venga partida en piezas con nombres distintos. */
  prefijo: number;
  /** Las tablas que esa migración crea Y que este bundle lee. Son el HECHO
   *  contra el que se verifica antes de acusar: si están en el catálogo, la
   *  migración está aplicada, diga lo que diga el rótulo del registro. */
  tablas: readonly string[];
}

export const MIGRACIONES_EXIGIDAS: readonly MigracionExigida[] = [
  { nombre: '0102_agente_corrida', prefijo: 102, tablas: ['agente_corrida'] },        // la bitácora que casi todos leen.
  { nombre: '0110_interruptores', prefijo: 110, tablas: ['interruptor'] },            // el kill switch + su CHECK de dominio.
  { nombre: '0116_agente_definicion', prefijo: 116, tablas: ['agente_definicion'] },  // el catálogo de agentes.
  { nombre: '0117_cola_aprobacion', prefijo: 117, tablas: ['cola_aprobacion'] },      // la bandeja: salida única de los ocho.
  { nombre: '0123_runner_y_campanas', prefijo: 123, tablas: ['campana'] },            // runner_habilitado + presupuesto por agente.
  { nombre: '0155_purgas_y_bucket_comprobantes', prefijo: 155, tablas: ['cron_latido'] }, // cron_latido, que `pruebas` lee.
  { nombre: '0223_plataforma_marketing', prefijo: 223, tablas: ['sitio_evento'] },    // sitio_evento, que datos_instrumentacion lee.
  { nombre: '0234_agentes_ingenieria', prefijo: 234, tablas: ['despliegue_visto'] },  // esta ola: despliegue_visto + las 4 funciones.
  { nombre: '0251_producto_evento', prefijo: 251, tablas: ['producto_evento'] },      // producto_evento, que datos_instrumentacion lee (Q3/Q4).
];

/** Los agentes que el RUNNER DE ESTE BUNDLE sabe despachar. Es un espejo de
 *  las ramas de `runner.ts` y por eso vive allá, no aquí: el `auditor_codigo`
 *  lo lee por import dinámico para comparar el artefacto desplegado contra lo
 *  que la base declara vivo. Se declara el tipo aquí para no importar el
 *  runner de forma estática (ciclo: el runner importa este módulo). */
export interface ModuloRunner { AGENTES_DESPACHABLES: readonly string[] }

// ── Aritmética de fechas ───────────────────────────────────────────────────
//
// Se redefine aquí en vez de importarse de `crecimiento.ts`/`backoffice.ts`
// por lo mismo que aquellos la redefinieron: esos módulos arrastran la
// calculadora, el índice de normas y los lectores legales, y el runner los
// carga por import dinámico justo para no pagarlos. Cuatro líneas de
// aritmética no justifican arrastrar el árbol entero.

/** El lunes de la semana de `dia` ('YYYY-MM-DD'). Anclado a mediodía UTC: el
 *  propio cálculo del día de la semana no puede cruzar de fecha. */
export function lunesDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** `dia` desplazado `n` días (n negativo = hacia atrás). */
export function masDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** El instante ISO del inicio del día de México de `dia` (offset fijo −06:00,
 *  el mismo criterio del resto del repo: México ya no cambia de horario). */
function inicioDia(dia: string): string {
  return new Date(`${dia}T00:00:00-06:00`).toISOString();
}

// ── El semáforo compartido ─────────────────────────────────────────────────

export type Semaforo = 'ROJO' | 'AMBAR' | 'NOTA';

export interface Hallazgo {
  semaforo: Semaforo;
  /** Código estable para que dos partes se puedan comparar entre semanas. */
  codigo: string;
  /** El objeto exacto (tabla, función, agente, migración) al que apunta. */
  objeto: string;
  detalle: string;
  /** La cita que lo sostiene. Un hallazgo sin evidencia es una opinión. */
  evidencia: string;
}

/** Pinta la lista de hallazgos con su encabezado de conteo. Compartida por
 *  los ocho para que los partes se lean igual y se comparen sin traducir. */
export function pintarHallazgos(hallazgos: Hallazgo[], sinNadaDice: string): string[] {
  const rojos = hallazgos.filter((h) => h.semaforo === 'ROJO');
  const ambar = hallazgos.filter((h) => h.semaforo === 'AMBAR');
  const lineas = [
    `Hallazgos: ${numero(rojos.length)} ROJO · ${numero(ambar.length)} ÁMBAR · ${numero(hallazgos.length - rojos.length - ambar.length)} nota(s).`,
    '',
  ];
  if (hallazgos.length === 0) {
    lineas.push(sinNadaDice);
    return lineas;
  }
  const orden: Record<Semaforo, number> = { ROJO: 0, AMBAR: 1, NOTA: 2 };
  for (const h of [...hallazgos].sort((a, b) => orden[a.semaforo] - orden[b.semaforo])) {
    lineas.push(`[${h.semaforo}]  ${h.codigo} · ${h.objeto} — ${h.detalle}`);
    lineas.push(`         evidencia: ${h.evidencia}`);
  }
  return lineas;
}

/** Recorta texto libre a una línea legible. */
export function recortar(t: string | null | undefined, n: number): string {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Lista de ejemplos acotada: «a · b · c y 7 más». Nunca esconde el total. */
export function muestra(xs: readonly string[], tope = 6): string {
  if (xs.length === 0) return '—';
  const cabeza = xs.slice(0, tope).join(' · ');
  return xs.length > tope ? `${cabeza} y ${numero(xs.length - tope)} más` : cabeza;
}

// ── Lecturas POR VALOR: una fuente ciega se dice, no se colapsa a vacío ────

export interface Lectura<T> { valor: T | null; error: string | null }

export async function porValor<T>(nombre: string, fn: () => Promise<T>): Promise<Lectura<T>> {
  try {
    return { valor: await fn(), error: null };
  } catch (e) {
    logger.warn('ingenieria.fuente_ciega', { fuente: nombre, err: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    return { valor: null, error: nombre };
  }
}

/** La línea que el parte escribe por cada fuente que no contestó. Se escribe
 *  ARRIBA de los hallazgos a propósito: quien lee tiene que saber qué NO se
 *  miró antes de creerle a lo que sí. */
export function lineaFuentesCiegas(lecturas: Array<Lectura<unknown>>): string | null {
  const ciegas = lecturas.map((l) => l.error).filter((e): e is string => e !== null);
  if (ciegas.length === 0) return null;
  return `FUENTES QUE NO CONTESTARON (${numero(ciegas.length)}): ${ciegas.join(' · ')}. Todo lo de abajo se afirma SOLO sobre lo que sí se pudo leer; un hallazgo que viva en estas fuentes no aparece aquí.`;
}

// ── Las cuatro funciones de la 0234, tipadas ───────────────────────────────

export interface MigracionAplicada { version: string; nombre: string }
export interface RespuestaMigraciones { disponible: boolean; motivo: string | null; filas: MigracionAplicada[] }

export interface TablaPostura {
  tabla: string; rls: boolean; politicas: number; tiene_tenant_id: boolean;
  anon_lee: boolean; auth_lee: boolean; anon_escribe: boolean; auth_escribe: boolean;
}
export interface FuncionPostura {
  funcion: string; definer: boolean; anon_ejecuta: boolean; auth_ejecuta: boolean;
  search_path_fijo: boolean; ayudante_rls: boolean;
}
export interface VistaPostura { vista: string; security_invoker: boolean }
export interface ColumnaSensible { tabla: string; columna: string; tipo: string }
export interface Postura {
  tablas: TablaPostura[]; funciones: FuncionPostura[];
  vistas: VistaPostura[]; columnas_sensibles: ColumnaSensible[];
}

export interface TablaPerfil {
  tabla: string; bytes: number;
  /** `reltuples` tal cual: −1 = nunca analizada. NO se convierte a 0. */
  filas_estimadas: number;
  /** `null` = el colector no tiene fila para esta tabla. NO es 0. */
  seq_scan: number | null; seq_tup_read: number | null; idx_scan: number | null;
  indices: number;
}
export interface ConsultaLenta { consulta: string; llamadas: number; ms_total: number; ms_media: number; filas: number }
export interface Perfil {
  tablas: TablaPerfil[];
  consultas: { disponible: boolean; motivo: string | null; filas: ConsultaLenta[] };
}

export interface FkSimple { origen: string; destino: string; constraint_: string }
export interface ContratoEsquema {
  interruptor_check: string | null;
  tenant_sin_rls: string[];
  fks_simples_entre_tenantizadas: FkSimple[];
  indices_unicos_parciales_cola: string[];
}

/** Llama una función de la 0234. LANZA con el error de Supabase POR VALOR
 *  convertido a mensaje: `porValor` lo convierte en «fuente ciega». */
async function rpc<T>(nombre: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await acotada(supabaseAdmin().rpc(nombre, args), `ingenieria.${nombre}`);
  if (error) throw new Error(`${nombre}: ${error.message}`);
  if (data === null || data === undefined) throw new Error(`${nombre}: la función no devolvió nada — no se afirma un vacío que nadie midió.`);
  return data as T;
}

export const leerMigracionesAplicadas = () => rpc<RespuestaMigraciones>('migraciones_aplicadas');
export const leerPostura = () => rpc<Postura>('postura_seguridad');
export const leerPerfil = (top = 20) => rpc<Perfil>('perfil_almacenamiento', { p_top: top });
export const leerContrato = () => rpc<ContratoEsquema>('contrato_de_esquema');

/** Los NOMBRES de todas las tablas de public, vía `postura_seguridad()`. Es la
 *  lectura del HECHO que el incidente de los 5 correos (28-ago-2026) exigió:
 *  antes de acusar «falta la migración X», `migraciones` y `releases` comprueban
 *  aquí que lo que X crea de verdad no esté. LANZA si el catálogo no contesta —
 *  y entonces el detector NO acusa: fail-closed y dicho. */
export async function leerTablasCatalogo(): Promise<string[]> {
  const p = await leerPostura();
  return p.tablas.map((t) => t.tabla);
}

// ── El catálogo vivo, que casi todos los ocho necesitan ────────────────────

export interface FichaAgente {
  id: string; nombre: string; departamento: string; estado: string;
  runnerHabilitado: boolean; disparador: string; presupuestoDiaUsd: number | null;
}

/** El catálogo completo. LANZA si no se puede leer. */
export async function leerCatalogo(): Promise<FichaAgente[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_definicion')
    .select('id, nombre, departamento, estado, runner_habilitado, disparador, presupuesto_dia_usd')
    .order('id')
    .limit(500), 'ingenieria.catalogo');
  if (error) throw new Error(`leerCatalogo: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    departamento: String(f.departamento),
    estado: String(f.estado),
    runnerHabilitado: f.runner_habilitado === true,
    disparador: String(f.disparador),
    presupuestoDiaUsd: f.presupuesto_dia_usd === null || f.presupuesto_dia_usd === undefined
      ? null : Number(f.presupuesto_dia_usd),
  }));
}

/** Los que el runner despacharía en su próxima vuelta (candados 2 y 3). */
export function autonomos(fichas: FichaAgente[]): FichaAgente[] {
  return fichas.filter((f) => f.estado === 'vivo' && f.runnerHabilitado && f.disparador === 'cron');
}

// ── La pieza hacia la bandeja, con su idempotencia por constraint ──────────

/** ¿Ya existe el parte de este periodo (cualquier estado)? LANZA si no se
 *  puede saber: sin poder verificar, no se fabrica (fail closed). */
export async function parteExistente(agente: AgenteIngenieria, titulo: string): Promise<boolean> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('cola_aprobacion')
    .select('id', { count: 'exact', head: true })
    .eq('agente', agente)
    .eq('titulo', titulo), 'ingenieria.parte_existente');
  if (error) throw new Error(`parteExistente(${agente}): ${error.message}`);
  if (typeof count !== 'number') throw new Error(`parteExistente(${agente}): PostgREST no devolvió el conteo — no se afirma un 0 que nadie midió.`);
  return count > 0;
}

/** Encola el parte. El índice único parcial de la 0234 es el árbitro real: si
 *  otra corrida ganó la carrera del mismo periodo, el duplicado rebota y se
 *  trata como «ya existía», no como fallo. */
export async function encolarParte(
  agente: AgenteIngenieria, tipo: string, titulo: string, cuerpo: string,
  fuentes: Record<string, unknown>,
): Promise<'encolada' | 'ya_existia'> {
  try {
    await encolarPieza({ tipo, prioridad: 'normal', agente, titulo, cuerpo, fuentes });
    return 'encolada';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate key') || msg.includes('cola_parte_ingenieria_por_periodo')) return 'ya_existia';
    throw e;
  }
}

/** Registra la corrida — `registrarCorrida` jamás lanza (contrato 0102). */
export async function anotar(
  agente: AgenteIngenieria, inicio: Date, estado: 'ok' | 'fallo', disparo: DisparoCorrida,
  resumen: Record<string, unknown>, extra?: { tareasHechas: number; tareasTotal: number; error?: string },
): Promise<void> {
  await registrarCorrida(null, agente, {
    inicio, fin: new Date(), estado, disparo,
    // MEDIDO, no supuesto: estos ocho no llaman a ningún modelo, así que su
    // gasto de IA es CERO y se anota como cero. NULL significaría «no se
    // midió», que sería falso.
    costoUsd: 0,
    ...(extra?.tareasHechas !== undefined ? { tareasHechas: extra.tareasHechas, tareasTotal: extra.tareasTotal } : {}),
    resumen,
    ...(extra?.error ? { error: extra.error } : {}),
  });
}

/** El ROJO no espera a que alguien abra la bandeja (mismo criterio 0215/0219). */
async function alertarRojos(agente: AgenteIngenieria, hallazgos: Hallazgo[]): Promise<void> {
  const rojos = hallazgos.filter((h) => h.semaforo === 'ROJO');
  if (rojos.length === 0) return;
  await alertarOperador(`ingenieria.${agente}`, {
    error: rojos.map((h) => `${h.codigo}/${h.objeto}: ${h.detalle}`).join(' | ').slice(0, 900),
    codigo: `ingenieria_${agente}_rojo`,
  });
}

/** El cierre común: la frase que declara el alcance real de estos agentes. */
export const PIE_ALCANCE =
  'ALCANCE DE ESTE AGENTE: corre en una función serverless de Vercel. NO tiene el repo, NO corre tsc/vitest/git/linters y NO puede abrir un archivo .sql — todo lo de arriba sale de la BASE y del propio artefacto desplegado. La auditoría de código y la suite viven en la rutina local de la Mac (auditoria-diaria 05:30) y siguen siendo obligatorias.';

/** El censo que un agente deja en `fuentes` para que su parte siguiente tenga
 *  contra qué comparar. Sin censo previo el parte es LÍNEA BASE y lo dice —
 *  jamás inventa un delta (mismo patrón que `documentacion`, 0219). */
async function censoPrevio<T>(agente: AgenteIngenieria, tipo: string, llave: string): Promise<{ censo: T | null; titulo: string | null }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('cola_aprobacion')
    .select('titulo, fuentes')
    .eq('agente', agente)
    .eq('tipo', tipo)
    .order('creado_en', { ascending: false })
    .limit(1), 'ingenieria.censo_previo');
  if (error) throw new Error(`censoPrevio(${agente}): ${error.message}`);
  const fila = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (!fila) return { censo: null, titulo: null };
  const fuentes = (fila.fuentes as Record<string, unknown> | null) ?? {};
  const censo = fuentes[llave];
  if (!censo || typeof censo !== 'object') {
    // Un parte previo cuyo censo no se puede leer NO es «no había censo»: se
    // trata como ausente y se dice en el log; el parte lo declarará como línea
    // base, que es lo honesto.
    logger.warn('ingenieria.censo_ilegible', { agente, titulo: String(fila.titulo ?? '') });
    return { censo: null, titulo: null };
  }
  return { censo: censo as T, titulo: String(fila.titulo ?? '') };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · MIGRACIONES — el contrato de la base contra lo que de verdad se aplicó.
//
// La fuente es `supabase_migrations.schema_migrations` vía la función de la
// 0234: `version` es el sello de tiempo UTC de CUÁNDO se aplicó y `nombre` es
// el basename del archivo ('0230_agentes_crecimiento'). Con esas dos columnas
// se contesta algo que el orden numérico de los archivos NO contesta: el orden
// REAL en que entraron. El 27-ago-2026 la base tenía la 0231 aplicada DESPUÉS
// de la 0232, y la 0218 después de la 0219 — dos migraciones que se escribieron
// para correr en orden y no corrieron en orden.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas de las últimas migraciones se miran para detectar inversiones. Más
 *  atrás el ruido histórico ahoga la señal: lo que importa es la ola en curso. */
export const VENTANA_ORDEN = 40;

/** El prefijo numérico del archivo ('0230_agentes_crecimiento' → 230). `null`
 *  si el nombre no lo trae: no se adivina. */
export function prefijoDe(nombre: string): number | null {
  const m = /^(\d{3,5})_/.exec(nombre);
  return m ? Number(m[1]) : null;
}

/** El instante de aplicación que codifica `version` ('YYYYMMDDHHMMSS', UTC).
 *  `null` si no tiene esa forma — hay bases con versiones que no son sellos de
 *  tiempo, y una fecha adivinada sería peor que ninguna. */
export function aplicadaEn(version: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export interface Inversion { antes: string; despues: string }

/**
 * Las INVERSIONES de orden: pares (a, b) donde `b` tiene prefijo MENOR que `a`
 * y sin embargo se aplicó DESPUÉS. Puro sobre la lista ya leída, que entra
 * ordenada por `version` descendente (lo que devuelve la función).
 */
export function inversionesDeOrden(filas: MigracionAplicada[], ventana = VENTANA_ORDEN): Inversion[] {
  // Ascendente por orden de aplicación, quedándose con la cola reciente.
  const recientes = [...filas].reverse().slice(-ventana)
    .map((f) => ({ nombre: f.nombre, prefijo: prefijoDe(f.nombre) }))
    .filter((f): f is { nombre: string; prefijo: number } => f.prefijo !== null);
  const inversiones: Inversion[] = [];
  // Solo se reporta la inversión con el VECINO inmediato: comparar todos
  // contra todos convierte un solo desorden en decenas de líneas que dicen lo
  // mismo. El vecino basta para señalar dónde está el desorden.
  for (let i = 1; i < recientes.length; i++) {
    if (recientes[i].prefijo < recientes[i - 1].prefijo) {
      inversiones.push({ antes: recientes[i - 1].nombre, despues: recientes[i].nombre });
    }
  }
  return inversiones;
}

/** Nombres aplicados MÁS DE UNA VEZ (dos `version` distintas, mismo archivo):
 *  la migración corrió dos veces, y solo es inocuo si era idempotente. */
export function nombresRepetidos(filas: MigracionAplicada[]): string[] {
  const cuenta = new Map<string, number>();
  for (const f of filas) cuenta.set(f.nombre, (cuenta.get(f.nombre) ?? 0) + 1);
  return [...cuenta.entries()].filter(([, n]) => n > 1).map(([n]) => n).sort();
}

/**
 * Prefijos numéricos usados por DOS archivos distintos SIN ser una migración
 * aplicada en piezas: dos ramas eligieron el mismo número.
 *
 * LA DISTINCIÓN ES LA LECCIÓN DEL 28-ago-2026: la primera versión reportaba
 * TODO prefijo compartido como choque ROJO, y esa noche acusó a la 0150 —que
 * la casa aplicó a propósito en tres piezas (`0150_agregados_analytics_cuerpo`,
 * `..._cuerpo2`, `..._permisos`)— como si fuera una anomalía. Una migración
 * partida en piezas se aplica en UNA tanda: sus registros quedan CONTIGUOS en
 * el orden real de aplicación. Un choque de ramas de verdad queda intercalado
 * con otros números. Aquí solo se reportan los intercalados; las piezas
 * contiguas son la práctica normal de la casa y no son hallazgo.
 */
export function prefijosChocados(filas: MigracionAplicada[]): string[] {
  // Ascendente por orden real de aplicación (el `version` es el sello UTC),
  // solo las filas con prefijo: la posición de cada una decide la contigüidad.
  const asc = [...filas]
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
    .map((f) => ({ nombre: f.nombre, prefijo: prefijoDe(f.nombre) }))
    .filter((f): f is { nombre: string; prefijo: number } => f.prefijo !== null);
  const porPrefijo = new Map<number, { nombres: Set<string>; posiciones: number[] }>();
  asc.forEach((f, i) => {
    const g = porPrefijo.get(f.prefijo) ?? { nombres: new Set<string>(), posiciones: [] };
    g.nombres.add(f.nombre);
    g.posiciones.push(i);
    porPrefijo.set(f.prefijo, g);
  });
  return [...porPrefijo.entries()]
    .filter(([, g]) => g.nombres.size > 1
      // Contiguo = las posiciones ocupan un tramo seguido del orden de
      // aplicación: es la migración partida en piezas, no el choque.
      && g.posiciones[g.posiciones.length - 1] - g.posiciones[0] !== g.posiciones.length - 1)
    .map(([p, g]) => `${String(p).padStart(4, '0')}: ${[...g.nombres].sort().join(' + ')}`)
    .sort();
}

// ── La verificación POR HECHO de las migraciones exigidas ──────────────────
//
// El corazón del arreglo del incidente de los 5 correos: el rótulo del
// registro se consulta primero (barato), pero la ACUSACIÓN solo sale del
// hecho — «la tabla que esa migración crea no está en el catálogo». Un
// hallazgo que no se refuta a sí mismo contra el esquema no sale de aquí.

export interface VeredictoExigida {
  exigida: MigracionExigida;
  /** Cómo da cuenta el REGISTRO de esta migración: por su nombre canónico,
   *  por piezas con su prefijo, o de ninguna forma. */
  registro: 'nombre' | 'prefijo' | 'ausente';
  /** Los nombres registrados que la cubren cuando fue por prefijo. */
  piezas: string[];
  /** El HECHO: sus tablas están, faltan, o el catálogo no se pudo leer. */
  hecho: 'objetos_presentes' | 'objetos_ausentes' | 'sin_catalogo';
  tablasAusentes: string[];
}

/** Cruza el registro (rótulos) con el catálogo (hechos). PURA. `tablasCatalogo`
 *  en `null` significa «no se pudo leer el catálogo», nunca «no hay tablas». */
export function verificarExigidas(
  filas: MigracionAplicada[],
  tablasCatalogo: readonly string[] | null,
): VeredictoExigida[] {
  const nombres = new Set(filas.map((f) => f.nombre));
  const porPrefijo = new Map<number, string[]>();
  for (const f of filas) {
    const p = prefijoDe(f.nombre);
    if (p === null) continue;
    porPrefijo.set(p, [...(porPrefijo.get(p) ?? []), f.nombre]);
  }
  const tablas = tablasCatalogo === null ? null : new Set(tablasCatalogo);
  return MIGRACIONES_EXIGIDAS.map((m) => {
    const piezas = porPrefijo.get(m.prefijo) ?? [];
    const registro = nombres.has(m.nombre) ? 'nombre' as const
      : piezas.length > 0 ? 'prefijo' as const
        : 'ausente' as const;
    const tablasAusentes = tablas === null ? [] : m.tablas.filter((t) => !tablas.has(t));
    const hecho = tablas === null ? 'sin_catalogo' as const
      : tablasAusentes.length > 0 ? 'objetos_ausentes' as const
        : 'objetos_presentes' as const;
    return { exigida: m, registro, piezas: [...piezas].sort(), hecho, tablasAusentes };
  });
}

/**
 * Los hallazgos que salen de esos veredictos. Compartida por `migraciones`
 * (G1) y `releases` (D2) para que los dos acusen con el MISMO criterio:
 *
 *   · ROJO solo cuando el HECHO falta: la tabla que la migración crea no está
 *     en el catálogo. Eso sí va a romper al bundle en la primera corrida.
 *   · rótulo ausente + hecho presente = NOTA de bookkeeping: aplicada bajo
 *     otro nombre (el caso real de `agente_corrida` y compañía). No escala.
 *   · rótulo ausente + catálogo ciego = ÁMBAR: no se pudo verificar el hecho
 *     y NO se acusa sobre el rótulo solo — se verifica en la Mac.
 *   · aplicada en piezas con el hecho presente = silencio: es lo normal.
 */
export function hallazgosDeExigidas(veredictos: VeredictoExigida[], codigo: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  const rotas = veredictos.filter((v) => v.hecho === 'objetos_ausentes');
  if (rotas.length > 0) {
    hallazgos.push({
      semaforo: 'ROJO', codigo, objeto: muestra(rotas.map((v) => v.exigida.nombre)),
      detalle: `${numero(rotas.length)} migración(es) que este despliegue EXIGE no están aplicadas: lo que crean NO está en el catálogo.`,
      evidencia: rotas.map((v) => `${v.exigida.nombre}: falta ${v.tablasAusentes.join(' + ')} en public (registro: ${v.registro === 'ausente' ? 'sin rótulo que la cubra' : `consta como ${v.registro === 'nombre' ? v.exigida.nombre : v.piezas.join(' + ')} y aun así el objeto no está`})`).join(' | ')
        + '. VERIFICADO CONTRA EL ESQUEMA, no contra el rótulo del registro: el bundle va a hablarle a objetos que no existen. Aplicarlas es el siguiente paso; no lo hace este agente.',
    });
  }

  const sinVerificar = veredictos.filter((v) => v.hecho === 'sin_catalogo' && v.registro === 'ausente');
  if (sinVerificar.length > 0) {
    hallazgos.push({
      semaforo: 'AMBAR', codigo, objeto: muestra(sinVerificar.map((v) => v.exigida.nombre)),
      detalle: `${numero(sinVerificar.length)} migración(es) exigidas sin rótulo en el registro Y sin catálogo contra el que verificar el hecho.`,
      evidencia: 'ni el nombre ni su prefijo constan en schema_migrations, y postura_seguridad() no contestó para comprobar si sus tablas existen. NO se acusa una falta sobre el rótulo solo (la lección del 28-ago-2026: el registro guarda nombres partidos y renombrados); se verifica en la Mac con `ls supabase/migrations` contra la base.',
    });
  }

  const soloRotulo = veredictos.filter((v) => v.hecho === 'objetos_presentes' && v.registro === 'ausente');
  if (soloRotulo.length > 0) {
    hallazgos.push({
      semaforo: 'NOTA', codigo, objeto: muestra(soloRotulo.map((v) => v.exigida.nombre)),
      detalle: `${numero(soloRotulo.length)} migración(es) exigidas SIN rótulo que las cubra en el registro — y APLICADAS: todo lo que crean está en el catálogo.`,
      evidencia: soloRotulo.map((v) => `${v.exigida.nombre}: ${v.exigida.tablas.join(' + ')} existe(n) en public`).join(' | ')
        + '. Es bookkeeping, no incidente: se aplicó bajo otro nombre o el registro quedó incompleto (el caso real: agente_corrida, agente_definicion, cola_aprobacion y runner_y_campanas entraron sin prefijo). No escala.',
    });
  }

  return hallazgos;
}

/** Los huecos de numeración en el rango aplicado. AMBIGUO A PROPÓSITO y el
 *  parte lo dice: un hueco puede ser un número que nunca existió (pasa cada
 *  ola) o una migración del repo que no se aplicó — desde el servidor no hay
 *  forma de distinguirlos, y afirmar lo segundo sería inventar. */
export function huecosDeNumeracion(filas: MigracionAplicada[]): number[] {
  const usados = new Set<number>();
  for (const f of filas) {
    const p = prefijoDe(f.nombre);
    if (p !== null) usados.add(p);
  }
  if (usados.size === 0) return [];
  const ordenados = [...usados].sort((a, b) => a - b);
  const huecos: number[] = [];
  for (let n = ordenados[0]; n <= ordenados[ordenados.length - 1]; n++) {
    if (!usados.has(n)) huecos.push(n);
  }
  return huecos;
}

/** El detector completo, PURO sobre lo ya leído. `tablas` es la lista de
 *  tablas de public (el HECHO); `null` en su valor = no se pudo leer, y
 *  entonces G1 no acusa sobre rótulos (incidente del 28-ago-2026). */
export function evaluarMigraciones(
  aplicadas: Lectura<RespuestaMigraciones>,
  contrato: Lectura<ContratoEsquema>,
  catalogo: Lectura<FichaAgente[]>,
  tablas: Lectura<readonly string[]>,
): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  if (aplicadas.valor && aplicadas.valor.disponible) {
    const filas = aplicadas.valor.filas;

    // G1 — el bundle exige un esquema que la base no tiene. Es el hallazgo más
    // caro de todos, y por lo mismo el que más caro cuesta gritar en falso: la
    // noche del 28-ago-2026 esta comparación era por NOMBRE y acusó cinco
    // migraciones «faltantes» cuyas tablas existían todas (el registro las
    // tenía partidas en piezas o sin prefijo). Ahora el ROJO solo sale del
    // HECHO: la tabla que la migración crea no está en el catálogo.
    hallazgos.push(...hallazgosDeExigidas(verificarExigidas(filas, tablas.valor), 'G1'));

    // G2 — el incidente 0218/0219 y 0231/0232, en su forma general.
    const inversiones = inversionesDeOrden(filas);
    if (inversiones.length > 0) {
      hallazgos.push({
        semaforo: 'AMBAR', codigo: 'G2', objeto: `${numero(inversiones.length)} inversión(es) de orden`,
        detalle: 'hay migraciones que se aplicaron DESPUÉS de otra con número mayor: el orden real no fue el orden de los archivos.',
        evidencia: `${muestra(inversiones.map((i) => `${i.despues} después de ${i.antes}`), 5)}. Importa cuando la de número menor recrea algo que la mayor ya había recreado (el caso del CHECK del interruptor): la última en correr gana, aunque sea la más vieja.`,
      });
    }

    // G3 — la misma migración aplicada dos veces, o dos archivos con el mismo
    // número. Con seis ramas paralelas, el choque de número es lo más probable.
    const repetidos = nombresRepetidos(filas);
    const chocados = prefijosChocados(filas);
    if (repetidos.length > 0) {
      hallazgos.push({
        semaforo: 'AMBAR', codigo: 'G3', objeto: muestra(repetidos),
        detalle: `${numero(repetidos.length)} migración(es) constan aplicadas MÁS DE UNA VEZ.`,
        evidencia: 'dos filas de schema_migrations con el mismo nombre y distinto version. Es inocuo solo si la migración era idempotente de punta a punta; si tenía un `insert` sin `on conflict` o un `alter ... add constraint`, no lo fue.',
      });
    }
    // ÁMBAR y no ROJO (28-ago-2026): un prefijo compartido es un RÓTULO, no un
    // daño verificado — el daño real (el orden invertido) lo mide G2. Y las
    // piezas contiguas de una migración partida (0150, 0155) ya ni aparecen
    // aquí: `prefijosChocados` solo devuelve los prefijos INTERCALADOS.
    if (chocados.length > 0) {
      hallazgos.push({
        semaforo: 'AMBAR', codigo: 'G4', objeto: muestra(chocados, 4),
        detalle: `${numero(chocados.length)} número(s) de migración usados por DOS archivos distintos, intercalados con otras migraciones.`,
        evidencia: 'dos ramas eligieron el mismo número. El orden entre ellas deja de estar definido por el nombre y pasa a depender de quién aplicó primero — exactamente el desorden que G2 mide. (Una migración aplicada en piezas contiguas NO aparece aquí: es la práctica normal de la casa.)',
      });
    }

    // G5 — los huecos, con su ambigüedad declarada. NOTA y no hallazgo: desde
    // el servidor no hay forma de saber si el número existió alguna vez.
    const huecos = huecosDeNumeracion(filas);
    if (huecos.length > 0) {
      hallazgos.push({
        semaforo: 'NOTA', codigo: 'G5', objeto: `${numero(huecos.length)} hueco(s) de numeración`,
        detalle: `faltan los números ${muestra(huecos.map((n) => String(n).padStart(4, '0')), 12)} en el rango aplicado.`,
        evidencia: 'AMBIGUO A PROPÓSITO: un hueco puede ser un número que nunca existió (pasa en cada ola con ramas paralelas) o un archivo del repo que no se aplicó. Este servidor no tiene el repo y NO puede distinguirlos — se verifica en la Mac con `ls supabase/migrations`.',
      });
    }
  } else {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'G0', objeto: 'schema_migrations',
      detalle: 'el registro de migraciones aplicadas no está disponible en esta base.',
      evidencia: aplicadas.valor?.motivo
        ?? aplicadas.error
        ?? 'la función migraciones_aplicadas() no contestó. NO se afirma que el esquema esté al día: no se pudo mirar.',
    });
  }

  // G6 — la palanca que faltaría. Es candado 1 del runner: sin interruptor en
  // el dominio, apagar al agente rebota con check_violation el día del
  // incidente, que es el peor día para descubrirlo.
  if (contrato.valor && catalogo.valor) {
    const check = contrato.valor.interruptor_check;
    if (check === null) {
      hallazgos.push({
        semaforo: 'ROJO', codigo: 'G6', objeto: 'interruptor_id_dominio',
        detalle: 'el CHECK que acota el dominio del kill switch NO EXISTE en la base.',
        evidencia: 'contrato_de_esquema() devolvió null para interruptor_id_dominio: sin ese CHECK, cualquier cadena entra como palanca y el candado 1 del runner deja de significar algo.',
      });
    } else {
      const sinPalanca = autonomos(catalogo.valor)
        .filter((f) => !check.includes(`'agente:${f.id}'`))
        .map((f) => f.id);
      if (sinPalanca.length > 0) {
        hallazgos.push({
          semaforo: 'ROJO', codigo: 'G6', objeto: muestra(sinPalanca),
          detalle: `${numero(sinPalanca.length)} agente(s) vivos y habilitados en el runner NO están en el dominio del interruptor.`,
          evidencia: 'el candado 1 del runner exige palanca declarada: estos agentes se saltan en cada vuelta con «sin kill switch declarado», o sea que están vivos en el catálogo y no corren nunca. Se arregla recreando el CHECK con el dominio COMPLETO.',
        });
      }
    }
  }

  // G7 — RLS apagada sobre una tabla con tenant_id. No confundir con «sin
  // policies»: con RLS activa, cero policies es DENIEGA TODO y la casa lo usa
  // a propósito. Sin RLS, cualquier grant es lectura cruzada entre flotas.
  if (contrato.valor) {
    const sinRls = contrato.valor.tenant_sin_rls;
    if (sinRls.length > 0) {
      hallazgos.push({
        semaforo: 'ROJO', codigo: 'G7', objeto: muestra(sinRls),
        detalle: `${numero(sinRls.length)} tabla(s) con columna tenant_id tienen RLS APAGADA.`,
        evidencia: 'relrowsecurity = false en pg_class. Con RLS apagada, cualquier grant a anon/authenticated lee las filas de TODAS las flotas — el aislamiento deja de existir para esa tabla.',
      });
    }

    // G8 — el hueco que la auditoría 19 dejó anotado: «ninguna verificación ni
    // prueba que cuenta FK compuestas». Las que apuntan a `app_user` se
    // reportan APARTE porque son el ACTOR (un superadmin de otra flota puede
    // legítimamente ser quien actuó), y mezclarlas ahoga las que sí importan.
    const fks = contrato.valor.fks_simples_entre_tenantizadas;
    const datos = fks.filter((f) => f.destino !== 'app_user');
    const actores = fks.filter((f) => f.destino === 'app_user');
    if (datos.length > 0) {
      hallazgos.push({
        semaforo: 'AMBAR', codigo: 'G8', objeto: muestra(datos.map((f) => `${f.origen}→${f.destino}`), 8),
        detalle: `${numero(datos.length)} FK de UNA sola columna entre tablas con tenant_id, sin FK compuesta hermana.`,
        evidencia: `constraints: ${muestra(datos.map((f) => f.constraint_), 6)}. Sin la columna del tenant en la FK, nada en Postgres impide que una fila de la flota A cuelgue de una de la flota B (el patrón que la 0028 y la 0145 fueron cerrando tabla por tabla).`,
      });
    }
    if (actores.length > 0) {
      hallazgos.push({
        semaforo: 'NOTA', codigo: 'G8', objeto: `${numero(actores.length)} FK a app_user`,
        detalle: 'referencias al ACTOR, listadas aparte y NO contadas como el hallazgo de arriba.',
        evidencia: `${muestra(actores.map((f) => f.origen), 8)}. Un superadmin de otra flota puede legítimamente ser quien creó o resolvió la fila, así que la FK compuesta aquí sería incorrecta, no una mejora.`,
      });
    }
  }

  return hallazgos;
}

export function armarParteMigraciones(
  hallazgos: Hallazgo[], lunes: string,
  aplicadas: Lectura<RespuestaMigraciones>,
  ciegas: string | null,
): string {
  const disponible = aplicadas.valor?.disponible === true;
  const filas = aplicadas.valor?.filas ?? [];
  const ultima = filas[0];
  const lineas = [
    `MIGRACIONES — semana del ${lunes}`,
    '',
    disponible
      ? `Registradas como aplicadas: ${numero(filas.length)}. La más reciente: ${ultima ? `${ultima.nombre} (${aplicadaEn(ultima.version) ?? `version ${ultima.version}, sin sello de tiempo legible`})` : 'ninguna'}.`
      : 'Registro de migraciones NO disponible en esta base: lo de abajo NO afirma nada sobre qué está aplicado.',
    `Contrato del bundle: ${numero(MIGRACIONES_EXIGIDAS.length)} migración(es) exigidas por el código desplegado.`,
    '',
  ];
  if (ciegas) { lineas.push(ciegas, ''); }
  lineas.push(...pintarHallazgos(hallazgos, 'Nada disparó umbral: el contrato del bundle está aplicado, el orden de aplicación respeta la numeración, no hay números chocados, todo agente vivo tiene palanca y ninguna tabla con tenant_id corre sin RLS.'));
  lineas.push('');
  lineas.push('LO QUE ESTE PARTE NO MIRA: el CONTENIDO de una migración. Desde Vercel no hay repo — solo los NOMBRES y los sellos de tiempo que la base registró, más lo que el catálogo de PostgreSQL dice del esquema resultante. Si un .sql hace algo distinto de lo que su nombre promete, eso lo caza la revisión del PR y la batería local, no este agente.');
  lineas.push('CÓMO ACUSA UNA FALTANTE (desde el 28-ago-2026): nunca por el rótulo del registro — el registro guarda migraciones partidas en piezas y renombradas. Una exigida solo se declara faltante cuando la TABLA que crea no está en el catálogo, y la evidencia cita esa tabla.');
  lineas.push(PIE_ALCANCE);
  lineas.push('Fuentes: migraciones_aplicadas() · contrato_de_esquema() · agente_definicion · postura_seguridad() (la existencia real de las tablas exigidas) (0234).');
  return lineas.join('\n');
}

async function correrMigraciones(disparo: DisparoCorrida, hoy: string): Promise<ResultadoIngenieria> {
  const inicio = new Date();
  const agente = 'migraciones';
  const lunes = lunesDe(hoy);
  const titulo = `Migraciones — semana del ${lunes}`;
  try {
    if (await parteExistente(agente, titulo)) {
      await anotar(agente, inicio, 'ok', disparo, { parte: 'ya_existia', titulo });
      return { resultado: 'saltado', piezas: 0, costoUsd: 0, motivo: 'el parte de esta semana ya está en la bandeja' };
    }
    const [aplicadas, contrato, catalogo, tablas] = await Promise.all([
      porValor('migraciones aplicadas (schema_migrations)', leerMigracionesAplicadas),
      porValor('contrato de esquema', leerContrato),
      porValor('catálogo de agentes', leerCatalogo),
      // El HECHO contra el que se verifica cada exigida antes de acusar
      // (incidente 28-ago-2026): ciega esta lectura, G1 no acusa por rótulo.
      porValor('tablas del catálogo (postura_seguridad)', leerTablasCatalogo),
    ]);
    const hallazgos = evaluarMigraciones(aplicadas, contrato, catalogo, tablas);
    const ciegas = lineaFuentesCiegas([aplicadas, contrato, catalogo, tablas]);
    const cuerpo = armarParteMigraciones(hallazgos, lunes, aplicadas, ciegas);
    await alertarRojos(agente, hallazgos);
    const res = await encolarParte(agente, 'parte_migraciones', titulo, cuerpo, {
      semana: lunes,
      aplicadas_disponible: aplicadas.valor?.disponible ?? null,
      aplicadas_total: aplicadas.valor?.filas.length ?? null,
      hallazgos: hallazgos.map((h) => ({ semaforo: h.semaforo, codigo: h.codigo, objeto: h.objeto })),
      consultas: ['migraciones_aplicadas()', 'contrato_de_esquema()', 'agente_definicion', 'postura_seguridad() (tablas)'],
    });
    await anotar(agente, inicio, 'ok', disparo,
      { parte: res, hallazgos: hallazgos.length, rojos: hallazgos.filter((h) => h.semaforo === 'ROJO').length },
      { tareasHechas: 1, tareasTotal: 1 });
    return {
      resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, costoUsd: 0,
      ...(res === 'ya_existia' ? { motivo: 'otra corrida ganó el periodo' } : {}),
    };
  } catch (e) {
    await anotar(agente, inicio, 'fallo', disparo, { titulo }, {
      tareasHechas: 0, tareasTotal: 1,
      error: `No se pudo armar el parte de migraciones: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · SEGURIDAD — los advisors, en SQL, con el objeto exacto citado.
//
// NO reemplaza a los advisors de Supabase: los hace CONSULTABLES desde la
// función, que es lo que faltaba para que un agente pueda citarlos. Y respeta
// la doctrina que la casa ya escribió en `capa1_auditoria_estatica.sql`: una
// tabla con RLS activa y CERO policies es DENIEGA TODO, o sea el lado seguro —
// media docena de tablas viven así a propósito. El riesgo nunca está en «de
// más restrictivo».
// ═══════════════════════════════════════════════════════════════════════════

/** Columnas cuyo propio NOMBRE declara que el valor ya no está en claro. No es
 *  prueba de nada, pero listar `token_hash` junto a `buzon_token` como si
 *  fueran el mismo riesgo enseña a no leer el parte. */
const NOMBRE_YA_PROTEGIDO = /(hash|cifrad|encrypt|prefijo|ultimos|_ref$|_id$)/;

export function evaluarSeguridad(postura: Postura): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // S1/S2 — RLS. Se separa la tabla que además está EXPUESTA de la que solo
  // está sin RLS: la primera es fuga, la segunda es riesgo latente.
  const sinRls = postura.tablas.filter((t) => !t.rls);
  const expuestas = sinRls.filter((t) => t.anon_lee || t.auth_lee || t.anon_escribe || t.auth_escribe);
  const latentes = sinRls.filter((t) => !expuestas.includes(t));
  if (expuestas.length > 0) {
    hallazgos.push({
      semaforo: 'ROJO', codigo: 'S1', objeto: muestra(expuestas.map((t) => t.tabla)),
      detalle: `${numero(expuestas.length)} tabla(s) SIN RLS y con grant a anon o authenticated.`,
      evidencia: expuestas.slice(0, 5).map((t) => `${t.tabla} [${t.tiene_tenant_id ? 'con tenant_id' : 'sin tenant_id'}]: anon lee=${t.anon_lee} escribe=${t.anon_escribe} · authenticated lee=${t.auth_lee} escribe=${t.auth_escribe}`).join(' | '),
    });
  }
  if (latentes.length > 0) {
    hallazgos.push({
      semaforo: 'AMBAR', codigo: 'S2', objeto: muestra(latentes.map((t) => t.tabla)),
      detalle: `${numero(latentes.length)} tabla(s) de public sin RLS (hoy sin grants a anon/authenticated).`,
      evidencia: 'no hay fuga hoy porque nadie tiene grant, pero el día que alguien dé un `grant select ... to authenticated` la tabla queda abierta sin que nada rebote. El doble candado de la casa es RLS activa + revoke.',
    });
  }

  // S3/S4 — SECURITY DEFINER expuesta. Se exceptúan solas las que alguna
  // policy usa como ayudante: el motor de RLS las evalúa con el rol de quien
  // pregunta y revocarlas rompería el aislamiento en vez de cerrarlo (el mismo
  // criterio, y la misma exención automática, de capa1 §B).
  const definer = postura.funciones.filter((f) => f.definer && !f.ayudante_rls);
  const anonExec = definer.filter((f) => f.anon_ejecuta);
  const authExec = definer.filter((f) => f.auth_ejecuta && !f.anon_ejecuta);
  if (anonExec.length > 0) {
    hallazgos.push({
      semaforo: 'ROJO', codigo: 'S3', objeto: muestra(anonExec.map((f) => f.funcion)),
      detalle: `${numero(anonExec.length)} función(es) SECURITY DEFINER ejecutables por anon y que ninguna policy usa.`,
      evidencia: 'una DEFINER corre con los permisos de su dueño: expuesta a anon, cualquiera sin sesión ejecuta lo que ella pueda hacer. Ninguna policy la nombra, así que la exención de ayudante de RLS no aplica.',
    });
  }
  if (authExec.length > 0) {
    hallazgos.push({
      semaforo: 'AMBAR', codigo: 'S4', objeto: muestra(authExec.map((f) => f.funcion)),
      detalle: `${numero(authExec.length)} función(es) SECURITY DEFINER ejecutables por authenticated y que ninguna policy usa.`,
      evidencia: 'cualquier usuario con sesión —de cualquier flota— la puede llamar con los permisos del dueño. Si su cuerpo no filtra por tenant, es el patrón IDOR con otro nombre.',
    });
  }

  // S5 — el advisor `function_search_path_mutable`, tal cual.
  const sinPath = postura.funciones.filter((f) => f.definer && !f.search_path_fijo);
  if (sinPath.length > 0) {
    hallazgos.push({
      semaforo: 'AMBAR', codigo: 'S5', objeto: muestra(sinPath.map((f) => f.funcion)),
      detalle: `${numero(sinPath.length)} función(es) SECURITY DEFINER sin search_path fijo.`,
      evidencia: 'sin `set search_path`, la función resuelve nombres con el search_path de QUIEN la llama: quien pueda crear un objeto en un esquema anterior secuestra la llamada, y corre con los permisos del dueño.',
    });
  }

  // S6 — la regresión más cara que ha tenido este repo (0054, `factura_saldo`).
  const vistas = postura.vistas.filter((v) => !v.security_invoker);
  if (vistas.length > 0) {
    hallazgos.push({
      semaforo: 'ROJO', codigo: 'S6', objeto: muestra(vistas.map((v) => v.vista)),
      detalle: `${numero(vistas.length)} vista(s) sin security_invoker = true.`,
      evidencia: 'una vista sin esa marca corre con los permisos de su DUEÑO y se salta la RLS de las tablas que consulta. Es la regresión de la 0054 (factura_saldo leía las facturas de todas las flotas).',
    });
  }

  // S7 — la heurística de nombre, declarada como heurística.
  const sospechosas = postura.columnas_sensibles.filter((c) => !NOMBRE_YA_PROTEGIDO.test(c.columna));
  const yaProtegidas = postura.columnas_sensibles.length - sospechosas.length;
  if (sospechosas.length > 0) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'S7', objeto: muestra(sospechosas.map((c) => `${c.tabla}.${c.columna}`)),
      detalle: `${numero(sospechosas.length)} columna(s) cuyo NOMBRE parece un secreto y cuyo tipo es texto o json.`,
      evidencia: `HEURÍSTICA DE NOMBRE, no prueba: sospechosa no es culpable. Lo que sí prueba es que nadie tuvo que acordarse de revisarlas. ${numero(yaProtegidas)} candidata(s) más se descartaron porque su nombre declara el valor derivado (hash, cifrado, prefijo, últimos 4). Verificar a mano si guardan el valor en claro.`,
    });
  }

  return hallazgos;
}

export function armarParteSeguridad(hallazgos: Hallazgo[], postura: Lectura<Postura>, lunes: string, ciegas: string | null): string {
  const p = postura.valor;
  const lineas = [
    `SEGURIDAD — semana del ${lunes}`,
    '',
    p
      ? `Inventario revisado: ${numero(p.tablas.length)} tabla(s) · ${numero(p.funciones.length)} función(es) SECURITY DEFINER · ${numero(p.vistas.length)} vista(s) · ${numero(p.columnas_sensibles.length)} columna(s) con nombre de secreto.`
      : 'El catálogo NO contestó: este parte no afirma nada sobre la postura del esquema.',
    '',
  ];
  if (ciegas) { lineas.push(ciegas, ''); }
  lineas.push(...pintarHallazgos(hallazgos, 'Nada disparó umbral: toda tabla de public con RLS, ninguna DEFINER abierta fuera de las ayudantes de RLS, todas con search_path fijo, todas las vistas con security_invoker.'));
  lineas.push('');
  lineas.push('LO QUE ESTE PARTE NO AUDITA, Y QUIÉN SÍ: las dependencias (npm audit), los secretos en el repo, el IDOR en las rutas de API y la autorización en el código. Nada de eso se ve desde una función serverless sin repo. Vive en la RUTINA LOCAL: `npm run audit:dev`, `scripts/mejora-diaria/auditor.mjs` (launchd 05:30) y la batería `capa1_auditoria_estatica.sql`, que es la hermana estática de este mismo parte.');
  lineas.push('LO QUE SÍ MIRA Y NO ES OBVIO: una tabla con RLS activa y CERO policies NO es un hallazgo — es deniega-todo, el lado seguro, y media docena de tablas de la casa viven así a propósito. El riesgo está en «de más permisivo», nunca en «de más restrictivo».');
  lineas.push(PIE_ALCANCE);
  lineas.push('Fuente: postura_seguridad() sobre pg_class / pg_policy / pg_proc / pg_attribute (0234).');
  return lineas.join('\n');
}

async function correrSeguridad(disparo: DisparoCorrida, hoy: string): Promise<ResultadoIngenieria> {
  const inicio = new Date();
  const agente = 'seguridad';
  const lunes = lunesDe(hoy);
  const titulo = `Seguridad — semana del ${lunes}`;
  try {
    if (await parteExistente(agente, titulo)) {
      await anotar(agente, inicio, 'ok', disparo, { parte: 'ya_existia', titulo });
      return { resultado: 'saltado', piezas: 0, costoUsd: 0, motivo: 'el parte de esta semana ya está en la bandeja' };
    }
    const postura = await porValor('postura de seguridad del catálogo', leerPostura);
    // FUENTE ÚNICA Y CIEGA = FALLO, no parte vacío: un parte de seguridad
    // sobre un catálogo que no contestó diría «nada disparó umbral».
    if (!postura.valor) throw new Error('postura_seguridad() no contestó: un parte de seguridad sobre un catálogo ciego afirmaría que no hay hallazgos.');
    const hallazgos = evaluarSeguridad(postura.valor);
    const cuerpo = armarParteSeguridad(hallazgos, postura, lunes, lineaFuentesCiegas([postura]));
    await alertarRojos(agente, hallazgos);
    const res = await encolarParte(agente, 'parte_seguridad', titulo, cuerpo, {
      semana: lunes,
      inventario: {
        tablas: postura.valor.tablas.length,
        definer: postura.valor.funciones.length,
        vistas: postura.valor.vistas.length,
      },
      hallazgos: hallazgos.map((h) => ({ semaforo: h.semaforo, codigo: h.codigo, objeto: h.objeto })),
      consultas: ['postura_seguridad()'],
    });
    await anotar(agente, inicio, 'ok', disparo,
      { parte: res, hallazgos: hallazgos.length, rojos: hallazgos.filter((h) => h.semaforo === 'ROJO').length },
      { tareasHechas: 1, tareasTotal: 1 });
    return {
      resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, costoUsd: 0,
      ...(res === 'ya_existia' ? { motivo: 'otra corrida ganó el periodo' } : {}),
    };
  } catch (e) {
    await anotar(agente, inicio, 'fallo', disparo, { titulo }, {
      tareasHechas: 0, tareasTotal: 1,
      error: `No se pudo armar el parte de seguridad: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · RENDIMIENTO — peso, crecimiento y patrón de acceso REALES.
//
// La persistencia es propia, igual que la de `documentacion` (0219): cada
// parte deja en sus `fuentes` un CENSO de bytes por tabla, y el siguiente
// compara contra él. Sin censo previo el parte es LÍNEA BASE y lo dice — un
// «creció 0%» inventado sobre la nada es peor que no decir nada.
// ═══════════════════════════════════════════════════════════════════════════

/** Bytes por tabla, la persistencia entre partes. */
export type CensoBytes = Record<string, number>;

/** Piso de peso para que una tabla entre a la conversación: por debajo, el
 *  «creció 300%» de una tabla de 8 kB es ruido con signo de exclamación. */
export const PISO_TABLA_BYTES = 1_000_000;
/** Escaneos secuenciales mínimos para sospechar de un índice faltante. */
export const MIN_SEQ_SCAN = 1_000;
/** Cuántas veces más seq_scan que idx_scan dispara la sospecha. */
export const FACTOR_SEQ_SOBRE_IDX = 10;
/** Corridas mínimas para que un costo por corrida signifique algo. */
export const MIN_CORRIDAS_COSTO = 5;

export interface CostoPorAgente { agente: string; corridas: number; conCosto: number; totalUsd: number }

export function evaluarRendimiento(
  perfil: Perfil,
  previo: CensoBytes | null,
  costos: CostoPorAgente[],
): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // R1 — crecimiento contra el censo anterior.
  if (previo === null) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'R1', objeto: '(toda la base)',
      detalle: 'LÍNEA BASE: no hay censo de tamaños registrado por este agente, así que esta semana NO se declara ningún crecimiento.',
      evidencia: `este parte deja el censo de ${numero(perfil.tablas.length)} tabla(s); los deltas empiezan la próxima. Decir «no creció» sin censo previo sería afirmar algo que nadie midió.`,
    });
  } else {
    const crecieron = perfil.tablas
      .filter((t) => t.bytes >= PISO_TABLA_BYTES && typeof previo[t.tabla] === 'number' && previo[t.tabla] > 0)
      .map((t) => ({ tabla: t.tabla, antes: previo[t.tabla], ahora: t.bytes, delta: t.bytes - previo[t.tabla] }))
      .filter((x) => x.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);
    if (crecieron.length > 0) {
      hallazgos.push({
        semaforo: 'NOTA', codigo: 'R1', objeto: muestra(crecieron.map((c) => c.tabla), 5),
        detalle: `las ${numero(crecieron.length)} tabla(s) que más crecieron desde el censo anterior.`,
        evidencia: crecieron.map((c) => `${c.tabla}: ${mb(c.antes)} → ${mb(c.ahora)} (+${mb(c.delta)}, ${((c.delta / c.antes) * 100).toFixed(0)}%)`).join(' · '),
      });
    }
    const nuevas = perfil.tablas.filter((t) => previo[t.tabla] === undefined).map((t) => t.tabla);
    if (nuevas.length > 0) {
      hallazgos.push({
        semaforo: 'NOTA', codigo: 'R1', objeto: muestra(nuevas),
        detalle: `${numero(nuevas.length)} tabla(s) no estaban en el censo anterior.`,
        evidencia: 'no se les calcula crecimiento: sin medida previa, el delta no existe (no es «creció desde 0»). Entran a la vara la semana que viene.',
      });
    }
  }

  // R2 — índice faltante. `seq_scan` NULL no se lee como 0.
  const sinStats = perfil.tablas.filter((t) => t.seq_scan === null);
  const candidatas = perfil.tablas
    .filter((t): t is TablaPerfil & { seq_scan: number } => t.seq_scan !== null)
    .filter((t) => t.seq_scan >= MIN_SEQ_SCAN
      && t.bytes >= PISO_TABLA_BYTES
      && t.seq_scan >= (t.idx_scan ?? 0) * FACTOR_SEQ_SOBRE_IDX)
    .sort((a, b) => (b.seq_tup_read ?? 0) - (a.seq_tup_read ?? 0))
    .slice(0, 6);
  if (candidatas.length > 0) {
    hallazgos.push({
      semaforo: 'AMBAR', codigo: 'R2', objeto: muestra(candidatas.map((t) => t.tabla), 6),
      detalle: `${numero(candidatas.length)} tabla(s) con escaneo secuencial dominante y peso suficiente para que duela.`,
      evidencia: candidatas.map((t) => `${t.tabla}: ${numero(t.seq_scan)} seq_scan vs ${numero(t.idx_scan ?? 0)} idx_scan · ${numero(t.seq_tup_read ?? 0)} filas leídas en secuencial · ${mb(t.bytes)} · ${numero(t.indices)} índice(s)`).join(' | ')
        + '. Es una SOSPECHA con evidencia, no un diagnóstico: cuál índice falta depende de la consulta, y eso se decide leyendo el código en la Mac.',
    });
  }
  if (sinStats.length > 0) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'R2', objeto: muestra(sinStats.map((t) => t.tabla)),
      detalle: `${numero(sinStats.length)} tabla(s) sin estadísticas de acceso en el colector.`,
      evidencia: 'seq_scan vino NULL, que significa «no consta», NUNCA «cero escaneos». Estas tablas quedan FUERA del análisis de índice faltante: no se afirma que estén bien.',
    });
  }

  // R3 — consultas lentas, si la extensión está.
  if (!perfil.consultas.disponible) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'R3', objeto: 'pg_stat_statements',
      detalle: 'no hay medición de consultas lentas en esta base.',
      evidencia: perfil.consultas.motivo ?? 'la extensión no está instalada. NO se afirma que no haya consultas lentas: no se pudo mirar.',
    });
  } else {
    const top = perfil.consultas.filas.slice(0, 5);
    if (top.length > 0) {
      hallazgos.push({
        semaforo: 'NOTA', codigo: 'R3', objeto: `top ${numero(top.length)} por tiempo total`,
        detalle: 'las consultas que más tiempo acumulan desde el último reinicio del contador.',
        evidencia: top.map((c) => `${Math.round(c.ms_total)} ms totales · ${numero(c.llamadas)} llamada(s) · ${c.ms_media.toFixed(1)} ms de media — ${recortar(c.consulta, 120)}`).join(' | '),
      });
    }
  }

  // R4 — el costo de IA por corrida, como proxy de eficiencia. NULL ≠ 0.
  const conBase = costos.filter((c) => c.conCosto >= MIN_CORRIDAS_COSTO && c.totalUsd > 0)
    .map((c) => ({ ...c, porCorrida: c.totalUsd / c.conCosto }))
    .sort((a, b) => b.porCorrida - a.porCorrida)
    .slice(0, 5);
  if (conBase.length > 0) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'R4', objeto: muestra(conBase.map((c) => c.agente), 5),
      detalle: 'costo de IA por corrida en la ventana (proxy de eficiencia, no de calidad).',
      evidencia: conBase.map((c) => `${c.agente}: ${usd4(c.porCorrida)}/corrida sobre ${numero(c.conCosto)} corrida(s) con costo medido (${usd(round2(c.totalUsd))} en total)`).join(' · '),
    });
  }
  const sinMedir = costos.filter((c) => c.conCosto === 0 && c.corridas > 0);
  if (sinMedir.length > 0) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'R4', objeto: muestra(sinMedir.map((c) => c.agente)),
      detalle: `${numero(sinMedir.length)} agente(s) corrieron y NINGUNA corrida anotó costo.`,
      evidencia: 'costo_usd NULL es «no se midió», jamás $0. De estos agentes no se afirma que no gasten: se afirma que no consta cuánto gastan.',
    });
  }

  return hallazgos;
}

/** «12.4 MB» — el peso como lo lee una persona. Vive aquí y no en formato.ts
 *  porque es la única pantalla del repo que habla de bytes de tabla. */
export function mb(bytes: number): string {
  if (bytes < 1024) return `${numero(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function armarParteRendimiento(hallazgos: Hallazgo[], perfil: Perfil, lunes: string, ciegas: string | null): string {
  const total = perfil.tablas.reduce((s, t) => s + t.bytes, 0);
  const mayores = [...perfil.tablas].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  const lineas = [
    `RENDIMIENTO — semana del ${lunes}`,
    '',
    `Peso de public: ${mb(total)} en ${numero(perfil.tablas.length)} tabla(s).`,
    `Las cinco más pesadas: ${mayores.map((t) => `${t.tabla} ${mb(t.bytes)}`).join(' · ')}.`,
    '',
  ];
  if (ciegas) { lineas.push(ciegas, ''); }
  lineas.push(...pintarHallazgos(hallazgos, 'Nada disparó umbral: ninguna tabla creció fuera de banda, ninguna escanea en secuencial de más y ningún costo por corrida se salió de su vara.'));
  lineas.push('');
  lineas.push('LO QUE ESTE PARTE NO MIDE: tiempos de build, tamaño del bundle, Lighthouse, cold starts ni memoria de la función. El runner corre EN la función, no en el pipeline, y no tiene acceso a las métricas de Vercel. Eso se mide en el panel de Vercel y en la rutina local.');
  lineas.push('CÓMO SE LEE UN HALLAZGO R2: es una SOSPECHA con evidencia, no un diagnóstico. Qué índice falta depende de la consulta que escanea, y esa decisión se toma leyendo el código — este agente señala dónde mirar.');
  lineas.push(PIE_ALCANCE);
  lineas.push('Fuentes: perfil_almacenamiento() sobre pg_class / pg_stat_user_tables / pg_stat_statements · agente_corrida (costo por corrida) · el censo de tamaños del parte anterior de este agente.');
  return lineas.join('\n');
}

/** El costo por agente en la ventana. NULL ≠ 0: se cuentan aparte las
 *  corridas que no midieron. LANZA si la bitácora no se puede leer. */
export async function leerCostos(desdeIso: string): Promise<CostoPorAgente[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select('agente, costo_usd')
    .gte('inicio', desdeIso)
    .limit(5000), 'ingenieria.costos');
  if (error) throw new Error(`leerCostos: ${error.message}`);
  const acc = new Map<string, CostoPorAgente>();
  for (const f of (data ?? []) as Array<{ agente: string; costo_usd: unknown }>) {
    const a = acc.get(f.agente) ?? { agente: f.agente, corridas: 0, conCosto: 0, totalUsd: 0 };
    a.corridas += 1;
    if (f.costo_usd !== null && f.costo_usd !== undefined) {
      a.conCosto += 1;
      a.totalUsd += Number(f.costo_usd);
    }
    acc.set(f.agente, a);
  }
  return [...acc.values()].sort((a, b) => a.agente.localeCompare(b.agente));
}

async function correrRendimiento(disparo: DisparoCorrida, hoy: string): Promise<ResultadoIngenieria> {
  const inicio = new Date();
  const agente = 'rendimiento';
  const lunes = lunesDe(hoy);
  const titulo = `Rendimiento — semana del ${lunes}`;
  try {
    if (await parteExistente(agente, titulo)) {
      await anotar(agente, inicio, 'ok', disparo, { parte: 'ya_existia', titulo });
      return { resultado: 'saltado', piezas: 0, costoUsd: 0, motivo: 'el parte de esta semana ya está en la bandeja' };
    }
    const perfilL = await porValor('perfil de almacenamiento', () => leerPerfil(20));
    // Fuente única: sin ella el parte diría «nada creció y nada escanea de
    // más» sobre una base que no contestó.
    if (!perfilL.valor) throw new Error('perfil_almacenamiento() no contestó: un parte de rendimiento sobre una base ciega afirmaría que nada creció.');
    const perfil = perfilL.valor;
    const [previo, costos] = await Promise.all([
      porValor('censo de tamaños del parte anterior', () => censoPrevio<CensoBytes>(agente, 'parte_rendimiento', 'censo_bytes')),
      porValor('costo por corrida', () => leerCostos(inicioDia(masDias(lunes, -7)))),
    ]);
    const hallazgos = evaluarRendimiento(perfil, previo.valor?.censo ?? null, costos.valor ?? []);
    const ciegas = lineaFuentesCiegas([previo, costos]);
    const cuerpo = armarParteRendimiento(hallazgos, perfil, lunes, ciegas);
    const censo: CensoBytes = {};
    for (const t of perfil.tablas) censo[t.tabla] = t.bytes;
    const res = await encolarParte(agente, 'parte_rendimiento', titulo, cuerpo, {
      semana: lunes,
      // EL CENSO ES LA PERSISTENCIA DEL AGENTE: sin él, el parte siguiente
      // volvería a ser línea base para siempre.
      censo_bytes: censo,
      consultas_disponibles: perfil.consultas.disponible,
      hallazgos: hallazgos.map((h) => ({ semaforo: h.semaforo, codigo: h.codigo, objeto: h.objeto })),
      consultas: ['perfil_almacenamiento()', 'agente_corrida (costos)', 'cola_aprobacion (censo previo)'],
    });
    await anotar(agente, inicio, 'ok', disparo,
      { parte: res, hallazgos: hallazgos.length, linea_base: previo.valor?.censo == null, tablas: perfil.tablas.length },
      { tareasHechas: 1, tareasTotal: 1 });
    return {
      resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, costoUsd: 0,
      ...(res === 'ya_existia' ? { motivo: 'otra corrida ganó el periodo' } : {}),
    };
  } catch (e) {
    await anotar(agente, inicio, 'fallo', disparo, { titulo }, {
      tareasHechas: 0, tareasTotal: 1,
      error: `No se pudo armar el parte de rendimiento: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · RELEASES — qué SHA corre, desde cuándo, y qué se movió después.
//
// LA TRAMPA QUE ESTE AGENTE EXISTE PARA CERRAR: «mergeado ≠ desplegado». Ya
// mordió aquí: migraciones aplicadas contra una base que sirve código viejo, y
// código nuevo desplegado contra un esquema que todavía no tiene sus objetos.
// Las dos formas se miden con lo mismo: el SHA que Vercel expone en la función
// contra el sello de tiempo con que cada migración quedó registrada.
//
// LA HONESTIDAD DEL RELOJ: Vercel NO expone la hora del despliegue dentro de la
// función. Lo único verdadero que este servidor puede registrar es la PRIMERA
// VEZ QUE VIO el SHA (tabla `despliegue_visto`, 0234). Entre el deploy y esa
// primera vista puede pasar un ciclo entero del cron, y el parte lo dice con
// esas palabras en vez de vender la marca como hora de despliegue.
// ═══════════════════════════════════════════════════════════════════════════

export interface Despliegue {
  sha: string; entorno: string; rama: string | null;
  primeraVista: string; ultimaVista: string; vistas: number;
}

/** El SHA que Vercel expone en la función. `null` fuera de Vercel — y eso se
 *  dice, no se rellena con 'local' fingiendo un commit. */
export function shaDesplegado(): string | null {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

export function entornoDesplegado(): string {
  return (process.env.VERCEL_ENV ?? '').trim() || 'local';
}

export function ramaDesplegada(): string | null {
  const r = (process.env.VERCEL_GIT_COMMIT_REF ?? '').trim();
  return r === '' ? null : r.slice(0, 200);
}

/**
 * Registra que este servidor vio correr este SHA. Idempotente por PK: la
 * primera corrida lo inserta y las siguientes solo mueven `ultima_vista`.
 *
 * El `insert ... on conflict` de PostgREST (`upsert` con `ignoreDuplicates:
 * false`) pisaría `primera_vista` con el default en cada vuelta, así que se
 * hace en dos pasos anclados: UPDATE primero (que jamás toca `primera_vista`)
 * y INSERT solo si el UPDATE no encontró fila. Dos corridas simultáneas: la
 * segunda choca con la PK y se trata como «ya estaba», no como fallo.
 */
/** SOLO LEE la fila de un SHA en `despliegue_visto` (`null` = nunca visto).
 *  La usa `registrarDespliegue` y también el agente `pruebas`, que necesita
 *  saber DESDE CUÁNDO corre el código vigente para no contar como alerta los
 *  fallos del código anterior (incidente 28-ago-2026) — y que por contrato de
 *  la tabla (0234) no escribe en ella: el único escritor es `releases`. */
export async function leerDespliegueVisto(sha: string): Promise<Despliegue | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('despliegue_visto')
    .select('sha, entorno, rama, primera_vista, ultima_vista, vistas')
    .eq('sha', sha)
    .limit(1), 'ingenieria.despliegue_leer');
  if (error) throw new Error(`leerDespliegueVisto: ${error.message}`);
  const fila = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (!fila) return null;
  return {
    sha, entorno: String(fila.entorno), rama: (fila.rama as string | null) ?? null,
    primeraVista: String(fila.primera_vista), ultimaVista: String(fila.ultima_vista),
    vistas: Number(fila.vistas ?? 0),
  };
}

export async function registrarDespliegue(sha: string): Promise<Despliegue | null> {
  const ahora = new Date().toISOString();
  const previa = await leerDespliegueVisto(sha);

  if (previa) {
    const vistas = previa.vistas + 1;
    const { error } = await acotada(supabaseAdmin()
      .from('despliegue_visto')
      .update({ ultima_vista: ahora, vistas })
      .eq('sha', sha), 'ingenieria.despliegue_tocar');
    if (error) throw new Error(`registrarDespliegue.tocar: ${error.message}`);
    return { ...previa, ultimaVista: ahora, vistas };
  }

  const fila = {
    sha, entorno: entornoDesplegado(), rama: ramaDesplegada(),
    primera_vista: ahora, ultima_vista: ahora, vistas: 1,
  };
  const { error } = await acotada(supabaseAdmin()
    .from('despliegue_visto').insert(fila), 'ingenieria.despliegue_alta');
  if (error) {
    // Otra corrida ganó la carrera del alta: no es fallo, es la PK arbitrando.
    if (!error.message.includes('duplicate key')) throw new Error(`registrarDespliegue.alta: ${error.message}`);
    logger.info('ingenieria.despliegue_carrera', { sha });
  }
  return {
    sha, entorno: fila.entorno, rama: fila.rama,
    primeraVista: ahora, ultimaVista: ahora, vistas: 1,
  };
}

/** Los últimos despliegues que este servidor ha visto. LANZA si no se leen. */
export async function leerDespliegues(limite = 6): Promise<Despliegue[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('despliegue_visto')
    .select('sha, entorno, rama, primera_vista, ultima_vista, vistas')
    .order('ultima_vista', { ascending: false })
    .limit(limite), 'ingenieria.despliegues');
  if (error) throw new Error(`leerDespliegues: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    sha: String(f.sha),
    entorno: String(f.entorno),
    rama: (f.rama as string | null) ?? null,
    primeraVista: String(f.primera_vista),
    ultimaVista: String(f.ultima_vista),
    vistas: Number(f.vistas ?? 0),
  }));
}

export function evaluarReleases(
  actual: Despliegue | null,
  aplicadas: Lectura<RespuestaMigraciones>,
  tablas: Lectura<readonly string[]>,
): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  if (actual === null) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'D0', objeto: 'VERCEL_GIT_COMMIT_SHA',
      detalle: 'este servidor no expone un SHA de commit: no está corriendo en Vercel, o la variable no llegó a la función.',
      evidencia: `entorno declarado: ${entornoDesplegado()}. NO se inventa un SHA: sin él, este parte no puede decir qué código está corriendo, y eso es lo que dice.`,
    });
  }

  if (!aplicadas.valor || !aplicadas.valor.disponible) {
    hallazgos.push({
      semaforo: 'NOTA', codigo: 'D1', objeto: 'schema_migrations',
      detalle: 'sin registro de migraciones aplicadas no se puede comparar el esquema contra el despliegue.',
      evidencia: aplicadas.valor?.motivo ?? aplicadas.error ?? 'la función no contestó.',
    });
    return hallazgos;
  }

  const filas = aplicadas.valor.filas;

  // D2 — el código exige objetos que la base no tiene. Es la mitad cara — y
  // fue el correo en falso del 28-ago-2026: comparado por NOMBRE, acusó
  // migraciones «faltantes» que estaban aplicadas en piezas o bajo otro
  // rótulo. Ahora usa el MISMO criterio verificado que G1: el ROJO solo sale
  // cuando la tabla que la migración crea no está en el catálogo.
  hallazgos.push(...hallazgosDeExigidas(verificarExigidas(filas, tablas.valor), 'D2'));

  // D3 — la otra mitad: el esquema se movió DESPUÉS de que este SHA empezó a
  // correr, así que el código que está en producción se construyó antes.
  if (actual) {
    const corte = Date.parse(actual.primeraVista);
    const posteriores = filas
      .map((f) => ({ nombre: f.nombre, en: aplicadaEn(f.version) }))
      .filter((f): f is { nombre: string; en: string } => f.en !== null && Date.parse(f.en) > corte);
    if (posteriores.length > 0) {
      hallazgos.push({
        semaforo: 'AMBAR', codigo: 'D3', objeto: muestra(posteriores.map((p) => p.nombre), 8),
        detalle: `${numero(posteriores.length)} migración(es) se aplicaron DESPUÉS de que este servidor viera el SHA que corre.`,
        evidencia: `SHA ${actual.sha.slice(0, 7)} visto por primera vez el ${actual.primeraVista.slice(0, 19).replace('T', ' ')} UTC; después de esa marca entró ${muestra(posteriores.map((p) => `${p.nombre} (${p.en.slice(0, 19).replace('T', ' ')})`), 4)}. El esquema avanzó y el código no: si esas migraciones traían objetos que el código nuevo necesita, ese código todavía no está desplegado.`,
      });
    }
  }

  return hallazgos;
}

export function armarParteReleases(
  hallazgos: Hallazgo[], actual: Despliegue | null, historial: Despliegue[],
  aplicadas: Lectura<RespuestaMigraciones>, lunes: string, ciegas: string | null,
): string {
  const ultima = aplicadas.valor?.filas[0];
  const lineas = [`RELEASES — semana del ${lunes}`, ''];
  if (actual) {
    const dias = Math.floor((Date.now() - Date.parse(actual.primeraVista)) / 86_400_000);
    lineas.push(`Corriendo: ${actual.sha.slice(0, 7)} · entorno ${actual.entorno} · rama ${actual.rama ?? 'NO CONSTA (VERCEL_GIT_COMMIT_REF ausente; no se rellena con «master»)'}.`);
    lineas.push(`Visto por primera vez: ${actual.primeraVista.slice(0, 19).replace('T', ' ')} UTC (hace ${numero(dias)} día(s)), en ${numero(actual.vistas)} corrida(s) de este agente.`);
    lineas.push('OJO CON ESA FECHA: es la PRIMERA VISTA de este servidor, NO la hora del despliegue — Vercel no la expone dentro de la función. Entre el deploy y la primera pasada del cron puede pasar un ciclo entero.');
  } else {
    lineas.push(`Corriendo: SIN SHA DECLARADO (entorno ${entornoDesplegado()}). Este parte no afirma qué código está en producción.`);
  }
  lineas.push(ultima
    ? `Última migración registrada: ${ultima.nombre} (${aplicadaEn(ultima.version) ?? `version ${ultima.version}`}).`
    : 'Última migración registrada: no consta.');
  lineas.push('');
  if (ciegas) { lineas.push(ciegas, ''); }
  lineas.push(...pintarHallazgos(hallazgos, 'Nada disparó umbral: el bundle tiene aplicadas todas las migraciones que exige y ninguna entró después de que este SHA empezara a correr.'));
  if (historial.length > 1) {
    lineas.push('');
    lineas.push(`DESPLIEGUES QUE ESTE SERVIDOR HA VISTO (${numero(historial.length)} más recientes):`);
    for (const d of historial) {
      lineas.push(`  · ${d.sha.slice(0, 7)} [${d.entorno}${d.rama ? ` · ${d.rama}` : ''}] — primera vista ${d.primeraVista.slice(0, 10)}, última ${d.ultimaVista.slice(0, 10)}, ${numero(d.vistas)} corrida(s).`);
    }
  }
  lineas.push('');
  lineas.push('LO QUE ESTE PARTE NO SABE: si un PR está mergeado, si el build pasó, si hay un despliegue en curso o si alguien hizo rollback. Nada de eso llega a la función; lo que sí llega es el SHA que está ejecutando ESTE código, y contra ese se mide todo lo de arriba.');
  lineas.push(PIE_ALCANCE);
  lineas.push('CÓMO ACUSA UNA FALTANTE (desde el 28-ago-2026): nunca por el rótulo del registro — solo cuando la tabla que la migración crea NO está en el catálogo, verificado con postura_seguridad().');
  lineas.push('Fuentes: VERCEL_GIT_COMMIT_SHA / VERCEL_ENV / VERCEL_GIT_COMMIT_REF del propio proceso · despliegue_visto (0234) · migraciones_aplicadas() · postura_seguridad() (tablas).');
  return lineas.join('\n');
}

async function correrReleases(disparo: DisparoCorrida, hoy: string): Promise<ResultadoIngenieria> {
  const inicio = new Date();
  const agente = 'releases';
  const lunes = lunesDe(hoy);
  const titulo = `Releases — semana del ${lunes}`;
  try {
    // EL REGISTRO CORRE SIEMPRE, aunque el parte de la semana ya exista (misma
    // lección que la criba de `talento`, c6-6): lo SEMANAL es la fabricación
    // del parte, no el trabajo. Si el registro esperara al parte, un despliegue
    // del miércoles no quedaría anotado hasta el lunes siguiente y su «primera
    // vista» mentiría por seis días.
    const sha = shaDesplegado();
    const actual = await porValor('registro del despliegue', async () => (sha ? registrarDespliegue(sha) : null));

    if (await parteExistente(agente, titulo)) {
      await anotar(agente, inicio, 'ok', disparo, { parte: 'ya_existia', titulo, sha: sha ?? null },
        { tareasHechas: 1, tareasTotal: 1 });
      return {
        resultado: 'corrio', piezas: 0, costoUsd: 0,
        motivo: sha
          ? `el parte de esta semana ya está en la bandeja; el SHA ${sha.slice(0, 7)} quedó registrado igual`
          : 'el parte de esta semana ya está en la bandeja; sin SHA que registrar',
      };
    }

    const [aplicadas, historial, tablas] = await Promise.all([
      porValor('migraciones aplicadas (schema_migrations)', leerMigracionesAplicadas),
      porValor('historial de despliegues', () => leerDespliegues(6)),
      // El HECHO para D2 (incidente 28-ago-2026): sin esta lectura no se acusa
      // una migración faltante por su rótulo.
      porValor('tablas del catálogo (postura_seguridad)', leerTablasCatalogo),
    ]);
    const hallazgos = evaluarReleases(actual.valor ?? null, aplicadas, tablas);
    const ciegas = lineaFuentesCiegas([actual, aplicadas, historial, tablas]);
    const cuerpo = armarParteReleases(hallazgos, actual.valor ?? null, historial.valor ?? [], aplicadas, lunes, ciegas);
    await alertarRojos(agente, hallazgos);
    const res = await encolarParte(agente, 'parte_releases', titulo, cuerpo, {
      semana: lunes,
      sha: sha ?? null,
      entorno: entornoDesplegado(),
      primera_vista: actual.valor?.primeraVista ?? null,
      hallazgos: hallazgos.map((h) => ({ semaforo: h.semaforo, codigo: h.codigo, objeto: h.objeto })),
      consultas: ['despliegue_visto', 'migraciones_aplicadas()', 'postura_seguridad() (tablas)'],
    });
    await anotar(agente, inicio, 'ok', disparo,
      { parte: res, sha: sha ?? null, hallazgos: hallazgos.length },
      { tareasHechas: 1, tareasTotal: 1 });
    return {
      resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, costoUsd: 0,
      ...(res === 'ya_existia' ? { motivo: 'otra corrida ganó el periodo' } : {}),
    };
  } catch (e) {
    await anotar(agente, inicio, 'fallo', disparo, { titulo }, {
      tareasHechas: 0, tareasTotal: 1,
      error: `No se pudo armar el parte de releases: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ── El despacho que el runner llama ────────────────────────────────────────

export async function correrAgenteIngenieria(
  id: AgenteIngenieria,
  disparo: DisparoCorrida,
  hoy: string = hoyMx(),
): Promise<ResultadoIngenieria> {
  logger.info('ingenieria.corrida', { agente: id, disparo });
  switch (id) {
    case 'migraciones': return correrMigraciones(disparo, hoy);
    case 'seguridad': return correrSeguridad(disparo, hoy);
    case 'rendimiento': return correrRendimiento(disparo, hoy);
    case 'releases': return correrReleases(disparo, hoy);
    default: {
      // Los otros cuatro (pruebas, auditor_codigo, producto,
      // datos_instrumentacion) viven en su propio módulo y entran por import
      // dinámico, por la misma razón que el runner carga este: solo se paga
      // cuando de verdad toca despacharlos.
      const { correrAgenteIngenieriaProducto } = await import('./ingenieria_producto');
      return correrAgenteIngenieriaProducto(id, disparo, hoy);
    }
  }
}

// Reexportadas para el módulo hermano: la aritmética, los helpers de bandeja y
// el semáforo son los mismos para los ocho, y duplicarlos allá los dejaría
// divergir en silencio.
export { inicioDia, censoPrevio, alertarRojos };
