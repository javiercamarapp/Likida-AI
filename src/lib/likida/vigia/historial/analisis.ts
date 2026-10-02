// ═══════════════════════════════════════════════════════════════════════════
// FAQs, TENDENCIAS POR TEMA y TIEMPOS DE RESPUESTA a partir del histórico de un grupo (pedido de Lorena).
//
// PURO y determinista: sin modelo, sin base. Los temas salen de las MISMAS reglas que clasifican al cliente en vivo
// (`clasificarPorReglas`) más dos que el histórico de grupos pide y el chat 1:1 no (cita/andén y tarifa); lo que ninguna
// regla reconoce es «otro» y se dice así en el reporte, no se inventa un tema.
//
// Las «respuestas típicas» son lo que el EQUIPO contestó de verdad a esa pregunta (la primera respuesta del equipo dentro de
// la ventana). No se publican solas ni entrenan nada por sí mismas: son material para que el gerente las apruebe.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';
import { clasificarPorReglas } from '../intencion';
import type { MensajeHistorial } from './export_whatsapp';

export const TEMAS = ['ubicacion', 'eta', 'documentos', 'factura_pod', 'cita_anden', 'tarifa', 'queja', 'pide_humano', 'otro'] as const;
export type Tema = (typeof TEMAS)[number];

export const ETIQUETA_TEMA: Record<Tema, string> = {
  ubicacion: 'Ubicación del viaje', eta: 'Hora de llegada / entrega', documentos: 'Documentos', factura_pod: 'Factura y comprobante de entrega',
  cita_anden: 'Citas y andén', tarifa: 'Tarifas y cotizaciones', queja: 'Quejas e inconformidades', pide_humano: 'Pide hablar con alguien', otro: 'Otros',
};

const CITA = /\b(cita|citas|anden|andenes|agendar|agenda|reprogramar|reprogramacion|turno|hora de carga|hora de descarga|programar|programen|programado)\b/;
const TARIFA = /\b(tarifa|tarifas|precio|precios|cotizacion|cotizar|cotizan|costo|cuanto cuesta|cuanto sale|presupuesto)\b/;

/** El tema de un mensaje DEL CLIENTE. */
export function temaDe(texto: string): Tema {
  const n = normalizar(texto);
  if (!n) return 'otro';
  const c = clasificarPorReglas(texto);
  if (c) {
    if (c.intencion === 'queja' || c.intencion === 'pide_humano') return c.intencion;
    if (c.intencion === 'ubicacion' || c.intencion === 'eta' || c.intencion === 'documentos' || c.intencion === 'factura_pod') return c.intencion;
    return 'otro'; // saludo / baja: no es un tema de servicio
  }
  if (CITA.test(n)) return 'cita_anden';
  if (TARIFA.test(n)) return 'tarifa';
  return 'otro';
}

const PARO = new Set([
  'a', 'al', 'algo', 'buen', 'buenas', 'buenos', 'dia', 'dias', 'tardes', 'noches', 'de', 'del', 'el', 'la', 'las', 'los', 'un', 'una', 'unos', 'unas',
  'y', 'o', 'en', 'por', 'para', 'con', 'que', 'me', 'te', 'se', 'su', 'sus', 'mi', 'mis', 'es', 'son', 'por favor', 'favor', 'porfa', 'hola', 'gracias',
  'ya', 'les', 'le', 'lo', 'nos', 'si', 'no', 'pero', 'como', 'esta', 'estan', 'este', 'esto', 'esa', 'ese',
]);

function fichas(texto: string): string[] {
  return normalizar(texto).split(' ').filter((t) => t.length > 1 && !PARO.has(t));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes += 1;
  return comunes / (a.size + b.size - comunes);
}

const INTERROGATIVAS = /^(que|cual|cuales|cuando|cuanto|cuantos|cuantas|donde|quien|como|por que|a que|ya|hay|tienen|pueden|podrian|puedes|podemos|me pueden|nos pueden)\b/;

/** ¿El mensaje del cliente pregunta o pide algo? (signo de interrogación o arranque interrogativo). */
export function esPregunta(texto: string): boolean {
  if (/[?¿]/.test(texto)) return true;
  return INTERROGATIVAS.test(normalizar(texto));
}

export interface FaqItem {
  /** La pregunta más representativa del grupo (la más corta de las que más se parecen, sin datos personales). */
  pregunta: string;
  tema: Tema;
  veces: number;
  /** Cuántos días distintos se hizo. */
  dias: number;
  /** Lo que el equipo contestó más veces a esa pregunta; `null` si nunca se encontró una respuesta dentro de la ventana. */
  respuestaTipica: string | null;
  respuestasEncontradas: number;
}

export interface TendenciaTema {
  tema: Tema;
  etiqueta: string;
  total: number;
  /** Mensajes del tema en las últimas 4 semanas del histórico y en las 4 anteriores; `delta` null si no hay base de comparación. */
  ultimas4Semanas: number;
  previas4Semanas: number;
  delta: number | null;
  porSemana: Array<{ semana: string; mensajes: number }>;
}

export interface TiemposRespuesta {
  /** Mensajes de cliente con respuesta del equipo y sin ella. */
  conRespuesta: number;
  sinRespuesta: number;
  medianaMin: number | null;
  p90Min: number | null;
  /** Cuántas esperas rebasaron el umbral (por omisión 10 min, el mismo del Vigía en vivo). */
  sobreUmbral: number;
  umbralMin: number;
}

export interface ReporteHistorial {
  mensajes: number;
  mensajesCliente: number;
  mensajesEquipo: number;
  desde: string | null;
  hasta: string | null;
  porTema: Array<{ tema: Tema; etiqueta: string; mensajes: number }>;
  faqs: FaqItem[];
  tendencias: TendenciaTema[];
  tiempos: TiemposRespuesta;
}

const VENTANA_RESPUESTA_MIN = 60;

/** Lunes (UTC) de la semana del instante, como YYYY-MM-DD. */
export function semanaDe(iso: string): string {
  const d = new Date(iso);
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

function percentil(orden: number[], p: number): number | null {
  if (orden.length === 0) return null;
  return orden[Math.min(orden.length - 1, Math.ceil(p * orden.length) - 1)];
}

export function analizarHistorial(
  entrada: ReadonlyArray<Pick<MensajeHistorial, 'enviadoEn' | 'rol' | 'texto'>>,
  opciones: { umbralMin?: number; maxFaqs?: number } = {},
): ReporteHistorial {
  const umbral = opciones.umbralMin ?? 10;
  const maxFaqs = opciones.maxFaqs ?? 15;
  const msgs = [...entrada].sort((a, b) => (a.enviadoEn < b.enviadoEn ? -1 : a.enviadoEn > b.enviadoEn ? 1 : 0));
  const cliente = msgs.filter((m) => m.rol === 'cliente');

  // ── Temas ──
  const temaPorMensaje = new Map<(typeof msgs)[number], Tema>();
  const conteoTema = new Map<Tema, number>();
  for (const m of cliente) {
    const t = temaDe(m.texto);
    temaPorMensaje.set(m, t);
    conteoTema.set(t, (conteoTema.get(t) ?? 0) + 1);
  }

  // ── Primera respuesta del equipo a cada mensaje de cliente (dentro de la ventana) ──
  const respuestaDe = new Map<(typeof msgs)[number], (typeof msgs)[number] | null>();
  const esperas: number[] = [];
  let sinRespuesta = 0;
  msgs.forEach((m, i) => {
    if (m.rol !== 'cliente') return;
    // Los mensajes de saludo/agradecimiento no esperan respuesta: contarlos como «sin respuesta» inflaría el problema.
    const sustantivo = temaPorMensaje.get(m) !== 'otro' || esPregunta(m.texto);
    let r: (typeof msgs)[number] | null = null;
    for (let j = i + 1; j < msgs.length; j++) {
      if (msgs[j].rol !== 'equipo') continue;
      r = msgs[j];
      break;
    }
    const min = r ? (Date.parse(r.enviadoEn) - Date.parse(m.enviadoEn)) / 60_000 : null;
    respuestaDe.set(m, r && min !== null && min <= VENTANA_RESPUESTA_MIN ? r : null);
    if (!sustantivo) return;
    if (min === null) { sinRespuesta += 1; return; }
    esperas.push(min);
  });
  const ordenadas = [...esperas].sort((a, b) => a - b);
  const tiempos: TiemposRespuesta = {
    conRespuesta: esperas.length, sinRespuesta,
    medianaMin: percentil(ordenadas, 0.5) === null ? null : Math.round(percentil(ordenadas, 0.5)!),
    p90Min: percentil(ordenadas, 0.9) === null ? null : Math.round(percentil(ordenadas, 0.9)!),
    sobreUmbral: esperas.filter((e) => e > umbral).length + sinRespuesta,
    umbralMin: umbral,
  };

  // ── FAQs: preguntas parecidas (Jaccard ≥ 0.5 sobre sus palabras con contenido) ──
  interface Grupo { fichas: Set<string>; miembros: Array<(typeof msgs)[number]> }
  const grupos: Grupo[] = [];
  for (const m of cliente) {
    const tema = temaPorMensaje.get(m)!;
    if (!esPregunta(m.texto) && tema === 'otro') continue;
    if (tema === 'queja' || tema === 'pide_humano') continue; // una queja no es una pregunta frecuente: va en tendencias
    const f = new Set(fichas(m.texto));
    if (f.size < 2) continue;
    const g = grupos.find((x) => jaccard(x.fichas, f) >= 0.5);
    if (g) { g.miembros.push(m); for (const t of f) g.fichas.add(t); } else grupos.push({ fichas: f, miembros: [m] });
  }
  const faqs: FaqItem[] = grupos
    .filter((g) => g.miembros.length >= 2)
    .map((g) => {
      const representante = [...g.miembros].sort((a, b) => a.texto.length - b.texto.length)[0];
      const respuestas = new Map<string, { texto: string; n: number }>();
      for (const m of g.miembros) {
        const r = respuestaDe.get(m);
        if (!r) continue;
        const k = normalizar(r.texto);
        if (!k) continue;
        const prev = respuestas.get(k);
        if (prev) prev.n += 1; else respuestas.set(k, { texto: r.texto, n: 1 });
      }
      const mejor = [...respuestas.values()].sort((a, b) => b.n - a.n || a.texto.length - b.texto.length)[0] ?? null;
      return {
        pregunta: representante.texto.replace(/\s+/g, ' ').slice(0, 240),
        tema: temaPorMensaje.get(representante)!,
        veces: g.miembros.length,
        dias: new Set(g.miembros.map((m) => m.enviadoEn.slice(0, 10))).size,
        respuestaTipica: mejor ? mejor.texto.replace(/\s+/g, ' ').slice(0, 400) : null,
        respuestasEncontradas: [...respuestas.values()].reduce((s, r) => s + r.n, 0),
      };
    })
    .sort((a, b) => b.veces - a.veces || a.pregunta.localeCompare(b.pregunta))
    .slice(0, maxFaqs);

  // ── Tendencias por tema y semana ──
  const hasta = msgs.length ? msgs[msgs.length - 1].enviadoEn : null;
  const desde = msgs.length ? msgs[0].enviadoEn : null;
  const semanasCliente = new Map<Tema, Map<string, number>>();
  for (const m of cliente) {
    const t = temaPorMensaje.get(m)!;
    const s = semanaDe(m.enviadoEn);
    const mapa = semanasCliente.get(t) ?? new Map<string, number>();
    mapa.set(s, (mapa.get(s) ?? 0) + 1);
    semanasCliente.set(t, mapa);
  }
  const finMs = hasta ? Date.parse(hasta) : 0;
  const SEMANA = 7 * 86_400_000;
  const hayBase = desde !== null && hasta !== null && finMs - Date.parse(desde) >= 8 * SEMANA;
  const tendencias: TendenciaTema[] = TEMAS.filter((t) => (conteoTema.get(t) ?? 0) > 0).map((tema) => {
    const ult = cliente.filter((m) => temaPorMensaje.get(m) === tema && finMs - Date.parse(m.enviadoEn) < 4 * SEMANA).length;
    const prev = cliente.filter((m) => temaPorMensaje.get(m) === tema && finMs - Date.parse(m.enviadoEn) >= 4 * SEMANA && finMs - Date.parse(m.enviadoEn) < 8 * SEMANA).length;
    return {
      tema, etiqueta: ETIQUETA_TEMA[tema], total: conteoTema.get(tema) ?? 0, ultimas4Semanas: ult, previas4Semanas: prev,
      delta: hayBase ? ult - prev : null,
      porSemana: [...(semanasCliente.get(tema) ?? new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, mensajes]) => ({ semana, mensajes })),
    };
  }).sort((a, b) => b.total - a.total);

  return {
    mensajes: msgs.length, mensajesCliente: cliente.length, mensajesEquipo: msgs.length - cliente.length, desde, hasta,
    porTema: TEMAS.filter((t) => (conteoTema.get(t) ?? 0) > 0).map((t) => ({ tema: t, etiqueta: ETIQUETA_TEMA[t], mensajes: conteoTema.get(t) ?? 0 })).sort((a, b) => b.mensajes - a.mensajes),
    faqs, tendencias, tiempos,
  };
}
