import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getFacturacionClientes, type FacturacionClientes } from '@/lib/likida/facturacion_clientes';
import { getAuditoriaCobranza, ventanaAuditor, type AuditoriaCobranza } from '@/lib/likida/auditor_cobranza';
import { hoyMx } from '@/lib/formato';
import {
  validarFactura, crearFactura, validarPago, registrarPago, marcarEmitida, cancelarFactura,
} from '@/lib/likida/facturacion_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { mxn } from '@/lib/formato';
import { VistaFacturacion, type CapturaFacturacion } from './vista';
import { BloqueEstadias } from './estadias';
import { BloquePortalPago } from './portal';
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

  // El auditor de cobranza: el cruce pactado/entregado/facturado/cobrado de
  // los viajes iniciados en la ventana (§8.2). Su fallo NO tumba la cartera
  // —son lecturas independientes— y `null` hace que la sección pinte el
  // error dicho, no una auditoría vacía que se leería como "sin hallazgos".
  let auditoria: AuditoriaCobranza | null;
  try {
    const hoy = hoyMx();
    const { desde, hasta } = ventanaAuditor(hoy);
    auditoria = await getAuditoriaCobranza(tenantId, { desde, hasta, hoy });
  } catch {
    auditoria = null;
  }

  // El catálogo de clientes para el formulario. `null` = NO SE PUDO LEER; `[]`
  // = se leyó y de verdad no hay ninguno (AUDITORÍA 22, FE-1).
  //
  // Antes esto caía a `[]` en cualquier falla, y el comentario de aquí lo
  // llamaba "honesto". No lo era: supabase-js NO lanza, devuelve
  // `{ data: null, error }`, así que un 500 de PostgREST o una policy nueva
  // hacían que el formulario le dijera «no tienes clientes dados de alta» a una
  // flota con 40 clientes activos — que además los ve listados en
  // /dashboard/clientes. El mismo archivo ya distinguía las dos cosas para
  // `datos` y `auditoria` ("el catch NO finge que no hay facturas"); esta era
  // la única lectura de la pantalla que las mezclaba.
  let clientes: Array<{ id: string; nombre: string; diasCredito: number | null }> | null = null;
  try {
    const { data, error } = await supabaseAdmin().from('cliente')
      .select('id, nombre, dias_credito')
      .eq('tenant_id', tenantId).eq('activo', true)
      .order('nombre');
    if (error) {
      clientes = null;
    } else {
      clientes = (data ?? []).map((c) => ({
        id: String((c as { id: unknown }).id),
        nombre: String((c as { nombre: unknown }).nombre),
        diasCredito: (c as { dias_credito: number | null }).dias_credito,
      }));
    }
  } catch {
    clientes = null;
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
        serie: String(fd.get('serie') ?? ''),
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
      // La SERIE no se manda aquí a propósito (RES-22, 0166). `marcarEmitida`
      // la acepta, pero sellar sin poder MOSTRAR la serie que la factura ya
      // trae borraría en silencio un dato que quien captura no tiene delante:
      // el listado lo arma `facturacion_clientes.ts`, que todavía no la lee.
      // Omitir el campo deja la serie del borrador intacta, que es lo correcto
      // mientras la pantalla no pueda enseñarla.
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

  return (
    <>
      <VistaFacturacion datos={datos} captura={captura} auditoria={auditoria} />
      {/* Estadías y detención (0207): sección independiente — sus lecturas y
          su fallo no tocan la cartera ni el auditor. */}
      <BloqueEstadias sp={sp} />
      {/* Portal de pago del cliente (0228): mismo criterio de independencia.
          Lo que llega por el enlace público NO está en la cartera de arriba —
          entra aquí como propuesta y solo la conciliación la mueve. */}
      <BloquePortalPago sp={sp} />
    </>
  );
}
