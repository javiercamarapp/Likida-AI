import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { revisionDeDesglose } from '@/lib/likida/peajes/revision_cobros';
import {
  listarDecisionesCandidatos, registrarDecisionesCandidatos, ligarDecisionesAReclamo, retirarDecisionesCandidatos,
  crearReclamoDeCandidatos, guardarJustificacionesDeCruces,
} from '@/lib/likida/peajes/datos';
import {
  ACCIONES_CANDIDATO, aplicaAccion, filasDeCandidatos, filasFiltradas, normalizarFiltros, validarMotivoAccion,
  claveFila, type AccionCandidato, type FilaCandidato, type MotivoNoAplica,
} from '@/lib/likida/peajes/candidatos_tabla';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES SOBRE LA TABLA DE CANDIDATOS (T-A2-28b): reclamar / descartar / justificar,
// de a uno o en lote por filtro. NO es un archivo 'use server': la página envuelve cada llamada
// en una acción propia (capturando solo cadenas), igual que el resto de acciones de reclamación.
//
//   · IDEMPOTENTE: solo lo pendiente se decide. Un doble clic, o dos pestañas, dejan UN efecto:
//     la llave única de `peaje_candidato_accion` descarta la segunda inserción y, sin inserción
//     propia, no se crea ningún reclamo.
//   · AUDITADA: cada decisión guarda quién (rol del panel) y cuándo; descartar y justificar
//     exigen motivo.
//   · NO cambia el cobro del proveedor: no escribe nada en las líneas del desglose.
//   · EL LOTE se recalcula en el servidor con el mismo filtro y pide confirmación con el número
//     que la persona vio: si la lista cambió entre tanto, no aplica y lo dice.
// ═══════════════════════════════════════════════════════════════════════════

export const RUTA_CANDIDATOS = '/dashboard/agentes/peajes/reclamacion';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EntradaAccion {
  desgloseId: string;
  accion: AccionCandidato;
  actor: string;
  motivo?: string | null;
  /** Fecha de envío (AAAA-MM-DD) si el reclamo ya se mandó al portal; vacío = «preparado». */
  enviadoEn?: string | null;
  /** UNA fila… */
  fila?: { indice: number; categoria: string };
  /** …o todo lo que cumple el filtro, con la confirmación y el número que la persona vio. */
  filtro?: { entrada: Record<string, string | undefined>; confirmar: boolean; esperado: number };
}

export type ResultadoAccion =
  | { ok: true; aplicadas: number; omitidas: number; reclamos: number; mensaje: string }
  | { ok: false; error: string };

const TEXTO_OMITIDA: Record<MotivoNoAplica, string> = {
  ya_decidido: 'ya tenían decisión', no_reclamable: 'son avisos atípicos, no cobros (no se reclaman)', sin_fecha: 'no traen fecha (no se puede contar el plazo)',
};
const VERBO: Record<AccionCandidato, { hecho: string; nada: string }> = {
  reclamado: { hecho: 'marcado como reclamado', nada: 'reclamar' },
  descartado: { hecho: 'descartado', nada: 'descartar' },
  justificado: { hecho: 'justificado', nada: 'justificar' },
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cuántas filas tocaría `accion` con ese filtro (las que de verdad aplican): es el número que la pantalla
 * enseña y que el lote exige de vuelta para confirmar.
 */
export function aplicablesDelFiltro(filas: readonly FilaCandidato[], filtros: ReturnType<typeof normalizarFiltros>, accion: AccionCandidato): FilaCandidato[] {
  return filasFiltradas(filas, filtros).filter((f) => aplicaAccion(f, accion).ok);
}

export async function aplicarAccionCandidatos(tenantId: string, e: EntradaAccion): Promise<ResultadoAccion> {
  if (!UUID.test(e.desgloseId)) return { ok: false, error: 'Falta el desglose.' };
  if (!(ACCIONES_CANDIDATO as readonly string[]).includes(e.accion)) return { ok: false, error: 'Acción no válida.' };
  const m = validarMotivoAccion(e.accion, e.motivo);
  if (!m.ok) return { ok: false, error: m.error };
  const enviado = e.enviadoEn?.trim() || null;
  if (e.accion === 'reclamado' && enviado && !FECHA.test(enviado)) return { ok: false, error: 'La fecha de envío debe ser AAAA-MM-DD.' };
  if (e.accion !== 'reclamado' && enviado) return { ok: false, error: 'La fecha de envío solo aplica a reclamar.' };
  if (!e.fila && !e.filtro) return { ok: false, error: 'No se indicó qué candidatos decidir.' };
  if (e.filtro && !e.filtro.confirmar) return { ok: false, error: 'Marca la confirmación para aplicar a todo lo que cumple el filtro.' };

  const desgloseId = e.desgloseId.toLowerCase();
  let reporte;
  let decisiones;
  try {
    reporte = await revisionDeDesglose(tenantId, desgloseId);
    if (!reporte) return { ok: false, error: 'Ese desglose no existe en tu flota (o fue anulado).' };
    decisiones = await listarDecisionesCandidatos(tenantId, desgloseId);
  } catch (err) {
    logger.error('peajes.candidatos_accion_lectura', { tenant: tenantId, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'No se pudo leer la revisión ahora mismo. No se aplicó nada: inténtalo de nuevo.' };
  }
  const filas = filasDeCandidatos(reporte.revision.candidatos, reporte.atipicos.atipicos, decisiones);

  let objetivo: FilaCandidato[];
  if (e.fila) {
    const una = filas.find((f) => f.clave === claveFila(e.fila!.indice, e.fila!.categoria));
    if (!una) return { ok: false, error: 'Ese candidato ya no aparece en la revisión: no hay nada que decidir.' };
    objetivo = [una];
  } else {
    const filtros = normalizarFiltros(e.filtro!.entrada);
    objetivo = filasFiltradas(filas, filtros);
    const cuantas = objetivo.filter((f) => aplicaAccion(f, e.accion).ok).length;
    if (cuantas !== e.filtro!.esperado) {
      return { ok: false, error: `La lista cambió: ahora serían ${cuantas} cruces y confirmaste ${e.filtro!.esperado}. Revisa la tabla y confirma otra vez.` };
    }
  }

  const aplicables: FilaCandidato[] = [];
  const omitidasPor = new Map<MotivoNoAplica, number>();
  for (const f of objetivo) {
    const r = aplicaAccion(f, e.accion);
    if (r.ok) aplicables.push(f); else omitidasPor.set(r.motivo, (omitidasPor.get(r.motivo) ?? 0) + 1);
  }
  const textoOmitidas = [...omitidasPor].map(([k, n]) => `${n} ${TEXTO_OMITIDA[k]}`).join('; ');
  if (aplicables.length === 0) {
    // Una sola fila que no aplica es un error que se dice; un lote sin nada nuevo es un doble clic inocuo.
    return e.fila
      ? { ok: false, error: `No se puede ${VERBO[e.accion].nada} ese candidato: ${textoOmitidas || 'ya tenía decisión'}.` }
      : { ok: true, aplicadas: 0, omitidas: objetivo.length, reclamos: 0, mensaje: `No había nada nuevo que ${VERBO[e.accion].nada}${textoOmitidas ? ` (${textoOmitidas})` : ''}.` };
  }

  try {
    // Un atípico cubre varios renglones: la decisión se guarda en todos, y la fila se cuenta por el primero.
    const items = aplicables.flatMap((f) => f.indices.map((indice) => ({ indice, categoria: f.categoria })));
    const insertadas = await registrarDecisionesCandidatos(tenantId, desgloseId, items, e.accion, { motivo: m.motivo, actor: e.actor });
    const propias = new Set(insertadas.map((i) => claveFila(i.indice, i.categoria)));
    // Las que otra pestaña ganó en este mismo instante no cuentan como nuestras: sin inserción propia no hay reclamo.
    const efectivas = aplicables.filter((f) => propias.has(f.clave));

    let reclamos = 0;
    if (e.accion === 'reclamado' && efectivas.length > 0) {
      const porCategoria = new Map<string, FilaCandidato[]>();
      for (const f of efectivas) porCategoria.set(f.categoria, [...(porCategoria.get(f.categoria) ?? []), f]);
      for (const [categoria, grupo] of porCategoria) {
        const idsGrupo = insertadas.filter((i) => i.categoria === categoria && grupo.some((f) => f.indice === i.indice)).map((i) => i.id);
        try {
          const fechas = grupo.map((f) => f.fecha).filter((x): x is string => x !== null).sort();
          const reclamoId = await crearReclamoDeCandidatos(tenantId, {
            desgloseId, proveedor: reporte.proveedor, categoria, nCruces: grupo.length,
            monto: r2(grupo.reduce((s, f) => s + f.monto, 0)), fechaCobroMasAntigua: fechas[0]!, enviadoEn: enviado,
          });
          await ligarDecisionesAReclamo(tenantId, idsGrupo, reclamoId);
          reclamos++;
        } catch (err) {
          // Sin reclamo no hay «reclamado»: se retira lo de este grupo para que pueda reintentarse.
          await retirarDecisionesCandidatos(tenantId, idsGrupo).catch(() => undefined);
          logger.error('peajes.candidatos_reclamo_fallo', { tenant: tenantId, err: err instanceof Error ? err.message : String(err) });
          return { ok: false, error: `No se pudo registrar el reclamo de «${categoria}»${reclamos > 0 ? ` (los ${reclamos} anteriores sí quedaron)` : ''}. No se marcó nada de ese grupo: inténtalo de nuevo.` };
        }
      }
    }
    if (e.accion === 'justificado') {
      // Las casetas que no deben cruzarse se justifican también donde la regla las lee (misma tabla que «Justificar este cruce»).
      const prohibidas = efectivas.filter((f) => f.categoria === 'caseta_no_debe_cruzarse').map((f) => ({ indice: f.indice, motivo: m.motivo ?? '' }));
      if (prohibidas.length > 0) await guardarJustificacionesDeCruces(tenantId, desgloseId, prohibidas);
    }

    logger.info('peajes.candidatos_decididos', {
      tenant: tenantId, desglose: desgloseId, accion: e.accion, filas: efectivas.length, reclamos, lote: e.filtro !== undefined, actor: e.actor,
    });
    const omitidas = objetivo.length - efectivas.length;
    const base = `${efectivas.length} ${efectivas.length === 1 ? 'cruce' : 'cruces'} ${VERBO[e.accion].hecho}${reclamos > 0 ? ` en ${reclamos} ${reclamos === 1 ? 'reclamo' : 'reclamos'}` : ''}.`;
    return { ok: true, aplicadas: efectivas.length, omitidas, reclamos, mensaje: omitidas > 0 && textoOmitidas ? `${base} Se omitieron: ${textoOmitidas}.` : base };
  } catch (err) {
    logger.error('peajes.candidatos_accion_fallo', { tenant: tenantId, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'No se pudo guardar la decisión. Inténtalo de nuevo.' };
  }
}

/**
 * El borde del formulario: repite la puerta ADENTRO (una acción es un endpoint por POST directo), lee los
 * campos y llama al núcleo. Devuelve el resultado; la página decide a dónde volver.
 */
export async function ejecutarAccionDeFormulario(tenantId: string, fd: FormData): Promise<ResultadoAccion> {
  const sesion = await requireSessionTenant(RUTA_CANDIDATOS);
  if (!puedeVerArea(sesion.rol, 'dinero')) return { ok: false, error: 'Tu rol no puede operar reclamos de peaje.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { ok: false, error: 'Esta flota no es la tuya.' };

  const campo = (k: string) => String(fd.get(k) ?? '').trim();
  const accion = campo('accion') as AccionCandidato;
  const base = { desgloseId: campo('desglose'), accion, actor: `panel:${sesion.rol}`, motivo: campo('motivo') || null, enviadoEn: campo('enviado_en') || null };
  if (campo('modo') === 'filtro') {
    const entrada: Record<string, string | undefined> = {};
    for (const k of ['cat', 'estado', 'unidad', 'caseta', 'desde', 'hasta', 'orden']) entrada[k] = campo(`f_${k}`);
    const esperado = Number.parseInt(campo('esperado'), 10);
    return aplicarAccionCandidatos(tenantId, {
      ...base, filtro: { entrada, confirmar: campo('confirmar') === 'on', esperado: Number.isFinite(esperado) ? esperado : -1 },
    });
  }
  const indice = Number.parseInt(campo('indice'), 10);
  if (!Number.isInteger(indice) || indice < 0 || !campo('categoria')) return { ok: false, error: 'Falta el candidato.' };
  return aplicarAccionCandidatos(tenantId, { ...base, fila: { indice, categoria: campo('categoria') } });
}
