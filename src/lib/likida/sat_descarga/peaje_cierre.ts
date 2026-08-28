// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE CIERRE DE MES DE PEAJE (0231) — la contracara honesta de la
// descarga masiva.
//
// LO QUE CAE SOLO: todo comprobante que el comercio ya timbró al RFC de la
// flota. Monederos de combustible autorizados (el emisor timbra por periodo
// con complemento ECC), TeleVía tras un alta única de datos fiscales, y PASE
// pospago EN MODALIDAD MENSUAL. Eso lo recoge la descarga masiva y este
// archivo no tiene nada que hacer ahí.
//
// LO QUE NO CAE SOLO: PASE prepago (factura la RECARGA, en su portal), PASE
// pospago por cruce (portal, selección manual) y, muy probablemente,
// IAVE/CAPUFE (bajo demanda desde su portal). Ésos siguen exigiendo que
// alguien entre a un sitio — Y ESE DERECHO CADUCA.
//
// ─────────────────────────────────────────────────────────────────────────
// LA REGLA QUE HACE QUE ESTO EXISTA
//
// PASE extingue el derecho a facturar EL ÚLTIMO DÍA DEL MES EN CURSO (regla
// vigente desde diciembre de 2021, verificada en su propio sitio). O sea: un
// cruce del 3 de septiembre se factura hasta el 30 de septiembre, y el 1 de
// octubre ya no. Un panel que concilia a mes vencido —que es lo natural, y lo
// que hace un contador— LLEGA TARDE SIEMPRE, por diseño y no por descuido.
//
// Por eso esto no es un reporte: es un RELOJ, de la misma familia que los
// relojes legales (`relojes_legales.ts`) y los avisos de vigencia (0202).
// Avisa ANTES, con la lista de lo que falta, al teléfono del dinero. Y sella
// lo avisado para no convertirse en spam: una vez por (flota, mes, umbral), y
// un mes nuevo es un ciclo nuevo.
//
// LIKIDA NO FACTURA POR NADIE. Avisa con el plazo y el paso exacto; entrar al
// portal de PASE sigue siendo un acto de la flota — el mismo principio que
// gobierna los otros relojes ("Likida AVISA; jamás ejecuta el acto legal").
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';
import { hoyMx, mxn } from '@/lib/formato';
import { sendText } from '@/lib/meta/client';
import { telefonoParaDineroDe } from '../contactos';

/** Con cuántos días de anticipación se avisa cuando la flota no declaró otra
 *  cosa. Siete días deja una semana hábil para entrar al portal — y el aviso
 *  del último día (umbral 0) sale siempre, porque es el que ya no admite
 *  postergarse. */
export const DIAS_AVISO_DEFECTO = 7;

/** Cuántos cruces se listan en el WhatsApp antes de mandar al panel. Mismo
 *  tope que el vigilante de reglas: un mensaje de 300 líneas no se lee. */
export const MAX_LINEAS = 10;

export interface GastoPorFacturar {
  id: string;
  monto: number;
  fecha: string;
}

/** El último día del mes al que pertenece `hoy`. */
export function ultimoDiaDelMes(hoy: string): string {
  const [a, m] = hoy.split('-').map(Number);
  // Día 0 del mes siguiente = último del actual, sin tabla de bisiestos.
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** El primer día del mes: el CICLO del sello. */
export function primerDiaDelMes(hoy: string): string {
  return `${hoy.slice(0, 7)}-01`;
}

export function diasHastaCierre(hoy: string): number {
  return Math.round(
    (Date.parse(`${ultimoDiaDelMes(hoy)}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * ¿Toca avisar hoy, y con qué umbral? PURO: la decisión de cuándo hablar es
 * exactamente lo que hay que poder probar sin reloj ni base.
 *
 * Dos umbrales, y solo dos, por la misma razón que `UMBRALES_VIGENCIA` tiene
 * tres: uno con margen para actuar (el que la flota configura) y uno el día
 * del cierre, que ya no admite postergarse. Un aviso diario durante el mes
 * entrena a ignorarlo, que es la forma más eficaz de no avisar.
 */
export function umbralDeHoy(hoy: string, diasAviso = DIAS_AVISO_DEFECTO): number | null {
  const faltan = diasHastaCierre(hoy);
  if (faltan === 0) return 0;
  if (faltan === diasAviso) return diasAviso;
  return null;
}

export function mensajeCierrePeaje(
  gastos: readonly GastoPorFacturar[],
  faltan: number,
  total: number,
): string {
  const cabeza = faltan === 0
    ? '⏰ HOY vence el derecho a facturar tus casetas de este mes.'
    : `⏰ Faltan ${faltan} días para que venza el derecho a facturar tus casetas de este mes.`;
  const cuerpo = gastos.slice(0, MAX_LINEAS).map((g) => `· ${g.fecha} — ${mxn(g.monto)}`);
  const resto = gastos.length - cuerpo.length;
  const cola = resto > 0 ? `\n…y ${resto} cruce${resto === 1 ? '' : 's'} más.` : '';
  return [
    cabeza,
    `Tienes ${gastos.length} cruce${gastos.length === 1 ? '' : 's'} de caseta sin CFDI por ${mxn(total)}:`,
    cuerpo.join('\n') + cola,
    'PASE extingue el derecho a facturar el último día del mes en curso: lo que no se facture hoy ya no se puede. Entra a tu portal de PASE/IAVE y factúralos — el detalle está en Combustible y casetas.',
  ].join('\n');
}

export interface ResumenCierrePeaje {
  corrio: boolean;
  flotas: number;
  avisadas: number;
  sinDestinatario: number;
  gastos: number;
}

/**
 * El barrido: por cada flota, si hoy cruza un umbral y hay casetas sin CFDI,
 * avisa y sella.
 *
 * EL ORDEN ES LA INVARIANTE (patrón 0202, igual que el vigilante de reglas):
 * se manda PRIMERO y se sella DESPUÉS. Sellar antes de que el WhatsApp salga
 * dejaría a la flota sin aviso y al sistema convencido de que ya avisó.
 */
export async function avisarCierrePeaje(ahora: Date = new Date()): Promise<ResumenCierrePeaje> {
  const hoy = hoyMx(ahora);
  const periodo = primerDiaDelMes(hoy);
  const faltan = diasHastaCierre(hoy);

  // Las flotas que tienen casetas sin CFDI ESTE MES. Se parte de los gastos y
  // no del catálogo de flotas: una flota sin casetas no necesita el aviso, y
  // recorrer todos los tenants para descubrirlo sería trabajo por nada.
  const { data: gastos, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('id, tenant_id, monto, fecha')
    .eq('concepto', 'caseta')
    .is('cfdi_uuid', null)
    .gte('fecha', periodo)
    .lte('fecha', hoy)
    .limit(5000), 'peaje_cierre.gastos');
  if (error) throw new Error(`avisarCierrePeaje: ${error.message}`);
  if ((gastos ?? []).length === 0) {
    return { corrio: true, flotas: 0, avisadas: 0, sinDestinatario: 0, gastos: 0 };
  }

  const porFlota = new Map<string, GastoPorFacturar[]>();
  for (const g of gastos ?? []) {
    const t = g.tenant_id as string;
    const lista = porFlota.get(t) ?? [];
    lista.push({ id: g.id as string, monto: Number(g.monto), fecha: g.fecha as string });
    porFlota.set(t, lista);
  }

  // La anticipación declarada por cada flota. Sin fila de configuración se usa
  // el default: una flota SIN descarga masiva también recibe este aviso — el
  // derecho a facturar se le vence igual.
  const { data: cfgs } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .select('tenant_id, peaje_dias_aviso')
    .in('tenant_id', [...porFlota.keys()]), 'peaje_cierre.config');
  const diasDe = new Map((cfgs ?? []).map((c) => [c.tenant_id as string, Number(c.peaje_dias_aviso)]));

  let avisadas = 0;
  let sinDestinatario = 0;
  let flotas = 0;

  for (const [tenantId, lista] of porFlota) {
    const umbral = umbralDeHoy(hoy, diasDe.get(tenantId) ?? DIAS_AVISO_DEFECTO);
    if (umbral === null) continue;
    flotas++;

    // ¿Ya se avisó este (flota, mes, umbral)? El sello es la llave primaria:
    // se pregunta y, si existe, no se repite.
    const { data: sello } = await acotada(supabaseAdmin()
      .from('peaje_cierre_aviso')
      .select('umbral')
      .eq('tenant_id', tenantId)
      .eq('periodo', periodo)
      .eq('umbral', umbral)
      .maybeSingle(), 'peaje_cierre.sello');
    if (sello) continue;

    const telefono = await telefonoParaDineroDe(tenantId);
    if (!telefono) {
      // Sin destinatario NO se sella: el día que la flota registre a su
      // contador, el aviso todavía puede salir. Sellar aquí lo enterraría.
      logger.warn('peaje_cierre.sin_destinatario', { tenantId, periodo, umbral });
      sinDestinatario++;
      continue;
    }

    const total = lista.reduce((s, g) => s + g.monto, 0);
    const ordenados = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const enviado = await sendText(telefono, mensajeCierrePeaje(ordenados, faltan, total));
    if (!enviado) {
      // Mismo criterio: sin envío no hay sello, y la siguiente corrida
      // reintenta. Un sello sobre un mensaje que no salió es una mentira.
      logger.warn('peaje_cierre.no_enviado', { tenantId, periodo, umbral });
      continue;
    }

    const { error: errSello } = await acotada(supabaseAdmin()
      .from('peaje_cierre_aviso')
      .insert({ tenant_id: tenantId, periodo, umbral, gastos: lista.length }), 'peaje_cierre.sellar');
    if (errSello) logger.warn('peaje_cierre.sello_fallo', { tenantId, err: errSello.message });
    avisadas++;
  }

  return { corrio: true, flotas, avisadas, sinDestinatario, gastos: gastos?.length ?? 0 };
}
