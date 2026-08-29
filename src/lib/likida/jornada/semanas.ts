// ═══════════════════════════════════════════════════════════════════════════
// LAS SEMANAS COMPLETAS DE LA VENTANA — el pegamento puro entre lo que la
// pantalla ya lee (expedientes por día) y `evaluarRiesgoSemana`.
//
// El hueco que esto cierra (inventario código→pantalla, 28-ago-2026,
// prioridad 3): `evaluarRiesgoSemana`, el tope semanal por año del Transitorio
// Segundo, el día de descanso del art. 69 y `horas_min_entre_jornadas` estaban
// escritos, probados y SIN UN SOLO LLAMADOR — /dashboard/jornada resumía por
// día y nunca decía si la semana rebasó las 48 h. El campo
// `horas_min_entre_jornadas` de la política era capturable y muerto: se
// guardaba y no producía señal en ninguna parte, porque solo lo evalúa la
// función que nadie llamaba.
//
// LAS DOS REGLAS DE ESTA COMPOSICIÓN:
//
// 1. SOLO SEMANAS ENTERAS (lunes a domingo, completas dentro de la ventana
//    visible). El tope del Transitorio es semanal: evaluar media semana daría
//    siempre un total menor al real — un falso «va bien» construido con el
//    recorte, que es exactamente lo que `evaluarRiesgoSemana` se niega a hacer
//    con los huecos, aplicado al calendario.
//
// 2. UN DÍA SIN EXPEDIENTE NO SON CERO HORAS. Los días de la semana sin fila
//    en `jornada_dia` entran como jornada VACÍA (`componerJornada([])`,
//    minutos null): la semana se niega a concluir (`dato_insuficiente`) y la
//    pantalla dice cuáles días faltan. Tratarlos como 0 h habría «aprobado»
//    todas las semanas con huecos.
// ═══════════════════════════════════════════════════════════════════════════

import { componerJornada, type JornadaCompuesta } from './modelo';
import {
  evaluarRiesgoSemana,
  type PoliticaFlota, type RiesgoSemana, type DiaDeSemana,
} from './riesgo';

export interface EntradaDiaSemana {
  operadorId: string;
  operadorNombre: string;
  /** AAAA-MM-DD, día de México. */
  dia: string;
  jornada: JornadaCompuesta;
}

export interface SemanaEvaluada {
  operadorId: string;
  operadorNombre: string;
  /** El lunes, AAAA-MM-DD. */
  desde: string;
  /** El domingo, AAAA-MM-DD. */
  hasta: string;
  /** Días de la semana SIN expediente en `jornada_dia`. No son cero horas:
   *  son la razón por la que el veredicto puede venir `dato_insuficiente`. */
  diasSinExpediente: string[];
  riesgo: RiesgoSemana;
}

const DIA_MS = 86_400_000;

function utc(dia: string): number {
  return Date.parse(`${dia}T00:00:00Z`);
}
function fecha(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** El lunes de la semana de `dia` (calendario, no ISO-numérico: aquí solo
 *  importa agrupar de lunes a domingo). Puro sobre el string AAAA-MM-DD. */
export function lunesDe(dia: string): string {
  const ms = utc(dia);
  const dow = new Date(ms).getUTCDay(); // 0=domingo … 6=sábado
  return fecha(ms - ((dow + 6) % 7) * DIA_MS);
}

/**
 * Evalúa cada (operador × semana completa) de la ventana visible.
 *
 * Solo se evalúan semanas donde el operador tiene AL MENOS un expediente: una
 * semana enteramente vacía ya está contada día a día como «sin registro
 * declarado», y repetirla aquí por cada operador sería ruido sin señal.
 */
export function evaluarSemanas(
  entradas: readonly EntradaDiaSemana[],
  politica: PoliticaFlota | null,
  desde: string,
  hasta: string,
): SemanaEvaluada[] {
  // (operadorId → dia → jornada) + el nombre visto (el catálogo ya lo resolvió
  // la pantalla; aquí no se inventa ni se re-consulta).
  const porOperador = new Map<string, { nombre: string; dias: Map<string, JornadaCompuesta> }>();
  for (const e of entradas) {
    const o = porOperador.get(e.operadorId) ?? { nombre: e.operadorNombre, dias: new Map() };
    o.dias.set(e.dia, e.jornada);
    porOperador.set(e.operadorId, o);
  }

  // Los lunes de las semanas COMPLETAS dentro de [desde, hasta].
  const lunes: string[] = [];
  const primerLunesMs = (() => {
    const l = lunesDe(desde);
    return l >= desde ? utc(l) : utc(l) + 7 * DIA_MS;
  })();
  for (let m = primerLunesMs; fecha(m + 6 * DIA_MS) <= hasta; m += 7 * DIA_MS) {
    lunes.push(fecha(m));
  }

  const vacia = componerJornada([]);
  const salida: SemanaEvaluada[] = [];
  for (const [operadorId, o] of porOperador) {
    for (const l of lunes) {
      const inicioMs = utc(l);
      const dias: DiaDeSemana[] = [];
      const sinExpediente: string[] = [];
      let conExpediente = 0;
      for (let i = 0; i < 7; i++) {
        const dia = fecha(inicioMs + i * DIA_MS);
        const j = o.dias.get(dia);
        if (j) conExpediente += 1;
        else sinExpediente.push(dia);
        dias.push({ dia, jornada: j ?? vacia });
      }
      if (conExpediente === 0) continue;
      salida.push({
        operadorId,
        operadorNombre: o.nombre,
        desde: l,
        hasta: fecha(inicioMs + 6 * DIA_MS),
        diasSinExpediente: sinExpediente,
        riesgo: evaluarRiesgoSemana(dias, politica),
      });
    }
  }

  // Orden estable para la pantalla: por nombre, luego por semana — dos cargas
  // seguidas pintan la misma lista (regla del repo: nada de listas que bailan).
  return salida.sort((a, b) =>
    a.operadorNombre.localeCompare(b.operadorNombre) || a.desde.localeCompare(b.desde) || a.operadorId.localeCompare(b.operadorId));
}
