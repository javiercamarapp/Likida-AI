// ═══════════════════════════════════════════════════════════════════════════
// EL KILL SWITCH (0110) — la palanca que apaga un agente en cinco segundos.
//
// SIN FILA = ENCENDIDO: el default seguro es que el sistema corre, y una fila
// solo existe cuando alguien tocó la palanca. Los crons preguntan aquí antes
// de trabajar; /admin/observabilidad y el ⌘K son quienes la mueven.
//
// ── POR QUÉ `estaApagado` FALLA CERRADO (error de lectura = APAGADO) ───────
//
// Es la decisión central del módulo y va al revés de casi todo el repo, a
// propósito. En una LECTURA de panel, fallar cerrado es LANZAR para que la
// pantalla diga "no pude mirar". Pero este interruptor existe para un
// incidente: un agente portándose mal con un cliente real en WhatsApp. Si
// Javier lo apaga y un bache de red le esconde la fila al cron, "no pude leer
// el interruptor = corre" ejecutaría EXACTAMENTE lo que se acaba de apagar —
// mensajes a personas reales, CFDIs, cobranza. El costo del otro error (la
// base caída salta una corrida que de todos modos iba a morir contra la misma
// base) es una hora de retraso en un cron que reintenta solo. Se elige el
// error barato, y el log lo grita para que el salto no pase desapercibido.
//
// GLOBAL POR AGENTE EN V1, NO POR TENANT: los crons barren todas las flotas
// en una corrida; la palanca corta el barrido entero (ver 0110).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { DatoInvalido } from './errores';
import { acotada } from './presupuesto';

/** El catálogo completo: 'global' + los 7 agentes del dominio de
 *  `agente_corrida` (0102 + ventas en 0105). El CHECK de la 0110 vigila lo
 *  mismo en la base — un nombre fuera de esta lista no apaga nada. */
export const INTERRUPTORES = [
  'global',
  'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
  'agente:conductores', 'agente:peajes', 'agente:proveedores',
  'agente:ventas', 'agente:redactor',
  // Los 4 financieros del back office (0215) — autónomos del runner: sin
  // kill switch declarado el runner ni los despacha (candado 1).
  'agente:analista_metricas', 'agente:control_costos',
  'agente:tesoreria', 'agente:cierre_mensual',
  // Los cuatro de dirección (0216) — mismo candado.
  'agente:kpi_whatsapp', 'agente:desempeno_startup',
  'agente:orquestador', 'agente:orquestador_semanal',
  // La máquina de prospección (0217): el investigador (id histórico
  // `enriquecedor`), el SDR de seguimientos y el enviador de campaña — el
  // único de los tres que toca un canal real, y por eso el primero que se
  // apaga si algo huele mal.
  'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
  // El back office restante (0219): el vigilante que audita a los otros, el
  // que caza el drift del catálogo, los relojes legales de Likida-empresa y
  // el registro de talento. Mismo candado 1 — sin palanca no se despachan.
  'agente:vigilante_calidad', 'agente:documentacion',
  'agente:legal_compliance', 'agente:talento',
  // Éxito del cliente (0218) — los seis que vigilan a la flota que YA firmó.
  // Ninguno escribe al cliente: todos dejan el parte o el borrador en la
  // bandeja. Aun así llevan palanca, porque el candado 1 del runner no
  // distingue entre "manda correos" y "solo propone": un autónomo que no se
  // puede apagar no corre, punto.
  'agente:onboarding_cliente', 'agente:exito_cliente', 'agente:retencion',
  'agente:cobranza_saas', 'agente:soporte', 'agente:atencion_faq',
  // CRECIMIENTO (0230) — los diez que fabrican material de marca. NINGUNO
  // publica: los diez dejan la pieza en la bandeja y publicar es el tap de
  // Javier. Aun así llevan palanca por el candado 1 del runner, y por una
  // razón propia: son los únicos agentes cuyo producto lleva la marca hacia
  // AFUERA. Si una pieza sale mal, apagar al que la fabrica tiene que ser un
  // click, no un deploy.
  'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:seo_distribucion',
  'agente:guiones', 'agente:noticias_mercado', 'agente:promos_diarias',
  'agente:visuales', 'agente:video_demo', 'agente:video_marketing',
  'agente:alianzas',
  // La descarga masiva del SAT (0231). Palanca propia y no solo la global:
  // este autónomo habla con el buzón tributario y ESCRIBE comprobantes, así
  // que apagarlo no puede exigir apagar la facturación entera.
  'agente:descarga_sat',
  // INGENIERÍA (0234) — los ocho que cuidan la máquina por dentro. Ninguno
  // escribe fuera de la bandeja, y aun así llevan palanca: son los únicos que
  // recorren el CATÁLOGO ENTERO de PostgreSQL en cada pasada (tablas,
  // policies, funciones, tamaños, pg_stat_statements). El día que una de esas
  // consultas pese de más, apagar al que la lanza tiene que ser un click.
  'agente:migraciones', 'agente:seguridad', 'agente:rendimiento',
  'agente:pruebas', 'agente:auditor_codigo', 'agente:releases',
  'agente:producto', 'agente:datos_instrumentacion',
  // LOS NUEVE QUE CIERRAN LA COMPAÑÍA AGENTE (0235). Tres de dirección y seis
  // de leads: con ellos las 60 filas de `agente_definicion` quedan vivas y no
  // queda una sola promesa sin motor. Ninguno de los nueve escribe a nadie —
  // los nueve dejan su pieza en la bandeja—, y aun así llevan palanca por el
  // candado 1 del runner y por una razón propia de cada mitad: los de leads
  // preparan lo que después se le manda a una empresa real, y los de dirección
  // producen el parte que Javier lee para decidir. Si uno empieza a fabricar
  // ruido, apagarlo tiene que ser un click y no un deploy.
  'agente:automejora', 'agente:especialistas_incidente', 'agente:fundraising',
  'agente:scorer', 'agente:dossier', 'agente:vigia',
  'agente:demo_prep', 'agente:propuestas', 'agente:cazador',
] as const;

export type NombreInterruptor = (typeof INTERRUPTORES)[number];

export interface EstadoInterruptor {
  id: NombreInterruptor;
  apagado: boolean;
  motivo: string | null;
  cambiadoPor: string | null;
  /** Nombre o correo de quién movió la palanca — resuelto contra app_user
   *  para que la pantalla diga "quién", no un uuid. `null` si nunca se tocó
   *  o si la cuenta ya no existe. */
  cambiadoPorNombre: string | null;
  cambiadoEn: string | null;
}

function esNombreValido(nombre: string): nombre is NombreInterruptor {
  return (INTERRUPTORES as readonly string[]).includes(nombre);
}

// AUDITORÍA 18, ALTO (A23): TODA consulta de este archivo lleva `acotada`,
// no solo la lectura del camino caliente — `acotada_guardiana.test.ts` cuenta
// los `.from(` contra los `acotada(` y falla si uno nuevo nace sin techo.

/** Lo que una lectura puede decir. `ilegible` es el tercer estado que
 *  `estaApagado` colapsa en "apagado" (fail-closed) y que los crons
 *  necesitan DISTINGUIR: apagado a propósito no es un fallo; no haber
 *  podido saberlo SÍ lo es (AUDITORÍA 18, A17). */
export type LecturaInterruptor = 'encendido' | 'apagado' | 'ilegible';

// ── CACHÉ DE LECTURA, 5 s POR INSTANCIA (auditoría prod, RES-19) ───────────
//
// El webhook pregunta `estaApagado('global')` en CADA `after()` y los crons lo
// preguntan dos o tres veces por corrida: a 50k mensajes/día eso es una
// consulta a `interruptor` por cada mensaje entrante, en el camino caliente,
// para leer una fila que cambia tres veces al año.
//
// CINCO SEGUNDOS Y NO MÁS: la palanca existe para un incidente y su promesa es
// "apaga en cinco segundos". Una caché larga la convertiría en "apaga cuando
// se enfríen las instancias", que es justo lo que no puede pasar.
//
// LO ILEGIBLE NO SE CACHEA: un bache de red no puede dejar el sistema
// fail-closed cinco segundos más de lo que dura el bache, y sobre todo no
// puede saltarse el grito — cada lectura fallida tiene que alertar.
// `apagar`/`encender` invalidan al vuelo: quien mueve la palanca en ESTA
// instancia la ve aplicada al instante.
const TTL_CACHE_INTERRUPTOR_MS = 5_000;
const cache = new Map<NombreInterruptor, { valor: LecturaInterruptor; hasta: number }>();

// ── LA RACHA ANTES DEL CORREO (incidente 28-ago-2026) ──────────────────────
//
// Esa noche UN TimeoutError aislado leyendo `agente:facturas` mandó un correo
// «Urgente» — y llegó junto a otros cuatro que resultaron falsos. El sistema
// se portó bien (falló cerrado, el runner se saltó al agente y reintentó a la
// vuelta siguiente), así que el correo pedía mirar algo que ya se había
// resuelto solo. Un bache aislado no es un incidente; una RACHA sí: la base
// caída, la llave vencida, el socket que nadie contesta.
//
// Desde entonces el correo espera la MISMA vara que el corte por reloj del
// runner (`cortesSeguidos >= 3`, RES-6): tres lecturas ilegibles CONSECUTIVAS
// —de cualquier interruptor: una pasada del runner lee decenas, y una base
// caída las tumba en fila— y a partir de ahí grita en cada fallo, con el piso
// de una hora de `alertarOperador` limitando los envíos reales. Lo que NO
// cambia: cada lectura ilegible sigue gritando en el log con su código (Sentry
// notifica por causa nueva) y sigue siendo fail-closed. El contador vive por
// instancia (mejor esfuerzo, mismo trato que RES-3/RES-16): la alerta puede
// subcontar entre instancias frías, jamás inventar. Es un `let` propio y no
// el `contadorDeFallos` de alerta.ts a propósito: este módulo se carga en el
// camino caliente del webhook y media docena de suites mockean
// `@/lib/observability/alerta` con solo `alertarOperador` — una dependencia
// nueva en el init del módulo las tumbaría a todas.
export const LECTURAS_ILEGIBLES_PARA_ALERTA = 3;
let lecturasIlegiblesSeguidas = 0;

/** Tira la caché Y la racha de lecturas ilegibles. La llaman `apagar` y
 *  `encender` —que acaban de ESCRIBIR con éxito en la misma base: si la
 *  escritura entró, la base contesta y la racha ya no es racha— y las pruebas. */
export function olvidarInterruptores(): void {
  cache.clear();
  lecturasIlegiblesSeguidas = 0;
}

/**
 * Lee el interruptor y dice una de tres cosas. NUNCA lanza.
 *
 * El camino `ilegible` GRITA con un `codigo` estable de la causa —sin él el
 * fingerprint de Sentry era `['interruptores.lectura_fallo','error']` para
 * todas las causas y, nacido una vez, no volvía a notificar— y manda la
 * alerta al operador por el único canal push del sistema: cinco crons
 * saltándose corridas sobre una base con hipo se ven, en Vercel, como cinco
 * crons verdes sin trabajo.
 */
export async function leerInterruptor(nombre: NombreInterruptor): Promise<LecturaInterruptor> {
  const guardado = cache.get(nombre);
  if (guardado && Date.now() < guardado.hasta) return guardado.valor;
  try {
    // AUDITORÍA 2 (backend): el kill switch es la red de seguridad manual — no
    // puede colgarse. Con `acotada` un socket que Supabase acepta y no contesta
    // corta en el tope (no en el default de undici de 300 s), y el timeout cae
    // por la rama `if (error)` de abajo → fail-closed (apagado). El backstop del
    // cliente (admin.ts) ya lo acotaba a 25 s; esto lo baja al tope de consulta.
    const { data, error } = await acotada(supabaseAdmin()
      .from('interruptor')
      .select('apagado')
      .eq('id', nombre)
      .maybeSingle(), 'estaApagado');
    if (error) {
      await gritarIlegible(nombre, error.message, codigoDeError(error));
      return 'ilegible';
    }
    const lectura: LecturaInterruptor = data?.apagado === true ? 'apagado' : 'encendido';
    // Una lectura fresca que contesta corta la racha: el bache terminó.
    lecturasIlegiblesSeguidas = 0;
    cache.set(nombre, { valor: lectura, hasta: Date.now() + TTL_CACHE_INTERRUPTOR_MS });
    return lectura;
  } catch (e) {
    await gritarIlegible(nombre, e instanceof Error ? e.message : String(e), codigoDeError(e));
    return 'ilegible';
  }
}

/** Se GRITA: el salto por fail-closed no puede pasar desapercibido — un cron
 *  saltándose corridas por una base con hipo se parece demasiado a un cron
 *  sano sin trabajo. SIEMPRE al log con código (Sentry notifica por causa
 *  nueva). El CORREO, en cambio, espera la racha (28-ago-2026): un timeout
 *  aislado se resuelve solo con el reintento del cron y no amerita despertar
 *  a nadie; tres seguidos ya son la base caída o la llave vencida, y entonces
 *  sí sale (`alertarOperador` nunca lanza y ya trae su piso de una hora). */
async function gritarIlegible(nombre: NombreInterruptor, err: string, codigo: string): Promise<void> {
  lecturasIlegiblesSeguidas += 1;
  const lecturasSeguidas = lecturasIlegiblesSeguidas;
  logger.error('interruptores.lectura_fallo', { interruptor: nombre, err, codigo, lecturasSeguidas });
  if (lecturasSeguidas >= LECTURAS_ILEGIBLES_PARA_ALERTA) {
    await alertarOperador('interruptores.lectura_fallo', {
      interruptor: nombre, error: err, codigo, lecturasSeguidas,
    });
  }
}

/**
 * ¿Está apagado este interruptor? SIN FILA = ENCENDIDO (false).
 *
 * FAIL-CLOSED: un error de lectura devuelve `true` (apagado) con log — si no
 * se puede saber si está apagado, no se corre. El porqué completo está en la
 * cabecera del archivo: ejecutar lo que alguien acaba de apagar es el error
 * caro; saltar una corrida que la misma base caída iba a matar es el barato.
 *
 * Quien necesite distinguir "apagado" de "no pude leer" (los crons, para no
 * contestar 200 sobre un fallo) usa `leerInterruptor`.
 */
export async function estaApagado(nombre: NombreInterruptor): Promise<boolean> {
  return (await leerInterruptor(nombre)) !== 'encendido';
}

/**
 * Apaga un interruptor. El MOTIVO es obligatorio y no vacío (el CHECK de la
 * 0110 lo rebota igual en la base; validarlo aquí da el mensaje que la
 * pantalla puede enseñar). LANZA si la escritura falla: un "apagué" que no
 * apagó es el peor resultado posible de esta función.
 */
export async function apagar(nombre: string, motivo: string, userId: string): Promise<void> {
  if (!esNombreValido(nombre)) {
    throw new DatoInvalido(`"${nombre}" no es un interruptor del catálogo.`);
  }
  const m = motivo.trim();
  if (!m) {
    throw new DatoInvalido('Apagar exige un motivo: sin nota, en tres semanas nadie sabe si ya se puede encender.');
  }
  const { error } = await acotada(supabaseAdmin()
    .from('interruptor')
    .upsert(
      { id: nombre, apagado: true, motivo: m, cambiado_por: userId, cambiado_en: new Date().toISOString() },
      { onConflict: 'id' },
    ), 'apagar');
  if (error) throw new Error(`apagar(${nombre}): ${error.message}`);
  olvidarInterruptores();
  await anotarEnBitacora('interruptor.apagado', nombre, userId, { motivo: m });
}

/**
 * Enciende un interruptor (vuelve al default). El motivo del apagón anterior
 * se limpia: la fila dice el estado VIGENTE; el historial vive en la
 * bitácora. LANZA si la escritura falla, por la misma razón que `apagar`.
 */
export async function encender(nombre: string, userId: string): Promise<void> {
  if (!esNombreValido(nombre)) {
    throw new DatoInvalido(`"${nombre}" no es un interruptor del catálogo.`);
  }
  const { error } = await acotada(supabaseAdmin()
    .from('interruptor')
    .upsert(
      { id: nombre, apagado: false, motivo: null, cambiado_por: userId, cambiado_en: new Date().toISOString() },
      { onConflict: 'id' },
    ), 'encender');
  if (error) throw new Error(`encender(${nombre}): ${error.message}`);
  olvidarInterruptores();
  await anotarEnBitacora('interruptor.encendido', nombre, userId, {});
}

/**
 * El estado de TODOS los interruptores del catálogo, con los que no tienen
 * fila en su estado default (encendidos). LANZA ante un error de lectura:
 * esta lista es de PANEL, y pintar "todo encendido" sobre una base caída
 * afirmaría que nada está apagado sin haber podido mirar.
 *
 * Sin paginar a propósito: la tabla tiene a lo sumo las filas del catálogo
 * (el CHECK del dominio lo garantiza).
 */
export async function listarInterruptores(): Promise<EstadoInterruptor[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('interruptor')
    .select('id, apagado, motivo, cambiado_por, cambiado_en'), 'listarInterruptores');
  if (error) throw new Error(`listarInterruptores: ${error.message}`);

  const filas = new Map<string, Record<string, unknown>>();
  for (const f of (data ?? []) as Array<Record<string, unknown>>) {
    filas.set(String(f.id), f);
  }

  // "Quién" con nombre, no con uuid. Una sola consulta por el conjunto; si
  // falla, la lista sale igual con el uuid — el nombre es cortesía, el estado
  // de la palanca es el dato.
  const actores = [...new Set(
    [...filas.values()].map((f) => f.cambiado_por as string | null).filter((v): v is string => v !== null),
  )];
  const nombrePorId = new Map<string, string>();
  if (actores.length > 0) {
    const { data: usuarios, error: errUsuarios } = await acotada(supabaseAdmin()
      .from('app_user')
      .select('id, nombre, email')
      .in('id', actores), 'listarInterruptores.actores');
    if (errUsuarios) {
      logger.warn('interruptores.actores_sin_nombre', { err: errUsuarios.message });
    } else {
      for (const u of (usuarios ?? []) as Array<Record<string, unknown>>) {
        nombrePorId.set(String(u.id), String(u.nombre ?? u.email ?? ''));
      }
    }
  }

  return INTERRUPTORES.map((id): EstadoInterruptor => {
    const f = filas.get(id);
    if (!f) {
      return { id, apagado: false, motivo: null, cambiadoPor: null, cambiadoPorNombre: null, cambiadoEn: null };
    }
    const cambiadoPor = (f.cambiado_por as string | null) ?? null;
    return {
      id,
      apagado: f.apagado === true,
      motivo: (f.motivo as string | null) ?? null,
      cambiadoPor,
      cambiadoPorNombre: cambiadoPor ? (nombrePorId.get(cambiadoPor) ?? null) : null,
      cambiadoEn: (f.cambiado_en as string | null) ?? null,
    };
  });
}

/**
 * Cada toque de palanca queda en `bitacora_auditoria` (0053) — es el
 * historial que la fila no guarda. Best-effort A PROPÓSITO (mismo criterio
 * que `anotar` en administracion.ts): el interruptor YA se movió; tirar el
 * apagado de un agente porque la bitácora no pudo escribir dejaría al agente
 * corriendo en pleno incidente. El fallo se loguea para que no muera en
 * silencio.
 */
async function anotarEnBitacora(
  accion: 'interruptor.apagado' | 'interruptor.encendido',
  nombre: string,
  userId: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  await anotarBitacora(
    { tenantId: null, // la palanca es de PLATAFORMA, no de una flota
      actor: { id: userId }, accion, entidad: 'interruptor', entidadId: nombre, detalle },
    { evento: 'interruptores.bitacora_no_escribio', contexto: { interruptor: nombre } },
  );
}
