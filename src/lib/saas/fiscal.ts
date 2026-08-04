import { supabaseAdmin } from '@/lib/supabase/admin';
import { esRfcValido, rfcChecksumOk } from '@/lib/cuadra/intake/cfdi';
import { DatoInvalido } from '@/lib/cuadra/errores';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DATOS FISCALES DE LA FLOTA — lo que el CFDI exige del receptor.
//
// VIVE APARTE DE `suscripcion.ts` A PROPÓSITO: valida RFC, y el validador
// arrastra el parser de CFDI. `suscripcion.ts` lo importa el webhook de Stripe,
// que solo necesita hablar con Postgres. Mismo motivo que `errores.ts`.
//
// EN MÉXICO EL COBRO NO CIERRA LA OPERACIÓN, LA CIERRA EL CFDI. Stripe cobra
// pero no timbra: eso pasa obligatoriamente por un PAC. Y el CFDI 4.0 exige del
// receptor cinco datos —RFC, razón social, régimen, código postal y uso— que
// hay que tener ANTES de cobrar. Al revés es el peor orden: ya tienes su dinero
// y no lo puede deducir.
// ═══════════════════════════════════════════════════════════════════════════

/** Catálogo `c_RegimenFiscal` del SAT, acotado a lo que aplica aquí. */
export const REGIMENES = [
  { clave: '601', nombre: 'General de Ley Personas Morales' },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos' },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales' },
  { clave: '621', nombre: 'Incorporación Fiscal' },
  { clave: '626', nombre: 'RESICO' },
] as const;

/** Catálogo `c_UsoCFDI`. G03 es como una flota deduce una suscripción. */
export const USOS_CFDI = [
  { clave: 'G03', nombre: 'Gastos en general' },
  { clave: 'G01', nombre: 'Adquisición de mercancías' },
  { clave: 'I04', nombre: 'Equipo de cómputo y accesorios' },
] as const;

export interface DatosFiscalesFlota {
  rfc: string | null;
  razonSocial: string | null;
  regimenFiscal: string | null;
  codigoPostal: string | null;
  usoCfdi: string | null;
}

/** ¿Se puede facturar a esta flota? Los cinco datos o ninguno sirve. */
export function estanCompletos(d: DatosFiscalesFlota | null): boolean {
  return Boolean(d?.rfc && d.razonSocial && d.regimenFiscal && d.codigoPostal && d.usoCfdi);
}

export async function getDatosFiscales(tenantId: string): Promise<DatosFiscalesFlota | null> {
  const { data, error } = await supabaseAdmin()
    .from('tenant')
    .select('rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, uso_cfdi')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`getDatosFiscales: ${error.message}`);
  if (!data) return null;
  return {
    rfc: (data.rfc as string) || null,
    razonSocial: (data.razon_social as string) || null,
    regimenFiscal: (data.regimen_fiscal as string) || null,
    codigoPostal: (data.codigo_postal_fiscal as string) || null,
    usoCfdi: (data.uso_cfdi as string) || null,
  };
}

/**
 * Guarda los datos fiscales con los que se le va a facturar a la flota.
 *
 * EL RFC SE VALIDA CON DÍGITO VERIFICADOR, igual que en el alta de flota. Aquí
 * el costo de uno malo es distinto y peor: el PAC rechaza el timbrado cuando ya
 * hay pagos cobrados, y quien se queda sin poder deducir es el cliente.
 *
 * LA RAZÓN SOCIAL NO SE "LIMPIA" MÁS ALLÁ DE LOS ESPACIOS. El SAT la compara
 * con lo que tiene registrado para ese RFC y rechaza por diferencias que se ven
 * inofensivas. Se guarda tal cual la capturó quien tiene la constancia enfrente
 * — nosotros no sabemos mejor que su Constancia de Situación Fiscal.
 */
export async function guardarDatosFiscales(
  tenantId: string,
  d: { rfc: string; razonSocial: string; regimenFiscal: string; codigoPostal: string; usoCfdi: string },
): Promise<void> {
  const rfc = d.rfc.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
  if (!esRfcValido(rfc) || !rfcChecksumOk(rfc)) {
    throw new DatoInvalido(
      `El RFC "${d.rfc}" no pasa el dígito verificador. Con un RFC inválido el SAT rechaza el timbrado, y eso se descubre cuando ya cobramos y tu contador no tiene con qué deducir.`,
    );
  }

  const razonSocial = d.razonSocial.trim();
  if (razonSocial.length < 3) {
    throw new DatoInvalido('Falta la razón social, tal como aparece en tu Constancia de Situación Fiscal.');
  }

  const cp = d.codigoPostal.trim();
  if (!/^[0-9]{5}$/.test(cp)) {
    throw new DatoInvalido(`El código postal "${d.codigoPostal}" no son 5 dígitos.`);
  }

  if (!REGIMENES.some((r) => r.clave === d.regimenFiscal)) {
    throw new DatoInvalido('Elige un régimen fiscal de la lista.');
  }
  if (!USOS_CFDI.some((u) => u.clave === d.usoCfdi)) {
    throw new DatoInvalido('Elige un uso de CFDI de la lista.');
  }

  const { error } = await supabaseAdmin()
    .from('tenant')
    .update({
      rfc,
      razon_social: razonSocial,
      regimen_fiscal: d.regimenFiscal,
      codigo_postal_fiscal: cp,
      uso_cfdi: d.usoCfdi,
    })
    .eq('id', tenantId);

  if (error) throw new Error(`guardarDatosFiscales: ${error.message}`);
}
