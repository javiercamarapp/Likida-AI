// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIONES DETERMINISTAS DE ERRORES HUMANOS (V01-V21) — punto de entrada.
//
//   validarFicha(ficha, contexto, config?)   → V01-V05, V07 (huella), V08-V14, V16-V21 y P01 sobre una ficha/servicio
//   validarCambio(antes, despues, contexto)  → V07 (cambio entre dos fichas)
//   validarPool(filas, contexto, config?)    → V06 (pool/programa con cajas duplicadas)
//   validarPrograma(anterior, actual)        → V15 (programa que cambia)
//   validarSolicitudDatosOperador(...)       → P01 (privacidad)
//
// PURO y NUNCA LANZA: ante una entrada incompleta devuelve un hallazgo de «dato ausente»; ante un fallo interno, un bloqueo
// que lo dice. Ninguna validación corrige el dato: retiene, avisa y sugiere. Todo ordenado por severidad (bloqueo > aviso > info).
// Aún NO está cableado a producción (ver VALIDACIONES.md).
// ═══════════════════════════════════════════════════════════════════════════
import { ausente, hallazgo, ordenar, resolverConfig } from './base';
import { REGLAS_CAMBIOS, validarCambio as validarV07, validarPrograma } from './cambios';
import { REGLAS_DOCUMENTOS } from './documentos';
import { REGLAS_FECHAS } from './fechas';
import { REGLAS_PERSONAS } from './personas';
import { REGLAS_PLACAS_CAJAS, validarPoolCajas } from './placas_cajas';
import { REGLAS_PRIVACIDAD, validarDestinatarioFicha, validarSolicitanteDatosOperador } from './privacidad';
import type { ConfigValidaciones, ContextoPool, ContextoValidacion, FamiliaValidacion, FichaValidable, FilaPool, Hallazgo, IdValidacion, Regla, ServicioPrograma } from './tipos';
import { IDS_VALIDACION } from './tipos';

export type * from './tipos';
export { IDS_VALIDACION };
export { CONFIG_POR_DEFECTO, resolverConfig } from './base';
export { huellaFicha, camposCambiados, validarPrograma } from './cambios';
export { validarFichaTexto } from './personas';
export { validarSolicitanteDatosOperador } from './privacidad';

const REGLAS: Regla[] = [
  ...REGLAS_PLACAS_CAJAS, ...REGLAS_PERSONAS, ...REGLAS_FECHAS, ...REGLAS_DOCUMENTOS, ...REGLAS_CAMBIOS, ...REGLAS_PRIVACIDAD,
];

export type AmbitoValidacion = 'ficha' | 'cambio' | 'pool' | 'programa';

export interface EntradaCatalogo {
  id: IdValidacion;
  nombre: string;
  familia: FamiliaValidacion;
  ambito: AmbitoValidacion;
  entradas: string[];
}

/** Catálogo completo V01-V21 (lo usa la prueba de cobertura y el documento). */
export const CATALOGO_VALIDACIONES: EntradaCatalogo[] = IDS_VALIDACION.map((id) => {
  const r = REGLAS.find((x) => x.id === id);
  if (r) return { id, nombre: r.nombre, familia: r.familia, ambito: id === 'V07' ? ('cambio' as const) : ('ficha' as const), entradas: r.entradas };
  if (id === 'V06') return { id, nombre: 'Caja duplicada en pool/programa', familia: 'placas_cajas' as const, ambito: 'pool' as const, entradas: ['filas[caja|ubicacion|linea|dia|servicio|tipo|suspensionAire|estado]', 'catalogoCajas'] };
  return { id, nombre: 'Programa que cambia o total distinto', familia: 'cambios_prealerta' as const, ambito: 'programa' as const, entradas: ['programa anterior', 'programa actual'] };
});

function ejecutar(r: Regla, f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  try {
    if (!r.aplica(f, c)) {
      return cfg.reportarAusentes === 'todo' && !r.nucleo
        ? [hallazgo(r.id, 'info', `${r.nombre}: no se evaluó (falta ${r.entradas.join(', ')}).`, [], 'Aportar esos datos si se quiere esta validación.', true)]
        : [];
    }
    return r.evaluar(f, c, cfg);
  } catch {
    return [hallazgo(r.id, 'bloqueo', `La validación «${r.nombre}» no pudo evaluarse.`, [], 'Revisar la entrada; no se envía hasta que una persona lo confirme.')];
  }
}

function objeto<T extends object>(v: unknown): T {
  return (v && typeof v === 'object' ? v : {}) as T;
}

export function validarFicha(ficha: FichaValidable, contexto: ContextoValidacion, config?: Partial<ConfigValidaciones>): Hallazgo[] {
  const cfg = resolverConfig(config);
  const f = objeto<FichaValidable>(ficha);
  const c = objeto<ContextoValidacion>(contexto);
  const hs: Hallazgo[] = [];
  if (typeof c.ahora !== 'string' || c.ahora === '') hs.push(ausente('V05', 'la fecha de referencia (ahora)', ['ahora'], 'bloqueo'));
  for (const r of REGLAS) hs.push(...ejecutar(r, f, c, cfg));
  try {
    hs.push(...validarDestinatarioFicha(f, c));
  } catch {
    hs.push(hallazgo('P01', 'bloqueo', 'No pudo evaluarse el destinatario de la ficha.', ['destinatario'], 'No enviar datos personales hasta confirmarlo.'));
  }
  return ordenar(hs);
}

export function validarCambio(antes: FichaValidable, despues: FichaValidable, contexto: ContextoValidacion, config?: Partial<ConfigValidaciones>): Hallazgo[] {
  const cfg = resolverConfig(config);
  try {
    return ordenar(validarV07(objeto<FichaValidable>(antes), objeto<FichaValidable>(despues), objeto<ContextoValidacion>(contexto), cfg));
  } catch {
    return [hallazgo('V07', 'bloqueo', 'La validación de cambio no pudo evaluarse.', [], 'No reenviar la ficha hasta que una persona lo confirme.')];
  }
}

export function validarPool(filas: readonly FilaPool[], contexto: ContextoPool, config?: Partial<ConfigValidaciones>): Hallazgo[] {
  const cfg = resolverConfig(config);
  try {
    return ordenar(validarPoolCajas(Array.isArray(filas) ? filas : [], objeto<ContextoPool>(contexto), cfg));
  } catch {
    return [hallazgo('V06', 'bloqueo', 'La validación del pool no pudo evaluarse.', [], 'No publicar el pool hasta revisarlo.')];
  }
}

export function validarProgramaVersiones(anterior: readonly ServicioPrograma[] | undefined, actual: readonly ServicioPrograma[] | undefined): Hallazgo[] {
  try {
    return ordenar(validarPrograma(anterior, actual));
  } catch {
    return [hallazgo('V15', 'bloqueo', 'La comparación de programas no pudo evaluarse.', [], 'Revisar el programa a mano.')];
  }
}

export function validarSolicitudDatosOperador(solicitante: { id?: string; verificado?: boolean } | undefined, contexto: Pick<ContextoValidacion, 'listaBlancaDatosOperador'>): Hallazgo[] {
  try {
    return validarSolicitanteDatosOperador(solicitante, objeto(contexto));
  } catch {
    return [hallazgo('P01', 'bloqueo', 'No pudo evaluarse al solicitante.', ['solicitante'], 'No responder; avisar al encargado.')];
  }
}
