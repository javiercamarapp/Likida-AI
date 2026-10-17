import type { BotonAcuse } from '@/lib/meta/client';
import type { Salida } from './mensajes';
import type { EventoPatioFila, ViajeContexto } from './repo';
import { resolverSitio, normalizarNombre, type SitioCatalogo } from './sitio_derivado';
import type { MensajeSaliente } from './solicitudes';
import { PREFIJO_BOTON } from './tipos';

// T-A5-44 — la parte PURA del patio de entrega (sin I/O). El contexto y las reglas están en `patio_entrega.ts`.

/** Nivel reservado del claim `escalacion` para este aviso (el cron usa 1 y 2). */
export const NIVEL_AVISO_PATIO = 7;
export const PATIOS_POR_PAGINA = 2;
const MAX_TITULO = 20;

export interface PatioOpcion { id: string; nombre: string }
export type ResultadoPatio = 'igual' | 'distinto' | 'otro' | 'sin_referencia';
export type CampoPatio = 'entregar_en' | 'destino';

const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);
const comoCatalogo = (ps: readonly PatioOpcion[]): SitioCatalogo[] => ps.map((p) => ({ id: p.id, nombre: p.nombre, codigo: null, clienteId: null }));

// ── Puro ────────────────────────────────────────────────────────────────────

/** El texto que dice dónde se debe entregar, según el campo que manda. Sin «Entregar en» cae al destino (el campo que sí existe). */
export function textoEsperado(viaje: Pick<ViajeContexto, 'entregarEn' | 'destino'>, campo: CampoPatio): { texto: string | null; campoUsado: CampoPatio } {
  const entregarEn = (viaje.entregarEn ?? '').trim();
  if (campo === 'entregar_en' && entregarEn) return { texto: entregarEn, campoUsado: 'entregar_en' };
  const destino = (viaje.destino ?? '').trim();
  return { texto: destino || null, campoUsado: 'destino' };
}

/** El patio del catálogo al que apunta ese texto, o `null` (sin texto, o no se reconoce o es ambiguo). */
export function patioDeTexto(texto: string | null | undefined, patios: readonly PatioOpcion[]): PatioOpcion | null {
  const r = resolverSitio(texto, comoCatalogo(patios), null, 'destino');
  if (!r || r.tipo !== 'sitio') return null;
  return patios.find((p) => p.id === r.sitioId) ?? null;
}

/** El esperado primero (que sea lo primero que ve el chofer no lo induce: el orden del resto es alfabético y estable). */
export function ordenarPatios(patios: readonly PatioOpcion[], esperadoId: string | null): PatioOpcion[] {
  return [...patios].sort((a, b) => (a.id === esperadoId ? -1 : b.id === esperadoId ? 1 : normalizarNombre(a.nombre).localeCompare(normalizarNombre(b.nombre)) || a.id.localeCompare(b.id)));
}

export function totalPaginas(nPatios: number): number {
  return Math.max(1, Math.ceil(nPatios / PATIOS_POR_PAGINA));
}

/** Títulos de botón de ≤ 20 caracteres y únicos (Meta lo exige). */
function titulosUnicos(nombres: string[]): string[] {
  const vistos = new Set<string>();
  return nombres.map((n, i) => {
    let t = una(n, MAX_TITULO) || `Patio ${i + 1}`;
    if (vistos.has(t)) t = `${t.slice(0, MAX_TITULO - 2)} ${i + 1}`;
    vistos.add(t);
    return t;
  });
}

/** La pregunta con botones: hasta 2 patios y «Más» (o «Otro» en la última página). `pagina` empieza en 0. */
export function armarPreguntaPatio(viaje: Pick<ViajeContexto, 'id' | 'folio'>, ordenados: readonly PatioOpcion[], pagina: number): Salida {
  const paginas = totalPaginas(ordenados.length);
  const p = Math.min(Math.max(pagina, 0), paginas - 1);
  const delaPagina = ordenados.slice(p * PATIOS_POR_PAGINA, p * PATIOS_POR_PAGINA + PATIOS_POR_PAGINA);
  const ultima = p === paginas - 1;
  const titulos = titulosUnicos([...delaPagina.map((x) => x.nombre), ultima ? 'Otro, especifique' : 'Más patios']);
  const botones: BotonAcuse[] = delaPagina.map((x, i) => ({ id: `${PREFIJO_BOTON.patioEntrega}:${viaje.id}:${x.id}`, titulo: titulos[i] }));
  botones.push({ id: `${PREFIJO_BOTON.patioEntrega}:${viaje.id}:${ultima ? 'otro' : `mas${p + 1}`}`, titulo: titulos[titulos.length - 1] });
  const lista = delaPagina.map((x) => `• ${una(x.nombre, 60)}`).join('\n');
  const folio = viaje.folio ? ` (viaje ${una(viaje.folio, 30)})` : '';
  return { texto: `¿En qué patio vas a entregar${folio}? Toca el botón del patio:\n${lista}`, botones };
}

export interface Comparacion { resultado: ResultadoPatio; elegido: string; esperado: string | null }

/**
 * ¿El patio elegido es el esperado? Un texto libre que se reconoce como un patio del catálogo cuenta como ese patio. Sin esperado que
 * se reconozca en el catálogo no hay con qué comparar (`sin_referencia`): no se acusa al chofer ni se avisa al supervisor.
 */
export function compararPatio(
  elegido: { id: string } | { texto: string }, esperadoTexto: string | null, patios: readonly PatioOpcion[],
): Comparacion {
  const esperado = patioDeTexto(esperadoTexto, patios);
  let elegidoPatio: PatioOpcion | null = null;
  let nombreElegido: string;
  if ('id' in elegido) {
    elegidoPatio = patios.find((p) => p.id === elegido.id) ?? null;
    nombreElegido = elegidoPatio?.nombre ?? '';
  } else {
    nombreElegido = una(elegido.texto, 60);
    elegidoPatio = patioDeTexto(nombreElegido, patios);
  }
  const base = { elegido: elegidoPatio?.nombre ?? nombreElegido, esperado: esperado?.nombre ?? null };
  if (!esperado) return { ...base, resultado: 'sin_referencia' };
  if (elegidoPatio) return { ...base, resultado: elegidoPatio.id === esperado.id ? 'igual' : 'distinto' };
  return { ...base, resultado: 'otro' };
}

/** «patio <nombre>» al inicio del mensaje. */
export function leerTextoPatio(texto: string | undefined): string | null {
  if (typeof texto !== 'string' || texto.length > 120) return null;
  const m = /^\s*patio\s+([^\n?¿]{2,60})$/i.exec(texto);
  if (!m) return null;
  const nombre = una(m[1].replace(/^(?:del|de|la|el)\s+/i, ''), 60);
  return nombre.length >= 2 ? nombre : null;
}

export interface EstadoPatio {
  preguntado: boolean;
  esperandoTexto: boolean;
  respondido: { resultado: ResultadoPatio; elegido: string; esperado: string | null } | null;
  alertado: boolean;
  atendido: boolean;
}

/** Lo que dice la bitácora del patio para ese hito y ciclo (los renglones ya vienen del más viejo al más nuevo). */
export function estadoPatio(eventos: readonly EventoPatioFila[], hitoId: string, ciclo: number): EstadoPatio {
  const e: EstadoPatio = { preguntado: false, esperandoTexto: false, respondido: null, alertado: false, atendido: false };
  for (const x of eventos) {
    if (x.hitoId !== hitoId || Number(x.detalle.ciclo ?? ciclo) !== ciclo) continue;
    if (x.evento === 'atendido') { e.atendido = true; continue; }
    switch (x.detalle.estado) {
      case 'preguntado': e.preguntado = true; break;
      case 'esperando_texto': e.esperandoTexto = true; break;
      case 'respondido': e.respondido = {
        resultado: x.detalle.resultado as ResultadoPatio, elegido: String(x.detalle.elegido ?? ''), esperado: x.detalle.esperado ? String(x.detalle.esperado) : null,
      }; break;
      case 'alertado': e.alertado = true; break;
    }
  }
  return e;
}

export interface ExcepcionPatio { viajeId: string; hitoId: string; texto: string; desde: string; sinAvisar: boolean }

/** Excepciones del tablero: respuestas distintas (o «otro») que el supervisor aún no atendió. Pura. */
export function excepcionesPatio(eventos: readonly EventoPatioFila[]): ExcepcionPatio[] {
  const porHito = new Map<string, EventoPatioFila[]>();
  for (const x of eventos) porHito.set(x.hitoId, [...(porHito.get(x.hitoId) ?? []), x]);
  const salida: ExcepcionPatio[] = [];
  for (const [hitoId, evs] of porHito) {
    const ciclo = Math.max(...evs.map((x) => Number(x.detalle.ciclo ?? 0)));
    const st = estadoPatio(evs, hitoId, ciclo);
    const r = st.respondido;
    if (!r || (r.resultado !== 'distinto' && r.resultado !== 'otro') || st.atendido) continue;
    const resp = [...evs].reverse().find((x) => x.detalle.estado === 'respondido');
    const sinAvisar = !st.alertado || evs.some((x) => x.detalle.estado === 'alertado' && Number(x.detalle.entregados ?? 0) === 0);
    salida.push({
      viajeId: evs[0].viajeId, hitoId,
      texto: `El chofer entrega en «${r.elegido}», distinto de «${r.esperado ?? 'el patio indicado'}».${sinAvisar ? ' Nadie recibió el aviso por WhatsApp: avísale al supervisor.' : ''}`,
      desde: resp?.creadoEn ?? evs[0].creadoEn, sinAvisar,
    });
  }
  return salida;
}

export function armarAvisoPatioDistinto(v: ViajeContexto, c: Comparacion): MensajeSaliente {
  const chofer = una(v.operadorNombre ?? 'El chofer', 60) || 'El chofer';
  const folio = v.folio || v.id.slice(0, 8);
  const esperado = c.esperado ?? 'el patio indicado';
  return {
    texto: `Aviso para el supervisor: ${chofer} dice que entrega en «${c.elegido}» (viaje ${folio}), pero la instrucción dice «${esperado}». Confírmalo antes de que la caja quede en el patio equivocado y genere estadías.`,
    botones: [{ id: `${PREFIJO_BOTON.jefeAtiendo}:${v.id}`, titulo: 'Ya lo atiendo' }],
    // N08 (aviso_supervisor_patio_distinto_v1): aprobada en Meta; su entrada de catálogo la deja T-A5-59 (aquí no se toca el catálogo).
    plantilla: {
      nombre: 'aviso_supervisor_patio_distinto_v1',
      parametros: [chofer, folio, una(c.elegido, 60), una(esperado, 60)],
      botones: [{ tipo: 'respuesta_rapida', indice: 0, payload: `${PREFIJO_BOTON.jefeAtiendo}:${v.id}` }],
    },
  };
}

