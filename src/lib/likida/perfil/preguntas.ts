// ═══════════════════════════════════════════════════════════════════════════
// EL PUNTO ÚNICO DEL PERFIL — FASE 3 (docs/perfil/PERFIL-OPERATIVO.md).
//
// Este módulo EXPONE DECISIONES, NO CAMPOS. Nada de `Perfil`, `CampoPerfil`
// ni `Procedencia` se exporta: quien necesita saber algo del cliente llama
// una función con nombre de decisión (`calificaEstimuloPeaje`) y le pasa el
// jsonb crudo de `tenant.perfil` — nunca importa el tipo ni construye un
// `Perfil` a mano. Eso es lo que hace el candado un MECANISMO: un agente que
// quisiera leer `perfil.ingresosAnualesMxn` directamente no puede, porque el
// campo no existe fuera de este archivo.
//
// EL CANDADO REAL vive en `decidir()`: nunca acepta un campo con procedencia
// `'inferido'`. Lo inferido (Mitad A de PERFIL-OPERATIVO.md — modalidad de
// compra de diésel, doble captura…) se recalcula cada mes y se MUESTRA al
// cliente; nunca se persiste como hecho, así que nunca llega aquí con esa
// procedencia salvo que alguien se salte el mecanismo de escritura. Un
// agente que quiera actuar sobre una inferencia tiene que llamar una
// función que no existe.
//
// PRIMER CAMPO REAL: ingresos anuales + parte relacionada, para el hueco
// fiscal MÁS CARO de los tres que cierra esta fase (docs/asistencia/PLAN-
// FASES.md, Fase 3): `estimulos.peajeFactor = 0.5` (config.ts:127) se aplica
// HOY sin condición, pero LIF 2026 art. 20-A (normas/lif-2026-20-A.yaml,
// hallazgo H6, verificado_fuente_primaria) exige ingresos < $300M y NO ser
// parte relacionada (LISR art. 179). Una flota grande está recibiendo un
// estímulo que no le toca.
// ═══════════════════════════════════════════════════════════════════════════

type Procedencia = 'declarado' | 'detectado' | 'inferido' | 'default' | 'ausente';

interface CampoPerfil<T> {
  valor: T;
  procedencia: Procedencia;
}

interface Perfil {
  ingresosAnualesMxn?: CampoPerfil<number>;
  parteRelacionada?: CampoPerfil<boolean>;
}

/** El candado: NUNCA decide sobre un campo inferido. Ausente o inferido dan
 *  lo mismo hacia afuera — `undefined` — porque una decisión no puede
 *  distinguir "no sé" de "no confío en la inferencia": las dos exigen la
 *  misma conducta, que es no afirmar. */
function decidir<T>(campo: CampoPerfil<T> | undefined): T | undefined {
  if (!campo || campo.procedencia === 'inferido' || campo.procedencia === 'ausente') return undefined;
  return campo.valor;
}

/** Para una UI de cuestionario: el valor si ya se sabe, o la pregunta que
 *  habría que hacer si no. A diferencia de `decidir()`, SÍ deja ver un valor
 *  inferido — como sugerencia a confirmar, nunca como hecho para actuar. */
function sugerir<T>(campo: CampoPerfil<T> | undefined, pregunta: string): { valor: T | undefined; pregunta: string | undefined } {
  const decidido = decidir(campo);
  if (decidido !== undefined) return { valor: decidido, pregunta: undefined };
  return { valor: campo?.valor, pregunta };
}

/** Lee `tenant.perfil` (jsonb crudo de la base) como `Perfil`, tolerante a
 *  cualquier forma inesperada — un perfil ausente o corrupto se trata como
 *  vacío, nunca lanza. Fail-closed en el CONTENIDO (decidir() igual no va a
 *  afirmar nada sin procedencia buena), no en la lectura. */
function leerPerfil(perfilCrudo: unknown): Perfil {
  if (!perfilCrudo || typeof perfilCrudo !== 'object') return {};
  return perfilCrudo as Perfil;
}

export const PREGUNTA_ESTIMULO_PEAJE =
  '¿Cuáles fueron los ingresos totales anuales de la flota en el último ejercicio, y es parte relacionada de otra empresa (LISR art. 179)? De eso depende si aplica el estímulo de peaje del 50% (LIF 2026 art. 20-A).';

export interface ElegibilidadEstimuloPeaje {
  /** `null` = el perfil todavía no lo declara — NO se le quita el estímulo
   *  a nadie por default; sigue aplicando con el aviso de siempre
   *  (`CONDICIONES_ESTIMULO_PEAJE`, liquidacion/acreditable.ts). Fail-OPEN
   *  con aviso, no fail-closed: esa ya era la conducta documentada antes de
   *  esta fase, y quitarle un estímulo real a quien no ha contestado sería
   *  peor que el hueco que esto cierra. */
  elegible: boolean | null;
}

/**
 * ¿Esta flota califica para el estímulo de peaje? Ver el encabezado del
 * archivo. `perfilCrudo` es `tenant.perfil` tal cual sale de la base —
 * quien llama nunca necesita saber su forma interna.
 */
export function calificaEstimuloPeaje(perfilCrudo: unknown): ElegibilidadEstimuloPeaje {
  const perfil = leerPerfil(perfilCrudo);
  const ingresos = decidir(perfil.ingresosAnualesMxn);
  const parteRelacionada = decidir(perfil.parteRelacionada);
  if (ingresos === undefined || parteRelacionada === undefined) return { elegible: null };
  return { elegible: ingresos < 300_000_000 && !parteRelacionada };
}

/** Para una futura UI de cuestionario: la pregunta pendiente, o `null` si ya
 *  se sabe. Usa `sugerir()` (no `decidir()`) a propósito: aquí SÍ importa
 *  distinguir "ya se preguntó y no se sabe" (sigue pendiente) de "hay un
 *  valor inferido que convendría confirmar" — un cuestionario que ignore la
 *  pista inferida le hace repetir al cliente un dato que el sistema ya
 *  detectó con evidencia razonable. */
export function preguntaPendienteEstimuloPeaje(perfilCrudo: unknown): string | null {
  const perfil = leerPerfil(perfilCrudo);
  const ingresos = sugerir(perfil.ingresosAnualesMxn, PREGUNTA_ESTIMULO_PEAJE);
  const parteRelacionada = sugerir(perfil.parteRelacionada, PREGUNTA_ESTIMULO_PEAJE);
  return ingresos.pregunta ?? parteRelacionada.pregunta ?? null;
}

/**
 * El patch de `tenant.perfil` para declarar la respuesta — quien llama
 * hace `{...perfilActual, ...declararIngresosYParteRelacionada(...)}` y
 * guarda el resultado. Puro: no toca la base (eso lo hace quien la llame,
 * junto con `perfil_actualizado_por` en el mismo UPDATE — ver migración
 * 0169, el trigger que sella el historial).
 */
export function declararIngresosYParteRelacionada(ingresosAnualesMxn: number, parteRelacionada: boolean): Record<string, unknown> {
  const campo = <T,>(valor: T): CampoPerfil<T> => ({ valor, procedencia: 'declarado' });
  return {
    ingresosAnualesMxn: campo(ingresosAnualesMxn),
    parteRelacionada: campo(parteRelacionada),
  };
}
