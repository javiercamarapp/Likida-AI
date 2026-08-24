// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO QUE LA FLOTA DECLARÓ — y la diferencia entre eso y el default.
//
// El export de póliza leía `tenant.perfil.contabilidad.cuentas`, un lugar que
// NADIE escribe: devolvía 409 «configúralo en Ajustes → Contabilidad» para
// siempre, y esa pantalla tampoco existe. Mientras tanto el catálogo VIVO ya
// estaba en `tenant.config.catalogoCuentas`, editable desde /dashboard/
// configuracion desde el 14-ago-2026. Dos fuentes de verdad para la misma cosa
// y el export leyendo la vacía — el mismo patrón que `politica_gasto` (muerta)
// contra `tenant.config.politica` (viva) que CLAUDE.md ya documenta.
//
// ── POR QUÉ NO SE USA `getConfig()` ───────────────────────────────────────
// Porque FUSIONA `DEMO_CONFIG`, cuyas cuentas (`600-001`, `600-002`…) están
// marcadas 🔴 demo en el propio archivo. Una flota que nunca declaró nada
// recibiría esas cuentas y el export las asentaría en su ERP como si fueran
// suyas. `poliza.ts` existe justamente para impedirlo: «una cuenta inventada no
// se detecta al importar — se detecta en la auditoría del año siguiente».
//
// Aquí se lee el OVERRIDE crudo. Lo que la flota no declaró, no existe.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import type { CatalogoContable } from './poliza';
import type { ConceptoGasto } from '@/types/likida';

/** Los conceptos de gasto que pueden llevar cuenta. Espeja `ConceptoGasto`. */
const CONCEPTOS: readonly ConceptoGasto[] = [
  'diesel', 'caseta', 'factura', 'alimentacion', 'hospedaje',
  'transporte', 'flete', 'viaticos', 'otro',
];

/**
 * Las cuentas de BALANCE, que no son un concepto de gasto.
 *
 * Viven en el mismo textarea `concepto=cuenta` porque `parsearCuentas` acepta
 * cualquier llave — no hacía falta una segunda pantalla ni una segunda tabla.
 * Se listan aquí para que la pantalla las pueda documentar y para que `falta`
 * las nombre con el mismo nombre que la persona va a teclear.
 */
export const CUENTAS_BALANCE = {
  iva_acreditable: 'ivaAcreditable',
  anticipo_operador: 'anticipoOperador',
  por_cobrar_operador: 'porCobrarOperador',
  por_pagar_operador: 'porPagarOperador',
} as const satisfies Record<string, keyof CatalogoContable>;

/** Cómo se le explica cada llave reservada a quien la captura. */
export const AYUDA_BALANCE: Record<keyof typeof CUENTAS_BALANCE, string> = {
  iva_acreditable: 'IVA acreditable de los comprobantes del viaje.',
  anticipo_operador: 'El anticipo entregado al operador; el asiento lo cancela.',
  por_cobrar_operador: 'Lo que el operador debe devolver (comprobó de menos).',
  por_pagar_operador: 'Lo que se le debe al operador (puso de su bolsa).',
};

export type LecturaCatalogo =
  | { ok: true; catalogo: CatalogoContable }
  /** La flota no ha declarado UNA sola cuenta: no es un catálogo parcial. */
  | { ok: false; motivo: 'sin_declarar' };

/**
 * El catálogo tal como lo declaró ESTA flota, sin defaults.
 *
 * Un catálogo parcial SÍ devuelve `ok: true`: quien decide si alcanza es
 * `polizaDeLiquidacion`, que sabe qué conceptos trae el periodo y nombra los
 * que faltan. Rechazar aquí lo parcial obligaría a declarar cuentas de
 * conceptos que esa flota no usa nunca.
 */
export async function catalogoDeclarado(tenantId: string): Promise<LecturaCatalogo> {
  const { data, error } = await acotada(
    supabaseAdmin().from('tenant').select('config').eq('id', tenantId).maybeSingle(),
    'contabilidad.catalogo',
  );
  // Fallar cerrado: una base caída NO es «esta flota no declaró cuentas».
  if (error) throw new Error(`catalogoDeclarado: ${error.message}`);

  const crudo = (data?.config as { catalogoCuentas?: unknown } | null)?.catalogoCuentas;
  if (!crudo || typeof crudo !== 'object') return { ok: false, motivo: 'sin_declarar' };

  const declarado = crudo as Record<string, unknown>;
  const catalogo = armarCatalogo(declarado);
  const vacio = Object.keys(catalogo.gastos).length === 0 &&
    !catalogo.ivaAcreditable && !catalogo.anticipoOperador &&
    !catalogo.porCobrarOperador && !catalogo.porPagarOperador;
  return vacio ? { ok: false, motivo: 'sin_declarar' } : { ok: true, catalogo };
}

/**
 * Traduce el mapa plano `concepto=cuenta` al contrato de `poliza.ts`.
 *
 * Puro y exportado para poder probarlo sin base. Una llave que no es concepto
 * ni cuenta de balance se IGNORA en silencio a propósito: el textarea es libre
 * y un contador puede dejarse notas ahí; tirar el catálogo entero por una línea
 * extra sería peor que ignorarla.
 */
export function armarCatalogo(declarado: Record<string, unknown>): CatalogoContable {
  const texto = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? undefined : s;
  };

  const gastos: Partial<Record<ConceptoGasto, string>> = {};
  for (const c of CONCEPTOS) {
    const cuenta = texto(declarado[c]);
    if (cuenta) gastos[c] = cuenta;
  }

  const catalogo: CatalogoContable = { gastos };
  for (const [llave, campo] of Object.entries(CUENTAS_BALANCE)) {
    const cuenta = texto(declarado[llave]);
    if (cuenta) catalogo[campo] = cuenta;
  }
  return catalogo;
}
