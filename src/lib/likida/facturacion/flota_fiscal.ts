import { supabaseAdmin } from '@/lib/supabase/admin';
import { getDatosFiscales } from '@/lib/saas/fiscal';
import { revisarReceptor } from './adaptadores/capufe';
import type { FlotaFiscal } from './adaptadores/registro';

// ═══════════════════════════════════════════════════════════════════════════
// CON QUÉ DATOS SE LLENA EL PORTAL. O sea: DE QUÉ EMPRESA SALE EL CFDI.
//
// El adaptador de un portal necesita seis datos de la flota —los cinco que el
// CFDI 4.0 exige del receptor más el correo— y hasta aquí nadie los reunía: el
// cron llamaba a `facturarAlVuelo` sin haber registrado un solo adaptador, y por
// eso no facturaba nada.
//
// ── LOS CINCO FISCALES SALEN DE `tenant`, VÍA `saas/fiscal.ts` ───────────
//
// No se re-leen a mano: `getDatosFiscales` ya es la única función que sabe de
// qué columnas salen (`rfc`, `razon_social`, `regimen_fiscal`,
// `codigo_postal_fiscal`, `uso_cfdi`) y una segunda lectura se desincroniza el
// día que alguien renombre una — que en este repo ya pasó con `gasto.ocr_raw`.
//
// ── EL CORREO NO TIENE COLUMNA, Y ESO SE DICE EN VOZ ALTA ────────────────
//
// No existe `tenant.correo_facturacion` ni nada equivalente: se buscó antes de
// escribir esto. Y sin correo el portal EMITE IGUAL y no le manda el CFDI a
// nadie — el ensayo pasa, el timbrado ocurre, y el comprobante se pierde.
//
// Así que se toma el de la CUENTA DE OFICINA de la flota, con esta prioridad:
//
//     contador  →  flota_admin
//
// El contador primero porque es quien archiva el CFDI y quien lo va a cruzar
// contra su papel. `operador` y `encargado` quedan FUERA a propósito: son
// personal de ruta y patio; mandarle a un chofer los comprobantes fiscales de
// su flota es una fuga de información de la empresa, no una comodidad.
//
// LO QUE NO SE HACE: una variable de entorno con "el correo de facturación".
// Sería UNA dirección para todas las flotas, o sea los CFDI de una empresa
// llegando al buzón de otra. Es el mismo error que este módulo persigue.
//
// Si no hay ninguna cuenta de oficina, ESTA FLOTA NO SE REGISTRA y se dice qué
// le falta. Registrarla igual sería emitir a ciegas.
// ═══════════════════════════════════════════════════════════════════════════

/** Roles cuyo correo puede recibir los CFDI de la flota, en orden de preferencia. */
const ROLES_QUE_RECIBEN = ['contador', 'flota_admin'] as const;

export interface FiscalDeFlota {
  /** Listo para `conPortales`. `null` = falta algo, y está en `falta`. */
  flota: FlotaFiscal | null;
  /** Qué falta, escrito para una persona. Vacío = no falta nada. */
  falta: string[];
}

/**
 * Reúne con qué se le factura a una flota, o dice exactamente qué le falta.
 *
 * NO LANZA por datos incompletos —eso es configuración del cliente y el cron
 * tiene que poder seguir con las demás flotas— pero SÍ deja subir un error de
 * la base: "esta flota no tiene RFC" y "no pude preguntar" son cosas distintas,
 * y confundirlas haría que una caída de Supabase se leyera como "ningún cliente
 * tiene datos fiscales".
 */
export async function getFiscalDeFlota(tenantId: string): Promise<FiscalDeFlota> {
  const [datos, correo] = await Promise.all([
    getDatosFiscales(tenantId),
    correoDeFacturacion(tenantId),
  ]);

  const falta: string[] = [];
  if (!datos) falta.push('la flota no existe o no tiene ficha en `tenant`');
  if (!correo) {
    falta.push(
      'no hay a dónde mandar el CFDI: la flota no tiene una cuenta de contador ni de flota_admin con correo. Sin correo el portal emite y no manda el comprobante a ningún lado',
    );
  }

  if (!datos || !correo) return { flota: null, falta };

  const flota: FlotaFiscal = {
    tenantId,
    rfc: datos.rfc ?? '',
    nombre: datos.razonSocial ?? '',
    codigoPostal: datos.codigoPostal ?? '',
    regimenFiscal: datos.regimenFiscal ?? '',
    usoCfdi: datos.usoCfdi ?? '',
    correo,
  };

  // Se revisa AQUÍ con el mismo validador que usa el registro, para que el cron
  // pueda decir qué falta sin abrir un navegador. `registrarPortales` lo vuelve
  // a revisar y deja un centinela si no cuadra: son dos redes, no una duplicada
  // — esta informa, aquella impide.
  const malos = revisarReceptor(flota);
  if (malos.length > 0) return { flota: null, falta: [...falta, ...malos] };

  return { flota, falta: [] };
}

/**
 * A qué dirección manda el portal el CFDI de esta flota.
 *
 * Se piden los DOS roles de una vez y se elige en JS: PostgREST no ordena por
 * una preferencia de valores sin inventarse un `case`, y traer dos filas es más
 * barato que dos viajes.
 */
async function correoDeFacturacion(tenantId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('app_user')
    .select('rol, email, created_at')
    .eq('tenant_id', tenantId)
    .in('rol', [...ROLES_QUE_RECIBEN])
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) throw new Error(`correoDeFacturacion: ${error.message}`);

  const filas = (data ?? []) as Array<{ rol: string; email: string | null }>;
  for (const rol of ROLES_QUE_RECIBEN) {
    const f = filas.find((x) => x.rol === rol && typeof x.email === 'string' && x.email.trim());
    if (f?.email) return f.email.trim();
  }
  return null;
}
