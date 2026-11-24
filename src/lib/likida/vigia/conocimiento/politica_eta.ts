// ═══════════════════════════════════════════════════════════════════════════
// POLÍTICA DE ETA — qué se puede decir de la hora de llegada, qué falta y cuándo hay que alertar.
//
// Reglas (obligatorias):
//   1. El agente NUNCA calcula ni promete un ETA. Solo retransmite el ETA VIGENTE: el último publicado por una persona autorizada
//      (o, si la flota lo autoriza expresamente, el que genera el sistema con GPS), con su HORA DE ACTUALIZACIÓN, el PUNTO al que
//      aplica (planta o patio) y la zona horaria.
//   2. Sin ETA vigente no se inventa: se dice qué falta (plantilla `falta_dato`) y se avisa a una persona.
//   3. Nunca se comunica un cambio de ETA sin causa: el cliente castiga más el ETA que cambia que el incierto con explicación.
//   4. Un ETA posterior al anterior o dos cambios en 60 min → avisar al encargado ANTES de enviar; tres cambios en 2 h o un ETA
//      más de 60 min después de la cita → gerencia.
//   5. El retraso se avisa ANTES de la cita (1-2 h antes, no 5 minutos antes), aunque nadie pregunte.
// Todos los umbrales son configuración con los valores recomendados por omisión. Un dato ilegible se trata como ausente.
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════

export type PuntoEta = 'planta' | 'patio';
export type FuenteEta = 'persona' | 'sistema_gps';

export interface EtaPublicado {
  etaIso: string;
  /** Cuándo se publicó o actualizó este ETA. */
  actualizadoIso: string;
  punto: PuntoEta | null;
  fuente: FuenteEta | null;
  /** Causa confirmada del cambio respecto al ETA anterior (null si no hay o no hubo cambio). */
  causa: string | null;
}

export interface ConfigEta {
  /** Antigüedad máxima (min) para considerar vigente un ETA. */
  maxAntiguedadMin: number;
  /** Ventana (min) para contar «cambios seguidos». */
  ventanaCambiosAvisoMin: number;
  /** Cambios dentro de `ventanaCambiosAvisoMin` que obligan a avisar al encargado antes de enviar. */
  cambiosParaAvisar: number;
  /** Ventana (min) de la alerta de cambio frecuente. */
  ventanaCambioFrecuenteMin: number;
  /** Cambios dentro de `ventanaCambioFrecuenteMin` que escalan a gerencia. */
  cambiosParaEscalar: number;
  /** Minutos de antelación mínima con que debe avisarse un retraso previsto. */
  avisoPrevioMinimoMin: number;
  /** ETA posterior a la cita por más de estos minutos → gerencia. */
  retrasoEscalaMin: number;
  /** El sistema puede generar ETA con GPS (apagado: solo cuenta el ETA publicado por una persona). */
  autorizaEtaDeSistema: boolean;
  /** Zona horaria que se muestra junto a la hora (p. ej. «Centro»). null = no configurada: no se afirma ninguna hora. */
  zonaHoraria: string | null;
}

export const CONFIG_ETA_POR_OMISION: ConfigEta = Object.freeze({
  maxAntiguedadMin: 60,
  ventanaCambiosAvisoMin: 60,
  cambiosParaAvisar: 2,
  ventanaCambioFrecuenteMin: 120,
  cambiosParaEscalar: 3,
  avisoPrevioMinimoMin: 60,
  retrasoEscalaMin: 60,
  autorizaEtaDeSistema: false,
  zonaHoraria: null,
});

export interface EstadoEta {
  ahoraMs: number;
  citaIso: string | null;
  /** ETA publicados, del más antiguo al más reciente; el último es el vigente. */
  historial: readonly EtaPublicado[];
  /** Hora en que ya se avisó al cliente de un retraso previsto (si ya se hizo). */
  retrasoAvisadoIso?: string | null;
  config?: Partial<ConfigEta>;
}

export type FaltanteEta = 'eta_vigente' | 'eta_vencido' | 'hora_actualizacion' | 'punto' | 'zona_horaria' | 'causa_del_cambio' | 'autorizacion_eta_de_sistema';
export type NivelEta = 'ninguno' | 'N1' | 'N2';

export interface EvaluacionEta {
  /** ¿Puede el agente mencionar un ETA al cliente? (Aun así la respuesta pasa por aprobación según el tipo.) */
  puedeDecir: boolean;
  /** El ETA que puede retransmitir, solo si `puedeDecir`. */
  eta: { etaIso: string; actualizadoIso: string; punto: PuntoEta; zona: string; causaCambio: string | null; etaAnteriorIso: string | null } | null;
  faltan: FaltanteEta[];
  /** Minutos que el ETA vigente excede a la cita (negativo = antes); null si no se puede calcular. */
  retrasoVsCitaMin: number | null;
  /** Hay que avisar un retraso previsto al cliente (y aún no se hizo). */
  avisarRetraso: boolean;
  /** Se está avisando tarde: queda menos antelación que `avisoPrevioMinimoMin` (o la cita ya pasó). */
  avisoTarde: boolean;
  cambiosEnVentanaAviso: number;
  cambiosEnVentanaFrecuente: number;
  /** Cambio frecuente (≥ `cambiosParaEscalar` en la ventana). */
  alertaCambioFrecuente: boolean;
  /** Hay que retener el envío del ETA nuevo hasta que una persona confirme (cambio sin causa, ETA que se retrasa, cambios seguidos). */
  retenerEnvio: boolean;
  nivel: NivelEta;
  motivos: string[];
  /** Frases que el redactor no debe producir jamás respecto al ETA. */
  nuncaDecir: readonly string[];
}

export const NUNCA_DECIR_ETA: readonly string[] = Object.freeze([
  'llego a las X', 'llega en N horas', 'en breve', 'ya casi', 'ETA de salida presentado como llegada', 'ETA de patio presentado como de planta',
  'tráfico (sin evidencia registrada)', 'un rango improvisado de horas',
]);

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const min = (a: number, b: number): number => Math.round((a - b) / 60_000);

function configEfectiva(c: Partial<ConfigEta> | undefined): ConfigEta {
  const base = CONFIG_ETA_POR_OMISION;
  const pos = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    maxAntiguedadMin: pos(c?.maxAntiguedadMin, base.maxAntiguedadMin),
    ventanaCambiosAvisoMin: pos(c?.ventanaCambiosAvisoMin, base.ventanaCambiosAvisoMin),
    cambiosParaAvisar: pos(c?.cambiosParaAvisar, base.cambiosParaAvisar),
    ventanaCambioFrecuenteMin: pos(c?.ventanaCambioFrecuenteMin, base.ventanaCambioFrecuenteMin),
    cambiosParaEscalar: pos(c?.cambiosParaEscalar, base.cambiosParaEscalar),
    avisoPrevioMinimoMin: pos(c?.avisoPrevioMinimoMin, base.avisoPrevioMinimoMin),
    retrasoEscalaMin: pos(c?.retrasoEscalaMin, base.retrasoEscalaMin),
    autorizaEtaDeSistema: c?.autorizaEtaDeSistema === true,
    zonaHoraria: typeof c?.zonaHoraria === 'string' && c.zonaHoraria.trim() ? c.zonaHoraria.trim() : null,
  };
}

/** Cuántas veces cambió el ETA (valor distinto del anterior) con publicación dentro de los últimos `ventanaMin` minutos. */
export function cambiosDeEta(historial: readonly EtaPublicado[], ahoraMs: number, ventanaMin: number): number {
  let n = 0;
  for (let i = 1; i < historial.length; i++) {
    const act = ms(historial[i].actualizadoIso);
    const e = ms(historial[i].etaIso);
    const ant = ms(historial[i - 1].etaIso);
    if (act === null || e === null || ant === null) continue;
    if (e !== ant && ahoraMs - act <= ventanaMin * 60_000 && act <= ahoraMs) n++;
  }
  return n;
}

/** Evalúa el estado del ETA de un servicio. Nunca lanza; ante dato ilegible o ausente, no afirma nada. */
export function evaluarEta(estado: EstadoEta): EvaluacionEta {
  const cfg = configEfectiva(estado.config);
  const faltan: FaltanteEta[] = [];
  const motivos: string[] = [];
  const h = estado.historial ?? [];
  const ultimo = h.length > 0 ? h[h.length - 1] : null;
  const previo = h.length > 1 ? h[h.length - 2] : null;
  const ahora = estado.ahoraMs;
  const citaMs = ms(estado.citaIso);
  const etaMs = ultimo ? ms(ultimo.etaIso) : null;
  const actMs = ultimo ? ms(ultimo.actualizadoIso) : null;

  let puede = true;
  if (!ultimo || etaMs === null) { puede = false; faltan.push('eta_vigente'); motivos.push('sin_eta_vigente'); }
  if (ultimo && etaMs !== null) {
    if (actMs === null) { puede = false; faltan.push('hora_actualizacion'); motivos.push('eta_sin_hora_de_actualizacion'); }
    else if (actMs > ahora) { puede = false; faltan.push('hora_actualizacion'); motivos.push('hora_de_actualizacion_en_el_futuro'); }
    else if (min(ahora, actMs) > cfg.maxAntiguedadMin) { puede = false; faltan.push('eta_vigente'); motivos.push('eta_desactualizado'); }
    if (etaMs < ahora) { puede = false; if (!faltan.includes('eta_vencido')) faltan.push('eta_vencido'); motivos.push('eta_ya_vencido'); }
    if (ultimo.punto === null) { puede = false; faltan.push('punto'); motivos.push('sin_punto_planta_o_patio'); }
    if (ultimo.fuente === 'sistema_gps' && !cfg.autorizaEtaDeSistema) { puede = false; faltan.push('autorizacion_eta_de_sistema'); motivos.push('eta_de_sistema_no_autorizado'); }
    if (ultimo.fuente === null) { puede = false; faltan.push('eta_vigente'); motivos.push('eta_sin_fuente'); }
    if (cfg.zonaHoraria === null) { puede = false; faltan.push('zona_horaria'); motivos.push('zona_horaria_no_configurada'); }
  }

  // Cambios.
  const cambiosAviso = cambiosDeEta(h, ahora, cfg.ventanaCambiosAvisoMin);
  const cambiosFrec = cambiosDeEta(h, ahora, cfg.ventanaCambioFrecuenteMin);
  const alertaFrecuente = cambiosFrec >= cfg.cambiosParaEscalar;
  const prevMs = previo ? ms(previo.etaIso) : null;
  const hayCambio = etaMs !== null && prevMs !== null && etaMs !== prevMs;
  const seRetrasa = hayCambio && (etaMs as number) > (prevMs as number);
  const cambioSinCausa = hayCambio && !(ultimo?.causa && ultimo.causa.trim());
  if (cambioSinCausa) { faltan.push('causa_del_cambio'); motivos.push('cambio_de_eta_sin_causa'); }

  let nivel: NivelEta = 'ninguno';
  const RANGO: Record<NivelEta, number> = { ninguno: 0, N1: 1, N2: 2 };
  const sube = (n: NivelEta, m: string): void => { motivos.push(m); if (RANGO[n] > RANGO[nivel]) nivel = n; };
  let retener = false;
  if (seRetrasa) { retener = true; sube('N1', 'eta_posterior_al_anterior'); }
  if (cambiosAviso >= cfg.cambiosParaAvisar) { retener = true; sube('N1', 'cambios_seguidos'); }
  if (cambioSinCausa) retener = true;
  if (alertaFrecuente) { retener = true; sube('N2', 'cambio_frecuente_de_eta'); }

  // Retraso respecto a la cita.
  const retraso = etaMs !== null && citaMs !== null ? min(etaMs, citaMs) : null;
  let avisarRetraso = false;
  let avisoTarde = false;
  if (retraso !== null && retraso > 0 && !estado.retrasoAvisadoIso) {
    avisarRetraso = true;
    sube('N1', 'retraso_previsto_sin_avisar');
    if (citaMs !== null && min(citaMs, ahora) < cfg.avisoPrevioMinimoMin) { avisoTarde = true; motivos.push('aviso_de_retraso_con_poca_antelacion'); }
  }
  if (retraso !== null && retraso > cfg.retrasoEscalaMin) sube('N2', 'eta_muy_posterior_a_la_cita');
  // Cita vencida sin ETA vigente o con ETA vencido.
  if (citaMs !== null && ahora > citaMs && (!puede || (etaMs !== null && etaMs < ahora))) sube('N2', 'cita_vencida_sin_eta_vigente');

  const eta = puede && ultimo && etaMs !== null && ultimo.punto && cfg.zonaHoraria
    ? { etaIso: ultimo.etaIso, actualizadoIso: ultimo.actualizadoIso, punto: ultimo.punto, zona: cfg.zonaHoraria, causaCambio: hayCambio ? (ultimo.causa?.trim() || null) : null, etaAnteriorIso: hayCambio && previo ? previo.etaIso : null }
    : null;

  // Si hay que retener el envío no se retransmite el ETA nuevo.
  const puedeDecir = puede && !retener;
  return {
    puedeDecir,
    eta: puedeDecir ? eta : null,
    faltan: [...new Set(faltan)],
    retrasoVsCitaMin: retraso,
    avisarRetraso,
    avisoTarde,
    cambiosEnVentanaAviso: cambiosAviso,
    cambiosEnVentanaFrecuente: cambiosFrec,
    alertaCambioFrecuente: alertaFrecuente,
    retenerEnvio: retener,
    nivel,
    motivos: [...new Set(motivos)],
    nuncaDecir: NUNCA_DECIR_ETA,
  };
}
