import { supabaseAdmin } from '@/lib/supabase/admin';
import { esRfcValido, rfcChecksumOk } from '@/lib/likida/intake/cfdi';
import { DatoInvalido } from '@/lib/likida/errores';

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

/** Catálogo `c_RegimenFiscal` del SAT, acotado a lo que aplica aquí.
 *  624 (Coordinados, LISR 72-73) es el régimen para el que se escribió RFA 2.9:
 *  sin él, un coordinado no puede declararse y la facilidad del 15% solo la
 *  alcanzaba una PF 612. Es régimen del RECEPTOR cuando Likida le timbra la
 *  mensualidad — no significa que Likida emita CFDIs de sus viajes. */
export const REGIMENES = [
  { clave: '601', nombre: 'General de Ley Personas Morales' },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos' },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales' },
  { clave: '621', nombre: 'Incorporación Fiscal' },
  { clave: '624', nombre: 'Coordinados' },
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
  /**
   * Domicilio fiscal completo (calle, número, colonia, CP, ciudad).
   *
   * AUDITORÍA 19, CRÍTICO (legal C3 / C.16): esta columna existe desde la
   * 0018 y NINGUNA pantalla de producción la escribía — solo el seed de demo
   * y dos arneses de QA. Sin ella `getDatosResponsable` devolvía null y
   * `/aviso/<flota>` respondía 404 para toda flota real: el aviso de
   * privacidad que no se puede leer es, legalmente, un aviso que no existe
   * (LFPDPPP art. 15 fr. I exige identidad Y domicilio del responsable).
   *
   * NO entra en `estanCompletos` a propósito: los cinco de arriba los exige
   * el SAT para timbrar; este lo exige la LFPDPPP para el aviso. Faltando,
   * se factura igual — lo que no se puede es tratar datos de operadores, y
   * eso lo frena `ponerAvisoADisposicion` con su propio mensaje.
   */
  domicilioFiscal: string | null;
  /**
   * A dónde se le manda el CFDI (0163, DAT-33).
   *
   * NO ENTRA EN `estanCompletos` A PROPÓSITO: los cinco datos de arriba los
   * exige el SAT para timbrar, y sin ellos no hay papel. El correo no impide
   * emitirlo — impide que llegue —, así que bloquear la contratación por él
   * sería cobrar de menos por un dato que se puede pedir después. Lo que sí
   * hace es gritar al timbrar: `timbrarFactura` avisa cuando el CFDI se emitió
   * y no tiene a quién mandárselo.
   */
  email: string | null;
}

/** ¿Se puede facturar a esta flota? Los cinco datos o ninguno sirve. */
export function estanCompletos(d: DatosFiscalesFlota | null): boolean {
  return Boolean(d?.rfc && d.razonSocial && d.regimenFiscal && d.codigoPostal && d.usoCfdi);
}

export async function getDatosFiscales(tenantId: string): Promise<DatosFiscalesFlota | null> {
  const { data, error } = await supabaseAdmin()
    .from('tenant')
    .select('rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, uso_cfdi, email_facturacion, domicilio_fiscal')
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
    email: (data.email_facturacion as string) || null,
    domicilioFiscal: (data.domicilio_fiscal as string) || null,
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
export interface DatosFiscalesCapturados {
  rfc: string; razonSocial: string; regimenFiscal: string; codigoPostal: string; usoCfdi: string;
  /** Opcional: a dónde llega el CFDI. Ver `DatosFiscalesFlota.email`. */
  email?: string;
  /** Opcional para facturar, obligatorio para el aviso de privacidad.
   *  Ver `DatosFiscalesFlota.domicilioFiscal`. */
  domicilioFiscal?: string;
}

/** Las columnas de `tenant`, ya normalizadas y listas para escribir. */
export interface FilaFiscalTenant {
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal_fiscal: string;
  uso_cfdi: string;
  email_facturacion: string | null;
  domicilio_fiscal: string | null;
}

/**
 * Valida y normaliza los cinco datos del receptor. Lanza `DatoInvalido` con la
 * frase que va a leer una persona.
 *
 * VIVE APARTE DE `guardarDatosFiscales` PORQUE EL ALTA TAMBIÉN LO NECESITA, y
 * necesita validar ANTES de insertar el tenant: si la comprobación viviera solo
 * dentro del update, un CP de cuatro dígitos dejaría la flota ya creada y a
 * medio configurar, y quien la dio de alta vería un error después de que su
 * clic ya cambió la base. Duplicar las reglas era la otra salida, y dos copias
 * de un validador fiscal se separan: la copia laxa acaba siendo la que escribe.
 */
export function validarDatosFiscales(d: DatosFiscalesCapturados): FilaFiscalTenant {
  const rfc = d.rfc.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
  if (!esRfcValido(rfc) || !rfcChecksumOk(rfc)) {
    throw new DatoInvalido(
      `El RFC "${d.rfc}" no pasa el dígito verificador. Con un RFC inválido el SAT rechaza el timbrado, y eso se descubre cuando ya cobramos y tu contador no tiene con qué deducir.`,
    );
  }

  // ── EL RFC GENÉRICO NO ES UN RFC DE CLIENTE (auditoría prod, DAT-40) ─────
  //
  // XAXX010101000 ("público en general") y XEXX010101000 (extranjero) PASAN el
  // dígito verificador, así que entraban como cualquier otro. Un CFDI a nombre
  // del público en general NO LO PUEDE DEDUCIR NADIE: el cliente paga su
  // mensualidad, recibe un papel válido ante el SAT y sin valor para su
  // contabilidad — y lo descubre en la declaración, meses después. Además el
  // SAT exige que ese RFC vaya con régimen 616 y uso S01, que no es nada de lo
  // que este catálogo ofrece.
  if (rfc === 'XAXX010101000' || rfc === 'XEXX010101000') {
    throw new DatoInvalido(
      'Ese es el RFC genérico (público en general). Un CFDI emitido a ese RFC no lo puede deducir nadie: pon el '
      + 'RFC de tu empresa, tal como aparece en tu Constancia de Situación Fiscal.',
    );
  }

  // LA RAZÓN SOCIAL NO SE "LIMPIA" MÁS ALLÁ DE LOS ESPACIOS. El SAT la compara
  // con lo que tiene registrado para ese RFC y rechaza por diferencias que se
  // ven inofensivas. Se guarda tal cual la capturó quien tiene la constancia
  // enfrente — nosotros no sabemos mejor que su Constancia de Situación Fiscal.
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

  const email = (d.email ?? '').trim();
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    throw new DatoInvalido(`El correo "${d.email}" no tiene forma de correo. Ahí es donde te va a llegar tu CFDI.`);
  }

  // AUDITORÍA 19 (legal C3 / C.16): el domicilio del aviso de privacidad. Se
  // valida solo la forma mínima —que quepa una dirección de verdad, no una
  // palabra suelta— porque el SAT no lo compara y nosotros no sabemos mejor
  // que la constancia. Vacío = null explícito ("no capturado"), nunca ''.
  const domicilio = (d.domicilioFiscal ?? '').trim();
  if (domicilio && domicilio.length < 10) {
    throw new DatoInvalido(
      'El domicilio fiscal se ve incompleto. Escríbelo entero —calle, número, colonia, código postal y ciudad—: es el que va a aparecer en el aviso de privacidad de tus operadores, y un aviso con medio domicilio no dice dónde reclamarte.',
    );
  }

  return {
    rfc,
    razon_social: razonSocial,
    regimen_fiscal: d.regimenFiscal,
    codigo_postal_fiscal: cp,
    uso_cfdi: d.usoCfdi,
    email_facturacion: email || null,
    domicilio_fiscal: domicilio || null,
  };
}

/**
 * Guarda los datos fiscales con los que se le va a facturar a la flota.
 *
 * EL RFC SE VALIDA CON DÍGITO VERIFICADOR, igual que en el alta de flota. Aquí
 * el costo de uno malo es distinto y peor: el PAC rechaza el timbrado cuando ya
 * hay pagos cobrados, y quien se queda sin poder deducir es el cliente.
 */
export async function guardarDatosFiscales(
  tenantId: string,
  d: DatosFiscalesCapturados,
): Promise<void> {
  const fila = validarDatosFiscales(d);

  const { error } = await supabaseAdmin()
    .from('tenant')
    .update(fila)
    .eq('id', tenantId);

  if (error) throw new Error(`guardarDatosFiscales: ${error.message}`);
}
