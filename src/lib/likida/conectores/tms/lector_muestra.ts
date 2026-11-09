// ═══════════════════════════════════════════════════════════════════════════
// LECTOR POR CONSULTA DEL CONTRATO «muestra-tms» (r13p, 8-nov-2026).
//
// Decisión del dueño: el cliente NO empuja; NOSOTROS CONSULTAMOS (solo lectura, cuenta de servicio) su API. Este adaptador pone la
// forma `muestra-tms` (un objeto por bitácora: BitacoraID, Operador, Unidad, Fecha{Inicia,Termina}, Percepciones, Deducciones) detrás
// del MISMO puerto `LectorDesglosesPuerto` que ya usa el pull; la forma de la consulta (ruta, parámetros, paginación, envoltorio) viene
// de `ConfigPullMuestraTms` (SUPUESTOS, ver `desglose_muestra_pull_config.ts`). No hay endpoint de escritura: solo GET.
//
// Qué reutiliza (nada se reimplementa): `SesionTms` (login, token solo en memoria, un re-login ante 401), `convertirBitacoraMuestra`
// (montos en centavos desde su texto, fechas como hora de México, operador por NOMBRE contra el padrón del tenant, nada se inventa),
// `crearLectorDeVentana` (cursor, relectura, rechazadas) y, aguas abajo, `pullDesgloses` → `recibirDesglose` (idempotencia, sin póliza ⇒
// retenida).
//
// Falla cerrado y lo dice: red/5xx/429 ⇒ `TmsNoDisponible`/`TmsLimite`; 401/403 ⇒ `TmsCredenciales`; respuesta sin la lista esperada,
// página vacía antes del total, totales que no cuadran o más páginas que el tope ⇒ `TmsNoDisponible`. En todos esos casos se LANZA y
// no se devuelve NI UNA bitácora de la lectura (el pull deja el cursor intacto). Los mensajes llevan frases propias: jamás el cuerpo del
// proveedor, el token, la clave ni nombres de operador.
// ═══════════════════════════════════════════════════════════════════════════
import { claveDeBitacora } from '../../liquidacion_externa/desglose_contrato';
import { leerRuta } from '../../liquidacion_externa/desglose_mapeo_tms';
import {
  CONTRATO_MUESTRA_TMS, convertirBitacoraMuestra, listaDeMuestra, EnvoltorioInvalido,
  type PadronOperadores, type ResultadoBitacoraMuestra,
} from '../../liquidacion_externa/desglose_muestra_tms';
import { fechaDeParametro, type ConfigPullMuestraTms } from '../../liquidacion_externa/desglose_muestra_pull_config';
import {
  TmsCredenciales, TmsLimite, TmsNoDisponible, type FilaDesgloseRechazada, type LectorDesglosesPuerto,
} from '../../liquidacion_externa/desglose_puerto';
import { jsonCualquiera } from '../posiciones_comun';
import { crearLectorDeVentana, instanteDeCursor, type Entrada } from './lector_desgloses';
import type { SesionTms } from './sesion';

const CODIGOS_OPERADOR: ReadonlySet<string> = new Set(['operador_vacio', 'operador_sin_padron', 'operador_no_encontrado', 'operador_homonimo', 'operador_sin_numero']);

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface OpcionesLectorMuestra {
  sesion: SesionTms;
  ahora: () => number;
  config: ConfigPullMuestraTms;
  /** El padrón vigente de la flota; se pide en cada lectura. Si falla, la lectura falla (cursor intacto). */
  padron: () => Promise<PadronOperadores>;
}

function idCrudo(cruda: unknown): string {
  const v = esObjeto(cruda) ? cruda.BitacoraID : undefined;
  const t = typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v.trim()) ? v.trim() : '';
  return t === '' ? 'BIT-DESCONOCIDA' : claveDeBitacora(undefined, t);
}

/** Una bitácora cruda a la entrada del cursor: desglose listo, o rechazada visible (sin nombres ni valores). */
function aEntradaMuestra(cruda: unknown, cfg: ConfigPullMuestraTms, padron: PadronOperadores): { entrada: Entrada; r: ResultadoBitacoraMuestra | null } {
  const clave = idCrudo(cruda);
  const instante = instanteDeCursor(leerRuta(cruda, cfg.campoCursor));
  if (instante === null) {
    return { entrada: { desde: new Date(0).toISOString(), id: clave, sinInstante: true, rechazada: { clave, campo: cfg.campoCursor } }, r: null };
  }
  const r = convertirBitacoraMuestra(cruda, { padron });
  if (r.desglose !== null && !r.requiereRevision) {
    return { entrada: { desde: instante, id: claveDeBitacora(r.desglose.terminal, r.desglose.bitacora), desglose: r.desglose }, r };
  }
  return { entrada: { desde: instante, id: clave, rechazada: rechazadaDe(clave, r, instante) }, r };
}

function rechazadaDe(clave: string, r: ResultadoBitacoraMuestra, instante: string): FilaDesgloseRechazada {
  const operador = r.revision.filter((m) => CODIGOS_OPERADOR.has(m.codigo));
  if (operador.length > 0) {
    const ambiguo = operador.some((m) => m.codigo === 'operador_homonimo');
    return {
      clave, campo: 'Operador', tipo: 'operador_no_encontrado',
      // Solo bitácora, motivo, origen y el instante (para releer cuando el padrón se complete); nunca el nombre del operador.
      detalle: { bitacora: r.bitacoraId, motivo: ambiguo ? 'nombre_ambiguo' : 'nombre_sin_alta', origen: CONTRATO_MUESTRA_TMS, desde: instante },
    };
  }
  return { clave, campo: r.revision[0]?.campo ?? 'BitacoraID' };
}

export function crearLectorMuestraTms(o: OpcionesLectorMuestra): LectorDesglosesPuerto {
  const cfg = o.config;
  const paginado = cfg.params.pagina !== null && cfg.params.tam !== null;

  async function leerVentana(desde: string, hasta: string): Promise<Entrada[]> {
    const padron = await o.padron();
    const crudas: unknown[] = [];
    let totalRegistros: number | null = null;
    for (let pagina = 1; pagina <= (paginado ? cfg.maxPaginas : 1); pagina++) {
      const query: Record<string, string | number> = {
        [cfg.params.desde]: fechaDeParametro(desde, cfg.formatoFechaParam),
        [cfg.params.hasta]: fechaDeParametro(hasta, cfg.formatoFechaParam),
      };
      if (paginado) { query[cfg.params.pagina as string] = pagina; query[cfg.params.tam as string] = cfg.tamano; }
      const r = await o.sesion.peticion({ ruta: cfg.ruta, query });
      if (!r.ok) {
        if (r.falla === 'credencial') throw new TmsCredenciales();
        if (/429|l[ií]mite/i.test(r.motivo)) throw new TmsLimite();
        throw new TmsNoDisponible();
      }
      const estado = r.r.estado;
      if (estado === 401 || estado === 403) throw new TmsCredenciales(`El sistema de transporte contestó ${estado} al leer bitácoras`);
      if (estado < 200 || estado >= 300) throw new TmsNoDisponible(`El sistema de transporte contestó ${estado} al leer bitácoras`);
      const cuerpo = jsonCualquiera(r.r.cuerpo);
      let items: unknown[];
      try {
        items = listaDeMuestra(cuerpo, { envoltorio: cfg.envoltorio, rutaLista: cfg.rutaLista });
      } catch (e) {
        if (!(e instanceof EnvoltorioInvalido)) throw e;
        throw new TmsNoDisponible('La respuesta del sistema de transporte no trae la lista de bitácoras esperada');
      }
      crudas.push(...items);
      const totalPag = cfg.rutaTotalPaginas !== null ? Number(leerRuta(cuerpo, cfg.rutaTotalPaginas)) : NaN;
      if (cfg.rutaTotalRegistros !== null) {
        const t = Number(leerRuta(cuerpo, cfg.rutaTotalRegistros));
        if (Number.isInteger(t) && t >= 0) totalRegistros = t;
      }
      const conTotal = Number.isFinite(totalPag) && totalPag >= 1;
      // Una página vacía ANTES del total anunciado es una lectura incompleta, no el fin.
      if (paginado && conTotal && items.length === 0 && pagina < totalPag) throw new TmsNoDisponible('Paginación incompleta: el sistema devolvió una página vacía antes del total');
      const fin = !paginado || items.length === 0 || (conTotal ? pagina >= totalPag : items.length < cfg.tamano);
      if (fin) {
        if (totalRegistros !== null && totalRegistros !== crudas.length) throw new TmsNoDisponible('Paginación incompleta: lo leído no coincide con el total que declara el sistema');
        return construir(crudas, cfg, padron);
      }
    }
    // Más páginas que el tope: no se declara completa una lectura que no lo es (el cursor no avanza).
    throw new TmsNoDisponible('La lectura excedió el tope de páginas');
  }

  return crearLectorDeVentana({ ahora: o.ahora, ventanaInicialDias: cfg.ventanaInicialDias, leerVentana });
}

/** Convierte todo lo leído; una `BitacoraID` repetida con contenido distinto manda TODAS sus copias a revisión (no se adivina cuál vale). */
function construir(crudas: unknown[], cfg: ConfigPullMuestraTms, padron: PadronOperadores): Entrada[] {
  const huellas = new Map<string, Set<string>>();
  for (const c of crudas) {
    const id = idCrudo(c);
    if (id === 'BIT-DESCONOCIDA') continue;
    const set = huellas.get(id) ?? new Set<string>();
    set.add(JSON.stringify(c));
    huellas.set(id, set);
  }
  const vistas = new Set<string>();
  const salida: Entrada[] = [];
  for (const c of crudas) {
    const id = idCrudo(c);
    const variantes = huellas.get(id)?.size ?? 0;
    if (variantes > 1) {
      const instante = instanteDeCursor(leerRuta(c, cfg.campoCursor));
      salida.push(instante === null
        ? { desde: new Date(0).toISOString(), id, sinInstante: true, rechazada: { clave: id, campo: 'BitacoraID' } }
        : { desde: instante, id, rechazada: { clave: id, campo: 'BitacoraID' } });
      continue;
    }
    // Copia idéntica (p. ej. una página que se traslapó): se cuenta una vez.
    const huella = `${id}|${JSON.stringify(c)}`;
    if (id !== 'BIT-DESCONOCIDA' && vistas.has(huella)) continue;
    vistas.add(huella);
    salida.push(aEntradaMuestra(c, cfg, padron).entrada);
  }
  return salida;
}
