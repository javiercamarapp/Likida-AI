// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DEL DESGLOSE POR CORREO: «qué pasó · qué significa · qué hacer» (T-A1-31).
//
// Puro y determinista: recibe conteos ya medidos de un periodo (los de `repo_correo.contarParaInsights` más los que la pantalla
// ya conoce) y devuelve frases. NO hay modelo de lenguaje en este cálculo: la IA puede explicar, pero no decide.
//
// Reglas de honestidad que las pruebas fijan:
//   · un conteo `null` es «no se pudo medir», nunca un cero: la regla que lo necesita no se dice;
//   · «sin captura manual» se afirma solo si el origen de TODAS las entregas se conoce y ninguna vino de captura;
//   · el ahorro de tiempo solo se calcula con la línea base declarada por la flota; sin ella se dice «sin línea base»;
//   · toda cifra lleva su `fuente`, y lo estimado se rotula «calculado por Likida».
// ═══════════════════════════════════════════════════════════════════════════

import type { ConteoInsights } from './repo_correo';

export type TonoInsightA1 = 'ok' | 'warn' | 'bad' | 'muted';

/** Tipo local mientras el frente de insights no publique uno común; `aInsightComun` es el adaptador trivial. */
export interface InsightA1 {
  id: string;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
  /** De dónde sale la cifra; lo estimado empieza con «Calculado por Likida». */
  fuente: string;
  tono: TonoInsightA1;
}

export interface TerminalInsights { terminal: string; desgloses: number; rebotados: number }

/** Cómo llegó cada desglose: del sistema de la flota (pull), de un archivo importado (plan B) o capturado a mano. */
export interface OrigenDesgloses { pull: number; importado: number; captura: number }

export interface LineaBaseA1 { minutosPorDesglose: number; personas: number }

export interface EntradaInsightsA1 {
  /** Rótulo del periodo para la fuente, p. ej. «últimos 30 días». */
  periodo: string;
  /** Bitácoras con póliza recibidas en el periodo (= desgloses). `null` = no medido. */
  desgloses: number | null;
  entregados: number | null;
  enviados: number | null;
  rebotados: number | null;
  retenidos: number | null;
  sinPoliza: number | null;
  /** Antigüedad en días de la bitácora que más lleva esperando póliza. */
  sinPolizaAntiguedadDias?: number | null;
  operadorSinCorreo?: number | null;
  correccionPendiente?: number | null;
  origen?: OrigenDesgloses | null;
  /** Minutos desde la medianoche (hora de México) de la mediana de envío y de la de entrada de la bitácora. */
  medianaEnvioMin?: number | null;
  medianaEntradaMin?: number | null;
  porTerminal?: TerminalInsights[] | null;
  lineaBase?: LineaBaseA1 | null;
}

const num = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const pos = (n: number | null | undefined): n is number => num(n) && n > 0;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const hhmm = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const duracion = (min: number): string => {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
};

const ORDEN_TONO: Record<TonoInsightA1, number> = { bad: 0, warn: 1, ok: 2, muted: 3 };

export const TEXTO_SIN_DATOS = 'Aún sin desgloses este periodo';

/** Los insights del periodo, del más urgente al menos. Lista vacía nunca: sin nada que decir, lo dice. */
export function calcularInsightsA1(e: EntradaInsightsA1): InsightA1[] {
  const fuente = `Likida: entregas por correo, ${e.periodo}`;
  const out: InsightA1[] = [];

  const medidos = [e.desgloses, e.entregados, e.enviados, e.rebotados, e.retenidos, e.sinPoliza];
  if (medidos.every((n) => !num(n))) {
    return [{
      id: 'sin_medir', quePaso: 'No se pudieron leer los desgloses ahora', queSignifica: 'No es que no haya: no pudimos consultarlos',
      queHacer: 'Recarga la pantalla en unos minutos', fuente, tono: 'muted',
    }];
  }
  if (medidos.every((n) => !pos(n)) && !pos(e.operadorSinCorreo) && !pos(e.correccionPendiente)) {
    return [{
      id: 'sin_datos', quePaso: TEXTO_SIN_DATOS, queSignifica: 'Todavía no llegó ninguna bitácora con póliza',
      queHacer: 'Los desgloses aparecen aquí cuando una bitácora tiene póliza', fuente, tono: 'muted',
    }];
  }

  // Cobertura: de lo que llegó con póliza, cuánto ya está en el buzón del destinatario.
  if (pos(e.desgloses) && num(e.entregados)) {
    const entregados = Math.min(e.entregados, e.desgloses);
    const pct = Math.round((entregados / e.desgloses) * 100);
    const completo = entregados === e.desgloses;
    out.push({
      id: 'cobertura', tono: completo ? 'ok' : 'warn', fuente,
      quePaso: `${entregados} de ${plural(e.desgloses, 'desglose', 'desgloses')} ya llegó al buzón (${pct} %)`,
      queSignifica: completo ? 'Todos los operadores con póliza recibieron su desglose' : 'Hay desgloses que todavía no confirman entrega',
      queHacer: completo ? 'Nada pendiente' : 'Revisa los enviados sin confirmar y los rebotados en la lista',
    });
  }

  if (pos(e.rebotados)) {
    out.push({
      id: 'rebotes', tono: 'bad', fuente,
      quePaso: `${e.rebotados} ${e.rebotados === 1 ? 'correo rebotó' : 'correos rebotaron'}`,
      queSignifica: 'Algunos operadores no recibieron su desglose',
      queHacer: 'Corrige el correo en la pantalla y reenvía',
    });
  }

  if (pos(e.sinPoliza)) {
    const edad = pos(e.sinPolizaAntiguedadDias) ? `; la más antigua espera desde hace ${plural(Math.round(e.sinPolizaAntiguedadDias), 'día', 'días')}` : '';
    out.push({
      id: 'sin_poliza', tono: 'bad', fuente,
      quePaso: `${e.sinPoliza === 1 ? '1 bitácora no se enviará' : `${e.sinPoliza} bitácoras no se enviarán`} hasta tener póliza${edad}`,
      queSignifica: 'Sin póliza no hay desglose que mandar',
      queHacer: 'Revisa en el TMS',
    });
  }

  if (pos(e.retenidos)) {
    out.push({
      id: 'retenidos', tono: 'warn', fuente,
      quePaso: e.retenidos === 1 ? '1 desglose está retenido' : `${e.retenidos} desgloses están retenidos`,
      queSignifica: 'No salieron a nadie mientras una persona no los revise',
      queHacer: 'Abre el detalle, revisa el motivo y libera el envío',
    });
  }

  if (pos(e.operadorSinCorreo)) {
    out.push({
      id: 'operador_sin_correo', tono: 'warn', fuente,
      quePaso: `${plural(e.operadorSinCorreo, 'operador no tiene', 'operadores no tienen')} correo registrado`,
      queSignifica: 'Su desglose no tiene a dónde ir',
      queHacer: 'Agrega el correo (o sube el CSV de correos) y reenvía',
    });
  }

  if (pos(e.correccionPendiente)) {
    out.push({
      id: 'correccion_pendiente', tono: 'warn', fuente,
      quePaso: `${plural(e.correccionPendiente, 'operador pidió', 'operadores pidieron')} una corrección`,
      queSignifica: 'Su desglose puede estar mal y sigue abierto',
      queHacer: 'Revisa las excepciones y corrige en el sistema de tu empresa',
    });
  }

  // Sin captura manual: se afirma solo con el origen conocido de TODAS las entregas.
  const o = e.origen;
  if (o && pos(o.pull + o.importado + o.captura)) {
    const total = o.pull + o.importado + o.captura;
    const pct = Math.round(((o.pull + o.importado) / total) * 100);
    if (o.captura === 0) {
      const soloArchivo = o.pull === 0;
      out.push({
        id: 'sin_captura', tono: soloArchivo ? 'warn' : 'ok', fuente,
        quePaso: soloArchivo ? `${pct} % sin captura manual, pero todo llegó por archivo` : `${pct} % sin captura manual`,
        queSignifica: soloArchivo ? 'Nadie capturó a mano, aunque ningún desglose vino directo del sistema de tu empresa' : 'Ningún desglose se capturó a mano',
        queHacer: soloArchivo ? 'Conecta el sistema de tu empresa para que lleguen solos' : 'Nada pendiente',
      });
    } else {
      out.push({
        id: 'sin_captura', tono: 'warn', fuente,
        quePaso: `${pct} % sin captura manual (${plural(o.captura, 'desglose capturado', 'desgloses capturados')} a mano)`,
        queSignifica: 'Todavía hay desgloses que dependen de una persona',
        queHacer: 'Busca por qué esas bitácoras no llegaron solas',
      });
    }
  } else {
    out.push({
      id: 'sin_captura', tono: 'muted', fuente,
      quePaso: 'No se puede afirmar «sin captura manual»', queSignifica: 'Falta saber cómo llegó cada desglose',
      queHacer: 'Se afirma cuando el origen de todos esté registrado',
    });
  }

  // Hora: cuánto tarda en salir el desglose desde que entra la bitácora (estimado).
  if (num(e.medianaEnvioMin) && num(e.medianaEntradaMin)) {
    const espera = e.medianaEnvioMin - e.medianaEntradaMin;
    out.push({
      id: 'hora_envio', tono: 'muted', fuente: `Calculado por Likida: medianas de ${e.periodo}`,
      quePaso: `La mitad de los desgloses sale antes de las ${hhmm(e.medianaEnvioMin)} y las bitácoras entran hacia las ${hhmm(e.medianaEntradaMin)}`,
      queSignifica: espera >= 0 ? `Un desglose tarda ${duracion(espera)} en salir desde que entra su bitácora` : 'El envío sale antes de la hora típica de entrada: revisa los datos de origen',
      queHacer: 'Compáralo con la hora a la que hoy llega el Excel manual',
    });
  }

  // Por terminal: dónde se concentran los rebotes.
  const terminales = (e.porTerminal ?? []).filter((t) => t.desgloses > 0);
  if (terminales.length >= 2 && pos(e.rebotados)) {
    const peor = [...terminales].sort((a, b) => b.rebotados - a.rebotados || a.terminal.localeCompare(b.terminal))[0];
    if (peor.rebotados > 0) {
      out.push({
        id: 'terminal', tono: 'warn', fuente,
        quePaso: `${peor.terminal} concentra ${peor.rebotados} de ${e.rebotados} rebotes (${plural(peor.desgloses, 'desglose', 'desgloses')} en total)`,
        queSignifica: 'Los correos de esa terminal probablemente tienen un error de captura',
        queHacer: 'Empieza por revisar los correos de esa terminal',
      });
    }
  }

  // Ahorro de tiempo: solo con la línea base declarada.
  const lb = e.lineaBase;
  if (lb && lb.minutosPorDesglose > 0 && lb.personas > 0 && pos(e.desgloses)) {
    const horas = (e.desgloses * lb.minutosPorDesglose) / 60;
    out.push({
      id: 'ahorro', tono: 'ok', fuente: `Calculado por Likida con la línea base declarada (${lb.minutosPorDesglose} min por desglose, ${plural(lb.personas, 'persona', 'personas')})`,
      quePaso: `${plural(e.desgloses, 'desglose', 'desgloses')} sin armarse a mano: unas ${Math.round(horas * 10) / 10} h de trabajo`,
      queSignifica: 'Es tiempo que la persona que arma el Excel ya no gasta en esos desgloses',
      queHacer: 'Confirma la línea base con la flota cada trimestre',
    });
  } else {
    out.push({
      id: 'ahorro', tono: 'muted', fuente: 'Pendiente: línea base de la flota',
      quePaso: 'Ahorro de tiempo: sin línea base', queSignifica: 'No hay minutos por desglose ni personas de hoy con qué comparar, y sin eso no hay % de ahorro defendible',
      queHacer: 'Pide a la flota cuántos minutos le toma un desglose y quién lo hace',
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => ORDEN_TONO[a.x.tono] - ORDEN_TONO[b.x.tono] || a.i - b.i)
    .map(({ x }) => x);
}

/** Lo que la pantalla ya sabe sin leer más: las fichas. Cobertura, origen, hora y línea base no se inventan. */
export function entradaDesdeFichas(f: {
  enviados: number | null; entregados: number | null; rebotados: number | null; retenidos: number | null; sinPoliza: number | null;
}): EntradaInsightsA1 {
  return {
    periodo: 'últimos 30 días', desgloses: null,
    entregados: f.entregados, enviados: f.enviados, rebotados: f.rebotados, retenidos: f.retenidos, sinPoliza: f.sinPoliza,
  };
}

/** Los conteos de `contarParaInsights` como entrada (lo que no trae queda sin medir). */
export function entradaDesdeConteo(c: ConteoInsights, periodo: string, extra: Partial<EntradaInsightsA1> = {}): EntradaInsightsA1 {
  const p = c.entregasPorEstado;
  return {
    periodo, desgloses: c.desgloses, entregados: p.entregada ?? 0, enviados: p.enviada ?? 0,
    rebotados: (p.rebotada ?? 0) + (p.queja ?? 0) + (p.fallida ?? 0), retenidos: null, sinPoliza: null, ...extra,
  };
}

/** Adaptador al tipo común que ya usa el panel de consumo (`@/lib/admin/consumo`). */
export function aInsightComun(i: InsightA1): { tipo: 'insight' | 'recomendacion' | 'problema'; titulo: string; detalle: string } {
  return {
    tipo: i.tono === 'bad' ? 'problema' : i.tono === 'warn' ? 'recomendacion' : 'insight',
    titulo: i.quePaso,
    detalle: `${i.queSignifica}. ${i.queHacer}.`,
  };
}
