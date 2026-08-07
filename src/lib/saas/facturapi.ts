import { logger } from '@/lib/logger';
import { DatoInvalido } from '@/lib/likida/errores';

// ═══════════════════════════════════════════════════════════════════════════
// EL TIMBRADO DEL CFDI — lo que convierte un cobro en una operación cerrada.
//
// En México el pago NO cierra la venta: la cierra el CFDI 4.0 timbrado. Y no se
// puede timbrar por cuenta propia — pasa OBLIGATORIAMENTE por un PAC (Proveedor
// Autorizado de Certificación). Facturapi es uno, y expone el timbrado por REST
// guardando el CSD del SAT de su lado, así que el `.key` nunca vive aquí.
//
// FALLA CERRADO Y GRITA. Sin `FACTURAPI_SECRET_KEY` no se finge una factura:
// `facturapiConfigurado()` devuelve false, la pantalla dice "cobrada sin
// timbrar" y el cobro sigue siendo válido. Lo que NO puede pasar es que el
// cliente crea que ya tiene su comprobante fiscal — porque lo va a descubrir su
// contador en la declaración, meses después.
//
// EL TIMBRADO NO SE REINTENTA A CIEGAS. Cada intento exitoso consume un folio y
// crea un CFDI REAL ante el SAT; timbrar dos veces la misma mensualidad obliga a
// cancelar uno, y una cancelación fuera de plazo se le queda al cliente en su
// contabilidad. Por eso el llamador comprueba `cfdi_uuid` antes (índice único en
// la 0056) y aquí no hay reintento automático.
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://www.facturapi.io/v2';

/** ClaveProdServ del SAT para licencias/servicios de software. */
export const CLAVE_PROD_SERV_SOFTWARE = '81112101';
/** ClaveUnidad: unidad de servicio. */
export const CLAVE_UNIDAD_SERVICIO = 'E48';
/** Forma de pago 03 = transferencia electrónica de fondos. Es como cobra Likida. */
export const FORMA_PAGO_TRANSFERENCIA = '03';
/** PUE = pago en una sola exhibición. Una factura por cobro, sin complementos. */
export const METODO_PAGO_UNA_EXHIBICION = 'PUE';

export function facturapiConfigurado(): boolean {
  return Boolean(process.env.FACTURAPI_SECRET_KEY);
}

/**
 * En qué modo está la llave. Un CFDI de prueba NO existe para el SAT: si se
 * timbra en sandbox creyendo que es real, el cliente se queda sin comprobante y
 * nadie se entera hasta la declaración.
 */
export function modoFacturapi(): 'prueba' | 'produccion' | null {
  const k = process.env.FACTURAPI_SECRET_KEY;
  if (!k) return null;
  return k.startsWith('sk_live') ? 'produccion' : 'prueba';
}

function llave(): string {
  const k = process.env.FACTURAPI_SECRET_KEY;
  if (!k) throw new Error('FACTURAPI_SECRET_KEY no configurada');
  return k;
}

/**
 * Impide timbrar en PRODUCCIÓN con una llave de sandbox.
 *
 * Un CFDI de prueba NO existe para el SAT, pero sí devuelve un UUID con la misma
 * forma que uno real — y la base no distingue uno del otro. Sin este candado,
 * una llave `sk_test` pegada por error en producción llenaría `factura_saas` de
 * folios fiscales inexistentes que se ven perfectamente válidos, y el cliente lo
 * descubriría en su declaración con meses de retraso.
 *
 * Es el mismo criterio que el webhook de Stripe sin secreto: preferir no operar
 * a operar en falso. Aquí falla ruidosamente en vez de crear papel inválido.
 */
function exigirLlaveCoherente(): void {
  const entorno = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (entorno === 'production' && modoFacturapi() === 'prueba') {
    throw new DatoInvalido(
      'La llave de Facturapi en producción es de PRUEBA (sk_test). Un CFDI de sandbox no existe para el SAT: se cobró bien, pero no se timbra hasta poner la llave sk_live.',
    );
  }
}

async function pedir<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST'; cuerpo?: unknown } = {}): Promise<T> {
  const { metodo = 'POST', cuerpo } = opciones;
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${llave()}`,
      'Content-Type': 'application/json',
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const texto = await r.text();
  let json: unknown;
  try {
    json = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Facturapi ${ruta}: respuesta ilegible (${r.status})`);
  }

  if (!r.ok) {
    const err = json as { message?: string; error?: string };
    const mensaje = err?.message ?? err?.error ?? `HTTP ${r.status}`;
    logger.error('facturapi.error', { ruta, status: r.status, mensaje });
    // El SAT rechaza por datos del RECEPTOR mucho más seguido que por otra cosa,
    // y ese mensaje sí le sirve a quien capturó: se deja pasar tal cual dentro de
    // un DatoInvalido para que la pantalla lo enseñe.
    if (r.status === 400 || r.status === 422) {
      throw new DatoInvalido(`El SAT o Facturapi rechazaron la factura: ${mensaje}`);
    }
    throw new Error(`Facturapi ${ruta}: ${mensaje}`);
  }
  return json as T;
}

export interface ReceptorCfdi {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi: string;
  email?: string;
}

export interface CfdiTimbrado {
  id: string;
  uuid: string;
  /** Liga de verificación/descarga que Facturapi expone. */
  urlPdf: string | null;
  urlXml: string | null;
  total: number;
}

/**
 * Timbra la mensualidad de una flota.
 *
 * EL PARÁMETRO SE LLAMA `subtotal` Y NO `monto`, y el nombre es el arreglo.
 * Se llamaba `monto`, su JSDoc decía "Subtotal SIN IVA", y el llamador le
 * pasaba `factura_saas.monto` — que era el número que la pantalla le pedía al
 * cliente transferir. Con `tax_included: false` Facturapi le suma el 16% a lo
 * que reciba: plan de $10,000 → depósito de $10,000 → CFDI de $11,600. Un
 * comentario no impide que le pasen la cifra equivocada; un nombre que no se
 * puede confundir con "lo que se cobró", sí.
 *
 * `payment_form: '03'` porque Likida cobra por transferencia. Poner "por
 * definir" (99) cuando el pago YA ocurrió es incorrecto ante el SAT y complica
 * la deducción del cliente.
 */
export async function timbrarMensualidad(datos: {
  receptor: ReceptorCfdi;
  /** LA BASE, sin IVA. Facturapi le suma el 16% encima (`tax_included: false`). */
  subtotal: number;
  /**
   * El total que el cliente YA transfirió, para contrastarlo con el total que
   * devuelve el PAC. No cambia nada del timbrado: es la única forma de que una
   * diferencia salga en el log el mismo día en vez de aparecer meses después
   * en la conciliación del contador del cliente.
   */
  totalEsperado?: number;
  periodoInicio: string;
  periodoFin: string;
  /** Para poder rastrear el CFDI de vuelta a la factura de Likida. */
  referencia?: string;
}): Promise<CfdiTimbrado> {
  const { receptor, subtotal } = datos;

  if (!(subtotal > 0)) {
    throw new DatoInvalido('No se puede timbrar una factura de $0.');
  }
  if (!receptor.rfc || !receptor.razonSocial || !receptor.regimenFiscal || !receptor.codigoPostal) {
    throw new DatoInvalido('Faltan datos fiscales del cliente: RFC, razón social, régimen y código postal.');
  }
  exigirLlaveCoherente();

  const descripcion = `Servicio de software Likida — liquidación de viajes. Periodo ${datos.periodoInicio} a ${datos.periodoFin}`;

  const factura = await pedir<{
    id: string;
    uuid: string;
    total: number;
    verification_url?: string;
  }>('/invoices', {
    cuerpo: {
      customer: {
        legal_name: receptor.razonSocial,
        tax_id: receptor.rfc,
        tax_system: receptor.regimenFiscal,
        email: receptor.email,
        address: { zip: receptor.codigoPostal, country: 'MEX' },
      },
      items: [
        {
          quantity: 1,
          product: {
            description: descripcion,
            product_key: CLAVE_PROD_SERV_SOFTWARE,
            unit_key: CLAVE_UNIDAD_SERVICIO,
            price: subtotal,
            // El IVA lo calcula Facturapi encima del precio. Ver la nota de arriba.
            tax_included: false,
          },
        },
      ],
      payment_form: FORMA_PAGO_TRANSFERENCIA,
      payment_method: METODO_PAGO_UNA_EXHIBICION,
      use: receptor.usoCfdi,
      external_id: datos.referencia,
    },
  });

  logger.info('facturapi.timbrada', { uuid: factura.uuid, referencia: datos.referencia, total: factura.total });

  // EL CFDI YA EXISTE: aquí no se puede tirar la operación, solo dejar rastro.
  // Si el total del PAC no es el que se cobró, alguien tiene que enterarse hoy
  // —hay 24h de plazo cómodo para cancelar— y no cuando el contador del cliente
  // cruce su estado de cuenta contra su papel de trabajo en la declaración.
  if (datos.totalEsperado !== undefined && Math.abs(factura.total - datos.totalEsperado) > 0.01) {
    logger.error('facturapi.total_no_cuadra', {
      uuid: factura.uuid, referencia: datos.referencia,
      totalCfdi: factura.total, totalCobrado: datos.totalEsperado, subtotalEnviado: subtotal,
    });
  }

  return {
    id: factura.id,
    uuid: factura.uuid,
    urlPdf: `${API}/invoices/${factura.id}/pdf`,
    urlXml: `${API}/invoices/${factura.id}/xml`,
    total: factura.total,
  };
}

/**
 * Le manda la factura al cliente por correo.
 *
 * Best-effort A PROPÓSITO: el CFDI ya está timbrado y existe ante el SAT. Si el
 * correo falla, tirar la operación entera dejaría el sistema creyendo que no se
 * timbró — y el siguiente intento crearía un SEGUNDO CFDI real por el mismo
 * cobro, que después hay que cancelar.
 */
export async function enviarPorCorreo(facturaId: string, email?: string): Promise<boolean> {
  try {
    await pedir(`/invoices/${facturaId}/email`, { cuerpo: email ? { email } : {} });
    return true;
  } catch (e) {
    logger.warn('facturapi.correo_fallo', { facturaId, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
