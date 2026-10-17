import {
  AGENTES_INSIGHT,
  SEVERIDADES,
  TIPOS_INSIGHT,
  type AgenteInsight,
  type Insight,
} from './tipos';

/** Regla pura: mismo `datos`, mismo resultado. Sin reloj, sin red, sin LLM. */
export interface Regla<D> {
  id: string;
  agente: AgenteInsight;
  aplica(datos: D): boolean;
  producir(datos: D): Insight;
}

export class ErrorInsight extends Error {
  constructor(
    public readonly reglaId: string,
    mensaje: string,
  ) {
    super(`[insight ${reglaId}] ${mensaje}`);
    this.name = 'ErrorInsight';
  }
}

/** Identidad tipada: ayuda a inferir `D` al declarar reglas. */
export function definirRegla<D>(regla: Regla<D>): Regla<D> {
  return regla;
}

const texto = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Valida en ejecución las invariantes que el tipo ya exige en compilación.
 * Lanza ErrorInsight; devuelve el mismo insight si es válido.
 */
export function validarInsight(insight: Insight, reglaId = insight?.id ?? '?'): Insight {
  const err = (m: string): never => {
    throw new ErrorInsight(reglaId, m);
  };
  if (!insight || typeof insight !== 'object') return err('el insight no es un objeto');
  const i = insight as unknown as Record<string, unknown>;

  if (!texto(i.id)) err('falta id');
  if (!(AGENTES_INSIGHT as readonly string[]).includes(i.agente as string)) err('agente inválido');
  if (!(TIPOS_INSIGHT as readonly string[]).includes(i.tipo as string)) err('tipo inválido');
  if (!(SEVERIDADES as readonly string[]).includes(i.severidad as string)) err('severidad inválida');
  if (!texto(i.quePaso)) err('falta quePaso');
  if (!texto(i.queSignifica)) err('falta queSignifica');
  if (!texto(i.queHacer)) err('falta queHacer');

  const f = i.fuente as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object') err('falta fuente: todo número lleva fuente');
  const fuente = f as Record<string, unknown>;
  if (!texto(fuente.tabla) && !texto(fuente.archivo) && !texto(fuente.calculo)) {
    err('fuente sin tabla, archivo ni calculo');
  }
  if (!texto(fuente.periodo)) err('fuente sin periodo');
  if (typeof fuente.n !== 'number' || !Number.isInteger(fuente.n) || fuente.n < 0) {
    err('fuente.n debe ser un entero >= 0');
  }

  if (i.accion !== undefined) {
    const a = i.accion as Record<string, unknown>;
    if (!a || !texto(a.rotulo) || !texto(a.ruta)) err('accion incompleta (rotulo y ruta)');
  }

  if (i.tipo === 'candidato') {
    if (!/candidato/i.test(i.queSignifica as string)) {
      err('un candidato debe decir «candidato» en queSignifica');
    }
    const hacer = i.queHacer as string;
    if (!/valid|verific/i.test(hacer)) {
      err('un candidato exige un queHacer de verificación (validar/verificar)');
    }
    if (/^\s*reclam/i.test(hacer)) {
      err('un candidato nunca se reclama directo: primero validar con el proveedor/tarifario');
    }
  }
  if (i.tipo === 'simulado' || i.tipo === 'ejemplo') {
    if (!texto(i.rotulo)) err(`un insight ${String(i.tipo)} exige rótulo visible`);
  }
  return insight;
}
