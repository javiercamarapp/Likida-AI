import { numero } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio, PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import type { Correo } from '@/lib/correo/plantilla';
import { componerJornada, ROTULO_PROCEDENCIA, type Asiento, type Procedencia } from './modelo';
import { TOPE_DIARIO_LFT_68_HORAS, MAX_MINUTOS_JORNADA } from './topes';
import type { PoliticaFlota } from './riesgo';

// ═══════════════════════════════════════════════════════════════════════════
// LA ALERTA SALIENTE DE TOPE DE JORNADA (Agente 12, LFT 132 fr. XXXIV y 68).
//
// Hasta hoy la jornada era un registro que se MIRABA. Esto avisa mientras
// todavía se puede hacer algo: cuando la jornada EN CURSO de un operador llega
// a los umbrales de la flota (por omisión 80 % y 95 % del tope) o lo rebasa, se
// avisa al encargado y al operador por el canal que la flota eligió.
//
// ── LAS REGLAS QUE NO SE NEGOCIAN ────────────────────────────────────────
//  1. NUNCA SE INVENTA UNA HORA. Las horas corridas salen del inicio EVIDENCIADO
//     (el que ya compone el tablero) hasta ahora. Sin inicio vivo, no hay alerta:
//     no se estima cuándo empezó.
//  2. UNA COTA INFERIOR SE DICE «AL MENOS». Si el inicio no lo declaró el
//     operador (se derivó del GPS o de un hito), la jornada real fue esa o MÁS
//     larga: el aviso dice «al menos X h» y nombra la fuente. Un exceso sobre una
//     cota está probado; un «va al 80 %» sobre una cota es un piso, no un cálculo.
//  3. NO SE ACORTA LA JORNADA A FAVOR DE LA EMPRESA. Solo se descuentan los
//     descansos CERRADOS (los que alguien marcó con inicio y regreso). Un
//     descanso sin cierre NO se descuenta ni se estima cuánto duró, y el aviso lo
//     dice. Tampoco se asume descanso en los huecos.
//  4. UNA JORNADA QUE LLEVA MÁS DE 24 H ABIERTA no es un día largo: es un cierre
//     que nadie marcó. No se alerta «exceso» sobre un dato que el propio modelo
//     llama imposible: se cuenta aparte (`sinCierreProbable`) para que el
//     tablero la muestre. Un inicio en el futuro (reloj desfasado) tampoco alerta.
//  5. UNA VEZ POR NIVEL. La fila (jornada, nivel) de `jornada_alerta` es el claim:
//     dos corridas no avisan dos veces. Si la primera vez que se mira ya va al
//     95 %, se avisa ESE nivel (no los tres a la vez).
//  6. TODO SALE POR `enviarConFallback` (ventana de 24 h → texto; fuera →
//     plantilla del catálogo). Un rechazo reintentable (429, red) suelta el
//     claim y se reintenta; uno definitivo se registra con su motivo.
//  7. No es asesoría jurídica ni un dictamen: es un aviso sobre lo registrado,
//     con la misma leyenda que el resto del producto.
// ═══════════════════════════════════════════════════════════════════════════

export type NivelAlerta = 'aviso' | 'critico' | 'exceso';
export type CanalEncargado = 'whatsapp' | 'correo' | 'ambos' | 'ninguno';
export type CanalOperador = 'whatsapp' | 'ninguno';

export const TOPE_LFT_68_MIN = TOPE_DIARIO_LFT_68_HORAS * 60;
/** Un inicio a más de esto en el futuro es un reloj desfasado, no una jornada. */
export const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export interface ConfigAlerta {
  tenantId: string;
  topeHoras: number | null;
  umbralAvisoPct: number;
  umbralCriticoPct: number;
  canalEncargado: CanalEncargado;
  canalOperador: CanalOperador;
  correoEncargado: string | null;
}

/** El tope efectivo en minutos: el del art. 68 o uno MÁS estricto (de la alerta o de la política de la flota). */
export function topeEfectivoMin(cfg: Pick<ConfigAlerta, 'topeHoras'>, politica: Pick<PoliticaFlota, 'horasMaxJornada'> | null): number {
  const candidatos = [TOPE_LFT_68_MIN];
  if (cfg.topeHoras !== null && Number.isFinite(cfg.topeHoras) && cfg.topeHoras > 0) candidatos.push(Math.round(cfg.topeHoras * 60));
  const p = politica?.horasMaxJornada;
  if (typeof p === 'number' && Number.isFinite(p) && p > 0) candidatos.push(Math.round(p * 60));
  return Math.min(...candidatos);
}

export type EstadoCurso =
  | 'en_curso' | 'cerrada' | 'sin_inicio' | 'inicio_en_futuro' | 'sin_cierre_probable';

export interface Curso {
  estado: EstadoCurso;
  /** Minutos registrados hasta ahora, netos de descansos CERRADOS. `null` si no se pudo medir. */
  minutos: number | null;
  brutos: number | null;
  descansoCerradoMin: number;
  descansoSinCierre: boolean;
  /** `true` = el inicio no lo declaró el operador: las horas son «al menos». */
  cotaInferior: boolean;
  fuente: Procedencia | null;
  inicioIso: string | null;
}

const SIN: Omit<Curso, 'estado'> = { minutos: null, brutos: null, descansoCerradoMin: 0, descansoSinCierre: false, cotaInferior: false, fuente: null, inicioIso: null };

export function evaluarCurso(asientos: readonly Asiento[], ahoraMs: number): Curso {
  const j = componerJornada(asientos);
  if (j.fin !== null) return { ...SIN, estado: 'cerrada', fuente: j.inicio?.procedencia ?? null, inicioIso: j.inicio?.momento ?? null };
  if (j.inicio === null) return { ...SIN, estado: 'sin_inicio' };
  const inicioMs = Date.parse(j.inicio.momento);
  const base = { fuente: j.inicio.procedencia, inicioIso: j.inicio.momento, cotaInferior: j.inicio.procedencia === 'gps' || j.inicio.procedencia === 'hito_viaje' };
  if (!Number.isFinite(inicioMs)) return { ...SIN, ...base, estado: 'sin_inicio' };
  if (inicioMs > ahoraMs + TOLERANCIA_FUTURO_MS) return { ...SIN, ...base, estado: 'inicio_en_futuro' };
  const brutos = Math.max(0, Math.round((ahoraMs - inicioMs) / 60_000));
  const cerrados = j.descansos.filter((d) => d.minutos !== null).reduce((s, d) => s + (d.minutos ?? 0), 0);
  const sinCierre = j.descansos.some((d) => d.minutos === null);
  if (brutos > MAX_MINUTOS_JORNADA) {
    return { ...base, estado: 'sin_cierre_probable', minutos: null, brutos, descansoCerradoMin: cerrados, descansoSinCierre: sinCierre };
  }
  return { ...base, estado: 'en_curso', minutos: Math.max(0, brutos - cerrados), brutos, descansoCerradoMin: cerrados, descansoSinCierre: sinCierre };
}

/** El nivel que corresponde a `minutos` contra `topeMin`, o `null` si todavía no llega al primer umbral. */
export function nivelDe(minutos: number, topeMin: number, cfg: Pick<ConfigAlerta, 'umbralAvisoPct' | 'umbralCriticoPct'>): NivelAlerta | null {
  if (!(topeMin > 0) || !Number.isFinite(minutos) || minutos < 0) return null;
  const pct = (minutos / topeMin) * 100;
  if (pct >= 100) return 'exceso';
  if (pct >= cfg.umbralCriticoPct) return 'critico';
  if (pct >= cfg.umbralAvisoPct) return 'aviso';
  return null;
}

export const RANGO_NIVEL: Readonly<Record<NivelAlerta, number>> = { aviso: 1, critico: 2, exceso: 3 };
export const ROTULO_NIVEL: Readonly<Record<NivelAlerta, string>> = { aviso: 'Aviso', critico: 'Crítico', exceso: 'Excedido' };

export function horasTexto(minutos: number, cota: boolean): string {
  const h = Math.round(minutos / 6) / 10;
  return `${numero(h)} h${cota ? ' (al menos)' : ''}`;
}
const topeTexto = (topeMin: number) => `${numero(Math.round(topeMin / 6) / 10)} h`;

export function fraseDeNivel(nivel: NivelAlerta, minutos: number, topeMin: number): string {
  const pct = Math.floor((minutos / topeMin) * 100);
  if (nivel === 'exceso') return 'ya rebasó el tope';
  if (nivel === 'critico') return `va al ${pct} % del tope, casi lo alcanza`;
  return `va al ${pct} % del tope`;
}

export interface MensajeAviso {
  texto: string;
  plantilla: { nombre: string } & ReturnType<typeof opcionesDeEnvio>;
}

const LEYENDA = 'Es un aviso sobre lo registrado, no un dictamen jurídico.';

export interface DatosAviso {
  nombreOperador: string;
  nivel: NivelAlerta;
  minutos: number;
  topeMin: number;
  cotaInferior: boolean;
  fuente: Procedencia;
  descansoSinCierre: boolean;
  liga: string;
}

const limpio = (t: string, max: number) => t.replace(/\s+/g, ' ').trim().slice(0, max);

export function armarAvisoEncargado(d: DatosAviso): MensajeAviso {
  const nombre = limpio(d.nombreOperador, 60) || 'un operador';
  const frase = fraseDeNivel(d.nivel, d.minutos, d.topeMin);
  const horas = horasTexto(d.minutos, d.cotaInferior);
  const fuenteTxt = d.cotaInferior ? ` El inicio no lo declaró el operador (${ROTULO_PROCEDENCIA[d.fuente].toLowerCase()}): la jornada real fue esa o más larga.` : '';
  const descanso = d.descansoSinCierre ? ' Tiene un descanso sin cierre: no se descuenta ni se estima.' : '';
  return {
    texto: `Jornada de ${nombre}: ${frase}. Horas registradas: ${horas} de un tope de ${topeTexto(d.topeMin)}.${fuenteTxt}${descanso} Revísalo en ${d.liga}. ${LEYENDA}`,
    plantilla: { nombre: PLANTILLA.jornadaAvisoEncargado, ...opcionesDeEnvio(PLANTILLA.jornadaAvisoEncargado, { cuerpo: [nombre, limpio(frase, 60), horas, topeTexto(d.topeMin), d.liga] }) },
  };
}

export function armarAvisoOperador(d: DatosAviso): MensajeAviso {
  const nombre = limpio(d.nombreOperador.split(' ')[0] ?? '', 40) || 'operador';
  const horas = horasTexto(d.minutos, d.cotaInferior);
  const exceso = d.nivel === 'exceso' ? ' Ya rebasa ese máximo.' : '';
  return {
    texto: `Hola ${nombre}, tu jornada de hoy registra ${horas} de un máximo de ${topeTexto(d.topeMin)}.${exceso} Si ya terminaste, escribe «fin de mi jornada»; si vas a descansar, «voy a descansar». Aviso informativo de Likida.`,
    plantilla: { nombre: PLANTILLA.jornadaAvisoOperador, ...opcionesDeEnvio(PLANTILLA.jornadaAvisoOperador, { cuerpo: [nombre, horas, topeTexto(d.topeMin)] }) },
  };
}

export function armarCorreoEncargado(d: DatosAviso): Correo {
  const nombre = limpio(d.nombreOperador, 60) || 'un operador';
  const frase = fraseDeNivel(d.nivel, d.minutos, d.topeMin);
  return {
    asunto: `Jornada de ${nombre}: ${frase}`,
    avance: `${horasTexto(d.minutos, d.cotaInferior)} de un tope de ${topeTexto(d.topeMin)}`,
    titulo: `${ROTULO_NIVEL[d.nivel]}: la jornada de ${nombre} ${frase}`,
    parrafos: [
      `La jornada en curso de ${nombre} registra ${horasTexto(d.minutos, d.cotaInferior)} contra un tope de ${topeTexto(d.topeMin)} (LFT art. 68).`,
      ...(d.cotaInferior ? [`El inicio no lo declaró el operador (${ROTULO_PROCEDENCIA[d.fuente].toLowerCase()}): la jornada real fue esa o más larga.`] : []),
      ...(d.descansoSinCierre ? ['Tiene un descanso sin cierre: no se descuenta ni se estima cuánto duró.'] : []),
      LEYENDA,
    ],
    datos: [['Operador', nombre], ['Horas registradas', horasTexto(d.minutos, d.cotaInferior)], ['Tope', topeTexto(d.topeMin)], ['Fuente del inicio', ROTULO_PROCEDENCIA[d.fuente]]],
    boton: { texto: 'Abrir el tablero de jornada', href: d.liga },
    tono: d.nivel === 'exceso' ? 'urgente' : 'atencion',
    porQueLoRecibes: 'Tu flota activó las alertas de tope de jornada y te eligió como destinatario.',
  };
}

// ── Los puertos (reales en `alerta_tope_datos.ts`; dobles en las pruebas) ──

export interface FilaCandidata { tenantId: string; jornadaId: string; operadorId: string; dia: string; config: ConfigAlerta }
export interface DatosOperador { nombre: string; telefono: string | null; terminalId: string | null }
export interface Destino { nombre: string; telefono: string }
export interface ResultadoEnvioAviso { ok: boolean; reintentable: boolean; motivo?: string }
export type EstadoDestino = 'pendiente' | 'enviado' | 'fallido' | 'sin_destinatario' | 'no_aplica';

export interface ReclamoAlerta { id: string; token: string }

export interface PuertosAlerta {
  candidatas(ahora: Date, limite: number): Promise<{ filas: FilaCandidata[]; hayMas: boolean }>;
  asientos(tenantId: string, jornadaId: string): Promise<Asiento[] | null>;
  politica(tenantId: string): Promise<PoliticaFlota | null>;
  operador(tenantId: string, operadorId: string): Promise<DatosOperador | null>;
  encargados(tenantId: string, terminalId: string | null): Promise<Destino[]>;
  reclamar(a: { tenantId: string; jornadaId: string; nivel: NivelAlerta; minutos: number; topeMin: number; cota: boolean; fuente: Procedencia; descansoSinCierre: boolean; ahora: Date }): Promise<ReclamoAlerta | null | 'fallo'>;
  cerrar(a: {
    tenantId: string; reclamo: ReclamoAlerta; estado: 'enviada' | 'parcial' | 'fallida' | 'sin_destinatario';
    encargado: { canal: CanalEncargado | null; estado: EstadoDestino; motivo: string | null };
    operador: { canal: CanalOperador | null; estado: EstadoDestino; motivo: string | null };
    ahora: Date;
  }): Promise<boolean>;
  liberar(tenantId: string, reclamo: ReclamoAlerta): Promise<boolean>;
  enviarWa(telefono: string, msg: MensajeAviso, tenantId: string, ahora: Date, contexto: string): Promise<ResultadoEnvioAviso>;
  enviarCorreo(para: string, correo: Correo): Promise<ResultadoEnvioAviso>;
  appUrl(): string;
}

export interface ResultadoAlertasTope {
  revisadas: number;
  enCurso: number;
  sinInicio: number;
  inicioEnFuturo: number;
  /** Jornadas abiertas > 24 h: un cierre que nadie marcó. No se alertan; se dicen. */
  sinCierreProbable: number;
  bajoUmbral: number;
  yaAvisadas: number;
  alertas: Record<NivelAlerta, number>;
  sinDestinatario: number;
  rechazosReintentables: number;
  cortadosPorReloj: number;
  listaTruncada: boolean;
  cortadaPorRechazoMasivo: boolean;
  fallos: string[];
}

export const LIMITE_CANDIDATAS = 500;
const MAX_RECHAZOS_SEGUIDOS = 5;

export async function correrAlertasTope(p: PuertosAlerta, opts: { ahora?: Date; venceEn?: number } = {}): Promise<ResultadoAlertasTope> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoAlertasTope = {
    revisadas: 0, enCurso: 0, sinInicio: 0, inicioEnFuturo: 0, sinCierreProbable: 0, bajoUmbral: 0, yaAvisadas: 0,
    alertas: { aviso: 0, critico: 0, exceso: 0 }, sinDestinatario: 0, rechazosReintentables: 0, cortadosPorReloj: 0,
    listaTruncada: false, cortadaPorRechazoMasivo: false, fallos: [],
  };
  // Si no se puede leer la lista, NO se afirma que no hay nada que avisar: lanza (el cron pinta fallo).
  const { filas, hayMas } = await p.candidatas(ahora, LIMITE_CANDIDATAS + 1);
  r.listaTruncada = hayMas || filas.length > LIMITE_CANDIDATAS;
  const lista = filas.slice(0, LIMITE_CANDIDATAS);

  const politicas = new Map<string, PoliticaFlota | null | 'ilegible'>();
  const encargados = new Map<string, Destino[] | 'ilegible'>();
  let rechazosSeguidos = 0;

  for (let i = 0; i < lista.length; i++) {
    const f = lista[i];
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) { r.cortadosPorReloj = lista.length - i; break; }
    r.revisadas++;
    try {
      const asientos = await p.asientos(f.tenantId, f.jornadaId);
      if (asientos === null) { r.fallos.push(`jornada ${f.jornadaId}: no se pudo leer el expediente (no se alerta sin leerlo)`); continue; }
      const curso = evaluarCurso(asientos, ahora.getTime());
      if (curso.estado === 'sin_inicio') { r.sinInicio++; continue; }
      if (curso.estado === 'inicio_en_futuro') { r.inicioEnFuturo++; continue; }
      if (curso.estado === 'sin_cierre_probable') { r.sinCierreProbable++; continue; }
      if (curso.estado !== 'en_curso' || curso.minutos === null || curso.fuente === null) continue;
      r.enCurso++;

      if (!politicas.has(f.tenantId)) {
        try { politicas.set(f.tenantId, await p.politica(f.tenantId)); } catch (e) {
          politicas.set(f.tenantId, 'ilegible');
          logger.error('jornada.alerta_politica_ilegible', { tenant: f.tenantId, err: e instanceof Error ? e.message : String(e) });
        }
      }
      const pol = politicas.get(f.tenantId);
      // La política es un umbral MÁS estricto: sin poder leerla se usa solo el tope de ley y se dice.
      if (pol === 'ilegible') r.fallos.push(`flota ${f.tenantId}: no se pudo leer la política de jornada; se evaluó solo contra el tope legal`);
      const topeMin = topeEfectivoMin(f.config, pol === 'ilegible' ? null : pol ?? null);
      const nivel = nivelDe(curso.minutos, topeMin, f.config);
      if (nivel === null) { r.bajoUmbral++; continue; }

      const reclamo = await p.reclamar({
        tenantId: f.tenantId, jornadaId: f.jornadaId, nivel, minutos: curso.minutos, topeMin, cota: curso.cotaInferior,
        fuente: curso.fuente, descansoSinCierre: curso.descansoSinCierre, ahora,
      });
      if (reclamo === null) { r.yaAvisadas++; continue; }
      if (reclamo === 'fallo') { r.fallos.push(`jornada ${f.jornadaId}: no se pudo reclamar la alerta ${nivel}`); continue; }

      const op = await p.operador(f.tenantId, f.operadorId);
      const datos: DatosAviso = {
        nombreOperador: op?.nombre ?? '', nivel, minutos: curso.minutos, topeMin, cotaInferior: curso.cotaInferior,
        fuente: curso.fuente, descansoSinCierre: curso.descansoSinCierre, liga: `${p.appUrl()}/dashboard/jornada`,
      };

      // ── ENCARGADO ──
      const cfg = f.config;
      let encEstado: EstadoDestino = 'no_aplica';
      let encMotivo: string | null = null;
      let encReintentable = false;
      if (cfg.canalEncargado !== 'ninguno') {
        let intentos = 0; let enviados = 0; let reint = 0; let ultimo = '';
        if (cfg.canalEncargado === 'whatsapp' || cfg.canalEncargado === 'ambos') {
          if (!encargados.has(`${f.tenantId}|${op?.terminalId ?? ''}`)) {
            try { encargados.set(`${f.tenantId}|${op?.terminalId ?? ''}`, await p.encargados(f.tenantId, op?.terminalId ?? null)); } catch (e) {
              encargados.set(`${f.tenantId}|${op?.terminalId ?? ''}`, 'ilegible');
              logger.error('jornada.alerta_encargados_ilegibles', { tenant: f.tenantId, err: e instanceof Error ? e.message : String(e) });
            }
          }
          const dest = encargados.get(`${f.tenantId}|${op?.terminalId ?? ''}`);
          if (dest === 'ilegible') { ultimo = 'no se pudieron leer los contactos del encargado'; intentos++; reint++; }
          else {
            const msg = armarAvisoEncargado(datos);
            for (const d of dest ?? []) {
              intentos++;
              const e = await p.enviarWa(d.telefono, msg, f.tenantId, ahora, 'jornada.alerta_encargado');
              if (e.ok) enviados++; else { ultimo = e.motivo ?? 'rechazado'; if (e.reintentable) reint++; }
            }
          }
        }
        if ((cfg.canalEncargado === 'correo' || cfg.canalEncargado === 'ambos') && cfg.correoEncargado) {
          intentos++;
          const e = await p.enviarCorreo(cfg.correoEncargado, armarCorreoEncargado(datos));
          if (e.ok) enviados++; else { ultimo = e.motivo ?? 'rechazado'; if (e.reintentable) reint++; }
        }
        if (enviados > 0) encEstado = 'enviado';
        else if (intentos === 0) encEstado = 'sin_destinatario';
        else { encEstado = 'fallido'; encMotivo = ultimo.slice(0, 200); encReintentable = reint === intentos; }
      }

      // ── OPERADOR ──
      let opEstado: EstadoDestino = 'no_aplica';
      let opMotivo: string | null = null;
      let opReintentable = false;
      if (cfg.canalOperador === 'whatsapp') {
        if (!op?.telefono) { opEstado = 'sin_destinatario'; }
        else {
          const e = await p.enviarWa(op.telefono, armarAvisoOperador(datos), f.tenantId, ahora, 'jornada.alerta_operador');
          if (e.ok) opEstado = 'enviado'; else { opEstado = 'fallido'; opMotivo = (e.motivo ?? 'rechazado').slice(0, 200); opReintentable = e.reintentable; }
        }
      }

      const aplicables = [encEstado, opEstado].filter((e) => e !== 'no_aplica');
      const algunEnviado = aplicables.includes('enviado');
      const algunFallido = aplicables.includes('fallido');
      const todosFallidosReintentables = !algunEnviado && algunFallido
        && (encEstado !== 'fallido' || encReintentable) && (opEstado !== 'fallido' || opReintentable);
      if (todosFallidosReintentables) {
        // Nada llegó y todo fue reintentable: el nivel NO se consume, la siguiente corrida lo reintenta.
        await p.liberar(f.tenantId, reclamo);
        r.rechazosReintentables++;
        rechazosSeguidos++;
        r.fallos.push(`jornada ${f.jornadaId} (${nivel}): ${encMotivo ?? opMotivo ?? 'rechazado'} (se reintenta en la siguiente corrida)`);
        if (rechazosSeguidos >= MAX_RECHAZOS_SEGUIDOS) { r.cortadaPorRechazoMasivo = true; break; }
        continue;
      }
      rechazosSeguidos = 0;
      const estado = algunEnviado ? (algunFallido || aplicables.includes('sin_destinatario') ? 'parcial' : 'enviada')
        : algunFallido ? 'fallida' : 'sin_destinatario';
      const cerrada = await p.cerrar({
        tenantId: f.tenantId, reclamo, estado,
        encargado: { canal: cfg.canalEncargado === 'ninguno' ? null : cfg.canalEncargado, estado: encEstado, motivo: encMotivo },
        operador: { canal: cfg.canalOperador === 'whatsapp' ? 'whatsapp' : null, estado: opEstado, motivo: opMotivo },
        ahora,
      });
      if (!cerrada) { r.fallos.push(`jornada ${f.jornadaId}: el claim se perdió antes de cerrar la alerta ${nivel}`); continue; }
      if (algunEnviado) r.alertas[nivel]++;
      if (estado === 'sin_destinatario') { r.sinDestinatario++; r.fallos.push(`jornada ${f.jornadaId}: no hay a quién avisar el nivel ${nivel}`); }
      else if (estado === 'fallida') r.fallos.push(`jornada ${f.jornadaId} (${nivel}): ${encMotivo ?? opMotivo ?? 'rechazado'}`);
    } catch (e) {
      r.fallos.push(`jornada ${f.jornadaId}: ${e instanceof Error ? e.message : 'error inesperado'}`);
      logger.error('jornada.alerta_tope_fallo', { jornada: f.jornadaId, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return r;
}
