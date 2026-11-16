// REPORTING del Back-office: el borrador del «Update a inversionistas» y la métrica de días de cierre.
//
//   · El borrador sale SOLO del cierre del mes y lleva siempre el mismo orden: TL;DR · MÉTRICAS · CONSTRUIDO · APRENDIDO · VIENE · ASKS · GRACIAS.
//   · Lo que el sistema no puede saber (qué se construyó, qué se aprendió, qué se pide) queda como «por completar»: no se inventa.
//   · GUARDIA DE NÚMEROS (patrón RTM): cada cifra que aparece en el texto debe existir en el cierre. Si una no existe, el borrador NO se ofrece.
//   · «0 clientes» no se pinta como crecimiento: sin clientes con cobro, o sin una base mayor que cero, no hay variación que reportar.
//   · Se guarda y se descarga; nada de aquí se envía.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mxn, numero, porcentaje, type IdiomaFormato } from '@/lib/formato';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { desdeRespuesta, OK, type Lectura } from './lectura';
import { diaMxDeInstante, diasHabilesEntre, etiquetaMes, rangoMes } from './periodo';
import { ErrorCierre, type CierreMes, type Faltante } from './cierre';

type Tr = TrDe<'admin_backoffice'>;

// ───────────────────────────── Días de cierre ─────────────────────────────

/** Objetivo propuesto (metricas-del-back-office.md §1): cerrar en ≤ 3 días hábiles. Es propuesta, no compromiso. */
export const OBJETIVO_DIAS_CIERRE = 3;

/**
 * PURA. Días hábiles entre el último día del mes y el día (de México) en que se cerró. `null` si el mes no está cerrado o la fecha no se
 * puede leer. No modela festivos: es un máximo honesto. Un cierre el mismo día del fin de mes es 0, nunca negativo.
 */
export function diasDeCierre(periodo: string, cerradoEn: string | null): number | null {
  const dia = diaMxDeInstante(cerradoEn);
  if (dia === null) return null;
  return diasHabilesEntre(rangoMes(periodo).ultimoDia, dia);
}

// ───────────────────────────── Guardia de números ─────────────────────────────

const NUMERO = /-?\$?\d[\d,]*(?:\.\d{1,12})?/g;

/** Valor absoluto de un token numérico impreso (`-$1,160.00` → 1160). */
function valorDeToken(t: string): number {
  return Math.abs(Number(t.replace(/[$,]/g, '')));
}

const redondear2 = (n: number): number => Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;

/** Las cifras que el cierre autoriza a aparecer en un texto, en pesos, conteos, tipo de cambio y fecha del periodo. */
export function cifrasDelCierre(c: CierreMes, extras: readonly number[] = []): Set<number> {
  const enPesos = [
    c.cobradoTotalCent, c.ingresosCobradosCent, c.ingresosFacturadosCent, c.ivaTrasladadoCent, c.cogsIaCent, c.gastosCent,
    c.comisionesDevengadasCent, c.clawbackCent, c.netoCent, c.pagadasSinEvidencia?.totalCent ?? null,
  ].filter((v): v is number => v !== null).map((v) => v / 100);
  const conteos = [c.nCobradas, c.pagadasSinEvidencia?.n ?? null, c.margenes?.length ?? null].filter((v): v is number => v !== null);
  const fecha = [Number(c.periodo.slice(0, 4)), Number(c.periodo.slice(5, 7))];
  const permitidas = [...enPesos, ...conteos, ...fecha, ...(c.tipoCambio === null ? [] : [c.tipoCambio]), 0, ...extras];
  return new Set(permitidas.map(redondear2));
}

/** PURA. Los números del texto que NO están en el conjunto permitido (sin repetir). Vacío = el texto pasa la guardia. */
export function numerosFueraDelCierre(markdown: string, permitidas: ReadonlySet<number>): string[] {
  const fuera: string[] = [];
  for (const m of markdown.matchAll(NUMERO)) {
    const token = m[0];
    if (!permitidas.has(redondear2(valorDeToken(token))) && !fuera.includes(token)) fuera.push(token);
  }
  return fuera;
}

// ───────────────────────────── El borrador ─────────────────────────────

export const SECCIONES_UPDATE = ['tldr', 'metricas', 'construido', 'aprendido', 'viene', 'asks', 'gracias'] as const;
export type SeccionUpdate = (typeof SECCIONES_UPDATE)[number];

export interface OpcionesUpdate {
  /** Cobrado total (con IVA) del mes anterior, para la variación. Sin base mayor que cero, no hay variación. */
  cobradoMesAnteriorCent?: number | null;
  /** Texto escrito a mano por una persona para estas secciones; sus números también pasan la guardia. */
  textos?: Partial<Record<'construido' | 'aprendido' | 'viene' | 'asks', string>>;
  idioma?: IdiomaFormato;
}

export type ResultadoUpdate =
  | { ok: true; markdown: string; secciones: SeccionUpdate[] }
  | { ok: false; motivo: 'cifras_fuera_del_cierre'; fuera: string[] };

/** PURA. Cuántos clientes tuvieron un cobro en el mes (`null` si no se pudo calcular). Un cliente con cobro sin desglose de IVA cuenta. */
export function clientesConCobro(c: CierreMes): number | null {
  if (c.margenes === null) return null;
  return c.margenes.filter((m) => m.ingresosCent === null || m.ingresosCent > 0).length;
}

const ROTULO_FALTANTE: Record<Faltante, Parameters<Tr>[0]> = {
  facturas: 'reporte.falta_facturas',
  facturas_truncadas: 'reporte.falta_facturas_truncadas',
  desglose_iva: 'reporte.falta_desglose_iva',
  costo_ia: 'reporte.falta_costo_ia',
  tipo_cambio: 'reporte.falta_tipo_cambio',
  gastos: 'reporte.falta_gastos',
  comisiones: 'reporte.falta_comisiones',
};

/** PURA. El borrador markdown del update del mes, o el motivo por el que no se ofrece. */
export function armarUpdateInversionistas(c: CierreMes, tr: Tr, opciones: OpcionesUpdate = {}): ResultadoUpdate {
  const idioma = opciones.idioma ?? 'es';
  const mes = etiquetaMes(c.periodo, idioma);
  const pesos = (cent: number | null): string => (cent === null ? tr('reporte.no_disponible') : mxn(cent / 100, idioma));
  const clientes = clientesConCobro(c);
  const base = opciones.cobradoMesAnteriorCent ?? null;
  const variacionPct = base !== null && base > 0 && c.cobradoTotalCent !== null && clientes !== null && clientes > 0
    ? Math.round(((c.cobradoTotalCent - base) / base) * 1000) / 10
    : null;

  // TL;DR: lo que se puede afirmar con el cierre, y nada más.
  const tldr: string[] = [];
  if (c.cobradoTotalCent === null) tldr.push(tr('reporte.tldr_sin_dato', { mes }));
  else if (c.cobradoTotalCent === 0) tldr.push(tr('reporte.tldr_sin_cobro', { mes }));
  else tldr.push(tr('reporte.tldr_cobro', { mes, cobrado: mxn(c.cobradoTotalCent / 100, idioma), ingresos: pesos(c.ingresosCobradosCent) }));
  if (clientes === 0) tldr.push(tr('reporte.tldr_sin_clientes'));
  else if (clientes !== null) tldr.push(tr('reporte.tldr_clientes', { n: numero(clientes, idioma) }));
  if (c.netoCent !== null) tldr.push(tr('reporte.tldr_neto', { neto: mxn(c.netoCent / 100, idioma) }));
  else tldr.push(tr('reporte.tldr_neto_nd', { faltantes: c.faltantes.map((f) => tr(ROTULO_FALTANTE[f])).join(', ') || tr('reporte.no_disponible') }));

  const linea = (rotulo: Parameters<Tr>[0], valor: string): string => `- ${tr(rotulo)}: ${valor}`;
  const metricas: string[] = [
    linea('reporte.r_cobrado', pesos(c.cobradoTotalCent)),
    linea('reporte.r_ingresos', pesos(c.ingresosCobradosCent)),
    linea('reporte.r_iva', pesos(c.ivaTrasladadoCent)),
    linea('reporte.r_facturado', pesos(c.ingresosFacturadosCent)),
    linea('reporte.r_cogs', pesos(c.cogsIaCent)),
    linea('reporte.r_gastos', pesos(c.gastosCent)),
    linea('reporte.r_comisiones', pesos(c.comisionesDevengadasCent === null || c.clawbackCent === null ? null : c.comisionesDevengadasCent - c.clawbackCent)),
    linea('reporte.r_neto', pesos(c.netoCent)),
  ];
  if (c.tipoCambio !== null) metricas.push(linea('reporte.r_tipo_cambio', `${c.tipoCambio}`));
  if (variacionPct !== null) metricas.push(linea('reporte.r_variacion', porcentaje(variacionPct, 1, idioma)));

  const libre = (clave: 'construido' | 'aprendido' | 'viene' | 'asks'): string => {
    const t = opciones.textos?.[clave]?.trim();
    return t ? t : tr('reporte.por_completar');
  };

  const bloques: Record<SeccionUpdate, string> = {
    tldr: tldr.join(' '),
    metricas: metricas.join('\n'),
    construido: libre('construido'),
    aprendido: libre('aprendido'),
    viene: libre('viene'),
    asks: libre('asks'),
    gracias: tr('reporte.gracias_texto'),
  };

  const markdown = [
    `# ${tr('reporte.titulo', { mes })}`,
    ...SECCIONES_UPDATE.map((s) => `## ${tr(`reporte.h_${s}` as Parameters<Tr>[0])}\n\n${bloques[s]}`),
  ].join('\n\n') + '\n';

  const extras = [...(variacionPct === null ? [] : [variacionPct]), ...(clientes === null ? [] : [clientes])];
  const fuera = numerosFueraDelCierre(markdown, cifrasDelCierre(c, extras));
  if (fuera.length > 0) return { ok: false, motivo: 'cifras_fuera_del_cierre', fuera };
  return { ok: true, markdown, secciones: [...SECCIONES_UPDATE] };
}

// ───────────────────────────── Persistencia del borrador ─────────────────────────────

export interface UpdateGuardado {
  periodo: string;
  borradorMd: string;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  actualizadoEn: string | null;
}

/** `ok` con `null` = esa tabla existe y aún no se guardó un borrador de ese mes. */
export async function leerUpdateInversionistas(periodo: string): Promise<Lectura<UpdateGuardado | null>> {
  try {
    const r = desdeRespuesta(
      await supabaseAdmin().from('bo_update_inversionistas').select('periodo, borrador_md, aprobado_por, aprobado_en, actualizado_en').eq('periodo', periodo).maybeSingle(),
    );
    if (r.estado !== 'ok') return r;
    const f = r.dato as { periodo: string; borrador_md: string; aprobado_por: string | null; aprobado_en: string | null; actualizado_en: string | null } | null;
    return OK(f ? { periodo: f.periodo, borradorMd: f.borrador_md, aprobadoPor: f.aprobado_por, aprobadoEn: f.aprobado_en, actualizadoEn: f.actualizado_en } : null);
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** Guarda (upsert) el borrador. Exige que el mes ya tenga su fila de cierre (la FK lo impone). Nunca envía nada. */
export async function guardarBorradorUpdate(periodo: string, markdown: string): Promise<void> {
  const { error } = await supabaseAdmin().from('bo_update_inversionistas').upsert(
    { periodo, borrador_md: markdown, actualizado_en: new Date().toISOString() },
    { onConflict: 'periodo' },
  );
  if (!error) return;
  if (error.code === '23503') throw new ErrorCierre('sin_borrador');
  if (desdeRespuesta({ data: null, error }).estado === 'no_disponible') throw new ErrorCierre('tabla_no_disponible');
  throw new Error(`guardarBorradorUpdate: ${error.message}`);
}
