// ═══════════════════════════════════════════════════════════════════════════
// LEER UN DÍA DEL DOF (SIDOF) SIN CREERLE EL SILENCIO.
//
// Formas reales, verificadas con curl el 14-nov-2026 (sin auth):
//
//   GET …/dof/sidof/diarios/porFecha/{DD-MM-AAAA}
//       → HTTP 200 {"messageCode":200,"response":"OK","Matutina":[…]|null,"Vespertina":[…]|null,"Extraordinaria":[…]|null}
//       → HTTP 404 {"messageCode":404,"response":"NOT_FOUND"}  cuando ese día NO hubo ninguna edición (sábados y
//         domingos sin publicación, fechas futuras…).
//   GET …/dof/sidof/notas/{DD-MM-AAAA}
//       → HTTP 200 {"messageCode":200,"response":"OK","NotasMatutinas":[…],"NotasVespertinas":[…],
//         "NotasExtraordinarias":[…],"imagenesDiario":[…],"audioSumario":[…]}. Cada nota: {codNota, titulo?, …}.
//         Un día sin DOF trae TODAS las listas vacías, igual que un SIDOF caído: por eso el cruce de abajo.
//       Algunas notas vienen SIN `titulo`: son encabezados de organismo (tamanioContenido 0), no publicaciones.
//
// EL MODO DE FALLA 3 (references/fuentes.md): el SIDOF contesta 200 con arrays vacíos cuando falla. Aquí un «sin
// notas» solo se acepta si `diarios` lo respalda (no hubo edición) y el día no es hábil; todo lo demás es FALLO DE LA
// FUENTE, no «sin novedades».
// ═══════════════════════════════════════════════════════════════════════════

import { esDiaHabil } from './fechas';

export type Edicion = 'Matutina' | 'Vespertina' | 'Extraordinaria';
const EDICIONES: readonly Edicion[] = ['Matutina', 'Vespertina', 'Extraordinaria'];
const CLAVE_NOTAS: Record<Edicion, string> = { Matutina: 'NotasMatutinas', Vespertina: 'NotasVespertinas', Extraordinaria: 'NotasExtraordinarias' };

export interface RespuestaHttp {
  status: number;
  etag: string | null;
  lastModified: string | null;
  /** JSON ya parseado; `null` si el cuerpo no era JSON (o es un HEAD). */
  cuerpo: unknown;
}

export interface NotaDof { codNota: number; titulo: string | null; edicion: Edicion }

export type CodigoFalloDia = 'diarios_forma' | 'notas_forma' | 'edicion_sin_notas' | 'dia_habil_sin_notas';
export interface FalloDia {
  codigo: CodigoFalloDia;
  causa: string;
  /** `diarios` respondió «ninguna edición» (404): lo que distingue un feriado de una caída, ver `ejecutar.ts`. */
  diariosSinEdicion?: boolean;
}

export interface ResultadoDia {
  fecha: string;
  notas: NotaDof[];
  /** Notas sin `titulo`: no se pueden cruzar contra el diccionario; se cuentan, no se esconden. */
  sinTitulo: number;
  fallo: FalloDia | null;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function edicionesQueSalieron(diarios: RespuestaHttp): Set<Edicion> | FalloDia {
  const c = diarios.cuerpo;
  if (diarios.status === 404 || (esObjeto(c) && c.messageCode === 404)) return new Set();
  if (diarios.status !== 200 || !esObjeto(c) || c.messageCode !== 200) {
    return { codigo: 'diarios_forma', causa: `diarios/porFecha respondió HTTP ${diarios.status} con una forma inesperada` };
  }
  const salieron = new Set<Edicion>();
  for (const e of EDICIONES) {
    const v = c[e];
    if (Array.isArray(v) && v.length > 0) salieron.add(e);
  }
  return salieron;
}

/**
 * Juzga un día. `fecha` es `AAAA-MM-DD`. No lanza: toda forma rara es un `fallo` con causa legible.
 */
export function evaluarDia(fecha: string, diarios: RespuestaHttp, notas: RespuestaHttp): ResultadoDia {
  const vacio = (fallo: FalloDia): ResultadoDia => ({ fecha, notas: [], sinTitulo: 0, fallo });

  const c = notas.cuerpo;
  if (notas.status !== 200 || !esObjeto(c) || c.messageCode !== 200) {
    return vacio({ codigo: 'notas_forma', causa: `notas respondió HTTP ${notas.status} con una forma inesperada` });
  }
  const porEdicion = {} as Record<Edicion, unknown[]>;
  for (const e of EDICIONES) {
    const lista = c[CLAVE_NOTAS[e]];
    if (!Array.isArray(lista)) return vacio({ codigo: 'notas_forma', causa: `notas no trae la lista ${CLAVE_NOTAS[e]}: el SIDOF cambió de forma` });
    porEdicion[e] = lista;
  }

  const salieron = edicionesQueSalieron(diarios);
  if (!(salieron instanceof Set)) return vacio(salieron);

  const lista: NotaDof[] = [];
  let sinTitulo = 0;
  for (const e of EDICIONES) {
    for (const item of porEdicion[e]) {
      if (!esObjeto(item)) continue;
      const cod = Number(item.codNota);
      if (!Number.isFinite(cod)) continue;
      const titulo = typeof item.titulo === 'string' && item.titulo.trim() !== '' ? item.titulo.trim() : null;
      if (titulo === null) sinTitulo += 1;
      lista.push({ codNota: cod, titulo, edicion: e });
    }
  }

  // ── EL CRUCE ANTI-SILENCIO ────────────────────────────────────────────
  // 1. `diarios` dice que salió una edición y sus notas vienen vacías → la fuente falló (nunca «sin novedades»).
  for (const e of EDICIONES) {
    if (salieron.has(e) && !lista.some((n) => n.edicion === e)) {
      return { fecha, notas: lista, sinTitulo, fallo: { codigo: 'edicion_sin_notas', causa: `diarios dice que salió la edición ${e} pero sus notas vienen vacías` } };
    }
  }
  // 2. Un día hábil (lunes a viernes) con 0 notas es siempre un fallo (canario del modo de falla 3).
  if (lista.length === 0 && esDiaHabil(fecha)) {
    return { fecha, notas: lista, sinTitulo, fallo: { codigo: 'dia_habil_sin_notas', causa: 'día hábil con 0 notas en todas las ediciones', diariosSinEdicion: salieron.size === 0 } };
  }
  return { fecha, notas: lista, sinTitulo, fallo: null };
}
