import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { acotada } from '@/lib/likida/presupuesto';
import { DatoInvalido } from '@/lib/likida/errores';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { generarLlave } from './llave-api';
import type { Area } from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// EMISIÓN, LISTA Y REVOCACIÓN DE LLAVES — el camino FRÍO del panel.
//
// Vive aparte de `llave-api.ts` a propósito: aquel es el camino caliente
// (`resolverLlave` corre en CADA petición de /v1) y este corre unas cuantas
// veces en la vida de una flota, desde /dashboard/llaves-api. Separados, un
// cambio en la pantalla no puede desestabilizar lo que autentica cada llamada,
// y las pruebas de escritura pueden mockear Supabase sin tocar las de las
// funciones puras.
//
// Hasta este archivo (hallazgo A6, auditoría 4), `tenant_api_key` no tenía un
// solo INSERT en src/: el openapi prometía "la llave se emite desde el panel"
// y `POST /v1` exigía una llave de área `administracion` que nadie podía
// emitir. La API de escritura entera era inalcanzable.
//
// La regla de la 0093 se sostiene aquí también: LA LLAVE EN CLARO NO SE
// GUARDA. `crearLlaveApi` la devuelve UNA vez para que la pantalla la enseñe,
// y al INSERT solo van el hash y el prefijo.
// ═══════════════════════════════════════════════════════════════════════════

/** Suficiente para "TMS propio (staging)"; más largo ya no es un nombre. */
const MAX_NOMBRE = 80;

export interface OpcionArea {
  valor: Area;
  rotulo: string;
  detalle: string;
}

/**
 * El catálogo que la forma enseña en el select, con la jerarquía DICHA.
 *
 * Es el mismo dominio que el CHECK `tenant_api_key_area_dominio` (0093) y que
 * `areaDeLlaveAlcanza` (api/v1/_comun.ts): un área alcanza la suya y las de
 * abajo, y solo `administracion` puede escribir por POST. Viaja a la forma
 * como PROP, no como import: `forma.tsx` solo puede importar TIPOS de este
 * módulo, porque arrastra `supabaseAdmin`.
 */
export const AREAS_DE_LLAVE: readonly OpcionArea[] = [
  { valor: 'operacion', rotulo: 'Operación', detalle: 'Lee viajes y unidades. No devuelve un peso.' },
  { valor: 'dinero', rotulo: 'Dinero', detalle: 'Lo de operación, más contribución por viaje y clientes.' },
  { valor: 'administracion', rotulo: 'Administración', detalle: 'Lee todo, y es la única que puede escribir (POST de viajes y unidades).' },
];

function esAreaDeLlave(v: string): v is Area {
  return AREAS_DE_LLAVE.some((a) => a.valor === v);
}

/**
 * Deja constancia en la bitácora. Best-effort A PROPÓSITO, igual que en
 * `clientes.ts` y `administracion.ts`: si la bitácora falla, la llave YA se
 * emitió o revocó, y tirar la operación dejaría el sistema peor que sin el
 * registro. Importa sobre todo en REVOCAR: `creada_por` es columna de la
 * tabla, pero quién revocó no tiene columna — esta es su única memoria.
 */
async function anotar(
  tenantId: string,
  accion: string,
  entidadId: string,
  detalle: Record<string, unknown>,
  actorId?: string,
): Promise<void> {
  await anotarBitacora(
    { tenantId, actor: { id: actorId }, accion, entidad: 'tenant_api_key', entidadId, detalle },
    { evento: 'llave_api.bitacora_no_escribio' },
  );
}

export interface LlaveEmitida {
  id: string;
  /** La llave COMPLETA. Se devuelve UNA vez y no queda guardada en ningún
   *  lado: perderla es revocarla y emitir otra. */
  enClaro: string;
  prefijo: string;
}

/**
 * Emite una llave nueva para la flota.
 *
 * El `tenantId` viene por argumento desde la sesión del servidor, NUNCA del
 * formulario (misma regla que toda escritura del panel). Al INSERT van el
 * hash y el prefijo; `enClaro` solo se devuelve — el CHECK de la 0093
 * (64 hex) haría fallar el insert si alguien intentara guardarla.
 */
export async function crearLlaveApi(
  tenantId: string,
  datos: { nombre: string; area: string },
  creadaPor?: string,
): Promise<LlaveEmitida> {
  const nombre = datos.nombre.trim();
  if (nombre.length === 0) {
    // El mismo porqué que el constraint `nombre_no_vacio` de la 0093: una
    // lista de hashes sin nombre es indistinguible y nadie se atreve a
    // revocar ninguna.
    throw new DatoInvalido('Ponle un nombre que diga quién la usa — "TMS propio", "tablero de Tableau". Sin nombre no vas a saber cuál revocar.');
  }
  if (nombre.length > MAX_NOMBRE) {
    throw new DatoInvalido(`El nombre de la llave no puede pasar de ${MAX_NOMBRE} caracteres.`);
  }
  if (!esAreaDeLlave(datos.area)) {
    throw new DatoInvalido('Esa área no existe: elige operación, dinero o administración.');
  }

  const llave = generarLlave();
  const { data, error } = await acotada(supabaseAdmin().from('tenant_api_key').insert({
    tenant_id: tenantId,
    nombre,
    prefijo: llave.prefijo,
    // SOLO el SHA-256. `llave.enClaro` no entra a esta fila ni a ninguna.
    hash: llave.hash,
    area: datos.area,
    creada_por: creadaPor ?? null,
  }).select('id').single(), 'crearLlaveApi');

  if (error) throw new Error(`crearLlaveApi: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearLlaveApi: el insert no devolvió id');

  await anotar(tenantId, 'llave_api.creada', String(id), {
    // El prefijo es la pista pública; ni el hash ni la llave van a la bitácora.
    nombre, area: datos.area, prefijo: llave.prefijo,
  }, creadaPor);

  return { id: String(id), enClaro: llave.enClaro, prefijo: llave.prefijo };
}

/**
 * Revoca una llave: sella `revocada_en`, NO borra (la 0093 conserva el
 * renglón para poder auditar qué llave leyó qué).
 *
 * El UPDATE va anclado a `tenant_id` Y comprueba las filas devueltas: con el
 * id de una llave de OTRA flota —o una ya revocada— toca cero filas, y
 * Postgres no considera eso un error. Sin mirar el `.select()`, la pantalla
 * diría "revocada" sobre una llave que sigue viva (patrón `editarCliente`).
 */
export async function revocarLlaveApi(
  tenantId: string,
  llaveId: string,
  revocadaPor?: string,
): Promise<void> {
  if (!esUuidValido(llaveId)) throw new DatoInvalido('No se reconoce esa llave. Vuelve a abrir la pantalla.');

  const { data, error } = await acotada(supabaseAdmin().from('tenant_api_key')
    .update({ revocada_en: new Date().toISOString() })
    .eq('id', llaveId)
    .eq('tenant_id', tenantId)
    // Revocar dos veces no es idempotencia inocente: pisaría el sello
    // original y la auditoría de "¿desde cuándo dejó de valer?" mentiría.
    .is('revocada_en', null)
    .select('id'), 'revocarLlaveApi');

  if (error) throw new Error(`revocarLlaveApi: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa llave no está viva en tu flota. Puede que ya estuviera revocada — recarga la pantalla.');
  }

  await anotar(tenantId, 'llave_api.revocada', llaveId, {}, revocadaPor);
}

export interface LlaveListada {
  id: string;
  nombre: string;
  /** La pista pública (`lk_live_` + 6). Lo único de la llave que se enseña. */
  prefijo: string;
  area: string;
  creadaEn: string;
  /** `null` = nunca se ha usado. La pantalla lo dice así, no con un guion. */
  ultimoUsoEn: string | null;
  revocadaEn: string | null;
}

/**
 * Las llaves de la flota, nuevas primero. Las revocadas VIENEN: ocultarlas
 * borraría de la pantalla la evidencia de qué se revocó y cuándo.
 *
 * Un error de lectura LANZA en vez de devolver `[]`: una base caída que se
 * pintara como "no tienes llaves" invitaría a emitir duplicados de todas.
 * Sin `traerTodo`: PostgREST recorta a 1,000 filas y ninguna flota emite
 * 1,000 llaves — si un día pasa, las más nuevas siguen siendo las visibles.
 */
export async function listarLlavesApi(tenantId: string): Promise<LlaveListada[]> {
  const { data, error } = await acotada(supabaseAdmin().from('tenant_api_key')
    .select('id, nombre, prefijo, area, creada_en, ultimo_uso_en, revocada_en')
    .eq('tenant_id', tenantId)
    .order('creada_en', { ascending: false }), 'listarLlavesApi');

  if (error) throw new Error(`listarLlavesApi: ${error.message}`);

  return (data ?? []).map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    prefijo: String(f.prefijo),
    area: String(f.area),
    creadaEn: String(f.creada_en),
    ultimoUsoEn: f.ultimo_uso_en == null ? null : String(f.ultimo_uso_en),
    revocadaEn: f.revocada_en == null ? null : String(f.revocada_en),
  }));
}
