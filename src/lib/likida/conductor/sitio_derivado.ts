import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// DERIVAR EL SITIO DE UN VIAJE SIN CONVENIO (P2, ola 4c).
//
// La única liga automática viaje→sitio era la del convenio (`convenios/repo.ts`). Un viaje sin convenio quedaba SIN sitio, y
// sin sitio no hay geocerca contra la cual detectar la llegada ni validar el «ya llegué». Aquí el sitio se deriva del TEXTO del
// origen y del destino del viaje, y solo cuando no hay duda:
//
//   1. el código del sitio aparece como palabra completa en el texto («PLZ-01 Zapopan»);
//   2. el nombre del sitio ES el texto (sin acentos, mayúsculas ni puntuación);
//   3. el nombre COMPLETO del sitio aparece dentro del texto, con un mínimo de longitud para que un nombre genérico («Sur») no
//      ligue cualquier texto que lo mencione. Al revés NO: un texto corto («Monterrey») dentro del nombre de un sitio no lo liga.
//
// Se usa el primer criterio que dé candidatos. Con UN candidato se asigna. Con varios y un cliente en el viaje se queda con el
// que es de ESE cliente si es uno solo; si sigue habiendo duda NO se asigna nada: queda la excepción «sin sitio para conciliar»
// del tablero, que es el aviso honesto. Un sitio equivocado valida llegadas contra el lugar equivocado, y eso es peor que no tener.
//
// Se deriva UNA vez por (viaje, lado) (0637): si la oficina quita o cambia después el sitio, no se vuelve a pisar su decisión. Nunca
// se sobrescribe un sitio que el viaje ya trae (convenio o captura manual).
// ═══════════════════════════════════════════════════════════════════════════

export type CriterioSitio = 'codigo' | 'nombre_exacto' | 'nombre_contenido';
export type LadoViaje = 'origen' | 'destino';

export interface SitioCatalogo {
  id: string;
  nombre: string;
  codigo: string | null;
  clienteId: string | null;
}

/** Minúsculas, sin acentos, sin puntuación y con espacios simples. */
export function normalizarNombre(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Longitud mínima (ya normalizada) para ligar por contenido: debajo de esto el nombre es demasiado genérico. */
export const MIN_LARGO_CONTENIDO = 8;

const comoPalabras = (n: string): string => ` ${n} `;

export interface SitioDerivado { sitioId: string; criterio: CriterioSitio }

export function derivarSitio(texto: string | null | undefined, catalogo: readonly SitioCatalogo[], clienteId: string | null = null): SitioDerivado | null {
  const n = normalizarNombre(texto ?? '');
  if (n.length < 4 || catalogo.length === 0) return null;
  const palabras = comoPalabras(n);
  const norm = catalogo.map((s) => ({ s, nombre: normalizarNombre(s.nombre), codigo: s.codigo ? normalizarNombre(s.codigo) : '' }));

  const tiers: Array<[CriterioSitio, SitioCatalogo[]]> = [
    ['codigo', norm.filter((x) => x.codigo.length >= 3 && palabras.includes(comoPalabras(x.codigo))).map((x) => x.s)],
    ['nombre_exacto', norm.filter((x) => x.nombre === n).map((x) => x.s)],
    // Solo el nombre COMPLETO del sitio dentro del texto del viaje. Al revés (el texto dentro del nombre) un «Monterrey» a secas
    // ligaría el único sitio que lo menciona, y una ciudad no es una planta.
    ['nombre_contenido', norm.filter((x) => x.nombre !== n && x.nombre.length >= MIN_LARGO_CONTENIDO && palabras.includes(comoPalabras(x.nombre))).map((x) => x.s)],
  ];
  for (const [criterio, candidatos] of tiers) {
    if (candidatos.length === 0) continue;
    if (candidatos.length === 1) return { sitioId: candidatos[0].id, criterio };
    // Varios que encajan: solo el cliente del viaje desempata, y solo si deja a uno.
    if (clienteId) {
      const delCliente = candidatos.filter((c) => c.clienteId === clienteId);
      if (delCliente.length === 1) return { sitioId: delCliente[0].id, criterio };
    }
    return null; // duda: no se asigna
  }
  return null;
}

// ── El barrido (con puertos) ────────────────────────────────────────────────

export interface CandidatoSitio {
  tenantId: string;
  viajeId: string;
  origen: string | null;
  destino: string | null;
  clienteId: string | null;
  /** Lados que el viaje ya trae asignados (convenio o captura manual): no se tocan. */
  conSitio: ReadonlySet<LadoViaje>;
  /** Lados que ya se derivaron una vez (0637): no se re-derivan sobre la decisión de la oficina. */
  yaDerivados: ReadonlySet<LadoViaje>;
}

export interface PuertosSitioDerivado {
  candidatos(limite: number): Promise<CandidatoSitio[]>;
  catalogo(tenantIds: string[]): Promise<Map<string, SitioCatalogo[]>>;
  /** Asigna el sitio SOLO si el viaje sigue sin él y reclama la derivación (única por viaje y lado). */
  asignar(tenantId: string, viajeId: string, lado: LadoViaje, sitioId: string, criterio: CriterioSitio, ahora: Date): Promise<'ok' | 'ya' | 'fallo'>;
}

export interface ResultadoSitioDerivado {
  candidatos: number;
  derivados: number;
  sinCoincidencia: number;
  yaAsignados: number;
  fallos: number;
  cortadosPorReloj: number;
}

export const TOPE_VIAJES_SITIO_DERIVADO = 300;

export async function barridoSitioDerivado(p: PuertosSitioDerivado, ahora: Date = new Date(), venceEn?: number): Promise<ResultadoSitioDerivado> {
  const r: ResultadoSitioDerivado = { candidatos: 0, derivados: 0, sinCoincidencia: 0, yaAsignados: 0, fallos: 0, cortadosPorReloj: 0 };
  const candidatos = await p.candidatos(TOPE_VIAJES_SITIO_DERIVADO);
  r.candidatos = candidatos.length;
  if (candidatos.length === 0) return r;
  const catalogos = await p.catalogo([...new Set(candidatos.map((c) => c.tenantId))]);

  for (const [i, c] of candidatos.entries()) {
    if (venceEn !== undefined && Date.now() >= venceEn) { r.cortadosPorReloj = candidatos.length - i; break; }
    const catalogo = catalogos.get(c.tenantId) ?? [];
    for (const lado of ['origen', 'destino'] as const) {
      if (c.conSitio.has(lado) || c.yaDerivados.has(lado)) continue;
      const d = derivarSitio(lado === 'origen' ? c.origen : c.destino, catalogo, c.clienteId);
      if (!d) { r.sinCoincidencia++; continue; }
      try {
        const res = await p.asignar(c.tenantId, c.viajeId, lado, d.sitioId, d.criterio, ahora);
        if (res === 'ok') r.derivados++; else if (res === 'ya') r.yaAsignados++; else r.fallos++;
      } catch (e) {
        r.fallos++;
        logger.warn('conductor.sitio_derivado_fallo', { viaje: c.viajeId, lado, err: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return r;
}
