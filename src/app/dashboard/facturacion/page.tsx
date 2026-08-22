import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getFacturacionClientes, type FacturacionClientes } from '@/lib/likida/facturacion_clientes';
import { hoyMx } from '@/lib/formato';
import {
  validarFactura, crearFactura, validarPago, registrarPago, marcarEmitida, cancelarFactura,
} from '@/lib/likida/facturacion_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { mxn } from '@/lib/formato';
import { VistaFacturacion, type CapturaFacturacion } from './vista';
import type { ResultadoForma } from './forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/facturacion';

/**
 * FACTURACIÓN A CLIENTES — lectura Y captura.
 *
 * ── LA PUERTA ─────────────────────────────────────────────────────────────
 * `puedeVerRuta(rol, RUTA)` con área `dinero` — superadmin, flota_admin y
 * contador. Espeja `ve_finanzas()` de la 0049, que es la RLS de
 * `factura_emitida`/`pago_recibido`. La comprobación no es cosmética: todo
 * aquí corre con `supabaseAdmin()`, que pasa por encima de RLS, así que ÉSTA
 * es la única puerta — y por eso cada server action la re-resuelve adentro en
 * vez de confiar en que la página ya la pasó.
 *
 * ── POR QUÉ DEJÓ DE SER SOLO LECTURA ──────────────────────────────────────
 * El comentario que vivía aquí decía que registrar facturas "no tiene dueño en
 * el producto". La auditoría 4 (hallazgo A1) midió la consecuencia: cuatro
 * lectores de `factura_emitida`, cero escritores, y esta pantalla condenada a
 * EstadoVacío no por falta de clientes sino porque no había dónde teclear. La
 * captura respeta el contrato de la 0049 tal cual: Likida NO timbra — el UUID
 * lo da el PAC de la flota y aquí solo se REGISTRA. Un borrador sin UUID no le
 * cobra a nadie y la pantalla lo dice.
 */
export default async function PaginaFacturacion({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay facturas: devuelve `null` y la vista pinta el
  // error. Supabase reporta los fallos POR VALOR, así que una base caída se
  // leería como "no te debe nadie y no tienes nada sin facturar" — las dos
  // conclusiones contrarias a las que esta pantalla existe para dar.
  let datos: FacturacionClientes | null;
  try {
    datos = await getFacturacionClientes(tenantId);
  } catch {
    datos = null;
  }

  // El catálogo de clientes para el formulario. `catch → []` es honesto aquí:
  // sin catálogo el form dice "no tienes clientes dados de alta", que manda a
  // la pantalla correcta en vez de fingir una lista vacía de otra cosa.
  let clientes: Array<{ id: string; nombre: string; diasCredito: number | null }> = [];
  try {
    const { data, error } = await supabaseAdmin().from('cliente')
      .select('id, nombre, dias_credito')
      .eq('tenant_id', tenantId).eq('activo', true)
      .order('nombre');
    if (!error && data) {
      clientes = data.map((c) => ({
        id: String((c as { id: unknown }).id),
        nombre: String((c as { nombre: unknown }).nombre),
        diasCredito: (c as { dias_credito: number | null }).dias_credito,
      }));
    }
  } catch {
    clientes = [];
  }

  // ── Las cuatro escrituras. Las puertas van escritas en CADA action a
  // propósito (mismo criterio que Clientes): un helper compartido tendría que
  // ser él mismo un server action, o sea un endpoint POST de más.

  async function guardarFactura(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede registrar facturas.' };
    try {
      const valores = validarFactura({
        clienteId: String(fd.get('clienteId') ?? ''),
        fecha: String(fd.get('fecha') ?? ''),
        subtotal: String(fd.get('subtotal') ?? ''),
        iva: String(fd.get('iva') ?? ''),
        folio: String(fd.get('folio') ?? ''),
        cfdiUuid: String(fd.get('cfdiUuid') ?? ''),
        viajeIds: fd.getAll('viajeIds').map(String),
      });
      await crearFactura(s.tenantId, valores, { id: s.userId });
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: valores.estatus === 'emitida'
          ? `Factura registrada por ${mxn(valores.total)}. Ya entra a la cartera.`
          : `Borrador registrado por ${mxn(valores.total)}. No le cobra a nadie hasta que llegue su UUID del CFDI.`,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'registrar la factura') };
    }
  }

  async function guardarPago(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede registrar pagos.' };
    try {
      const valores = validarPago({
        facturaId: String(fd.get('facturaId') ?? ''),
        fecha: String(fd.get('fecha') ?? ''),
        monto: String(fd.get('monto') ?? ''),
        metodo: String(fd.get('metodo') ?? ''),
        referencia: String(fd.get('referencia') ?? ''),
      });
      await registrarPago(s.tenantId, valores, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: `Pago de ${mxn(valores.monto)} registrado.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'registrar el pago') };
    }
  }

  async function sellarEmitida(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede marcar facturas como emitidas.' };
    try {
      await marcarEmitida(s.tenantId, String(fd.get('facturaId') ?? ''), {
        folio: String(fd.get('folio') ?? ''),
        cfdiUuid: String(fd.get('cfdiUuid') ?? ''),
      }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'La factura quedó marcada como emitida y ya entra a la cartera.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'marcar la factura como emitida') };
    }
  }

  async function cancelar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede cancelar facturas.' };
    try {
      await cancelarFactura(s.tenantId, String(fd.get('facturaId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Factura cancelada. Sus viajes vuelven a la lista de sin facturar.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cancelar la factura') };
    }
  }

  const captura: CapturaFacturacion = {
    clientes,
    hoy: hoyMx(),
    factura: guardarFactura,
    pago: guardarPago,
    emitir: sellarEmitida,
    cancelar,
  };

  return <VistaFacturacion datos={datos} captura={captura} />;
}
