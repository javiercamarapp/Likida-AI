import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getPanelClientes, validarCliente, validarTarifa, crearCliente, editarCliente,
  crearTarifa, editarTarifa, MODOS_TARIFA, type PanelClientes,
} from '@/lib/likida/clientes';
import { VistaClientes } from './vista';
import type { ResultadoForma } from './forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/clientes';

/**
 * CLIENTES Y TARIFAS — el lado del INGRESO, encendido.
 *
 * La 0048 ("EL LADO DEL INGRESO") creó `cliente`, `tarifa`, `viaje.cliente_id`
 * y `viaje.ingreso_flete`, y desde entonces las tablas estaban aplicadas y
 * VACÍAS: `comercial.ts` sabía leerlas y nadie sabía escribirlas. Esta página
 * es la captura que faltaba.
 *
 * ── DOS PUERTAS DISTINTAS, A PROPÓSITO ────────────────────────────────────
 *  · VER es área `dinero` (`puedeVerRuta`): superadmin, flota_admin y contador.
 *    Espeja `ve_finanzas()` de la 0048 — el encargado despacha, no factura.
 *  · ESCRIBIR es `puedeAdministrar`: superadmin y flota_admin. El catálogo de
 *    precios es la decisión comercial del dueño; el contador la lee para
 *    facturar, no la fija.
 *
 * LAS DOS SE VUELVEN A COMPROBAR DENTRO DE CADA SERVER ACTION. El `rol` de
 * este render es el del momento en que se pintó la pantalla, no el de la
 * llamada, y una server action es un endpoint alcanzable por POST directo sin
 * pasar por aquí. El `tenantId` va por CLOSURE desde la sesión re-resuelta:
 * nada del formulario decide de quién es la fila que se toca.
 */
export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay clientes: devuelve `null`, y la vista pinta
  // el error. Supabase reporta los fallos POR VALOR, así que una base caída se
  // leería como "esta flota no le factura a nadie" — que es justo lo contrario
  // de lo que esta pantalla existe para contestar.
  let panel: PanelClientes | null;
  try {
    panel = await getPanelClientes(tenantId);
  } catch {
    panel = null;
  }

  // Las dos puertas están ESCRITAS DOS VECES, una por acción, en vez de en un
  // ayudante compartido: un ayudante declarado aquí adentro tendría que ser él
  // mismo una server action para que las otras dos pudieran cerrarlo por
  // closure, y eso publica un endpoint POST más que nadie pidió. Cuatro líneas
  // repetidas cuestan menos que una superficie de más.

  async function guardarCliente(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver la cartera de clientes.' };
    if (!puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota da de alta clientes y fija tarifas.' };
    }

    // El id dice QUÉ fila, nunca DE QUIÉN: el tenant sale de la sesión que se
    // acaba de re-resolver, y el UPDATE va anclado con `.eq('tenant_id', ...)`
    // y comprueba que tocó algo.
    const id = String(fd.get('id') ?? '').trim();
    try {
      // La validación del navegador (required, min, max) avisa temprano; ÉSTA
      // es la que manda, y es la misma función que prueba `clientes.test.ts`.
      const valores = validarCliente({
        nombre: String(fd.get('nombre') ?? ''),
        rfc: String(fd.get('rfc') ?? ''),
        contacto: String(fd.get('contacto') ?? ''),
        correo: String(fd.get('correo') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
        diasCredito: String(fd.get('diasCredito') ?? ''),
        activo: fd.get('activo') === 'on',
      });

      if (id) await editarCliente(s.tenantId, id, valores, { id: s.userId });
      else await crearCliente(s.tenantId, valores, { id: s.userId });

      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: id
          ? `"${valores.nombre}" quedó actualizado.`
          : `"${valores.nombre}" ya está dado de alta. Asígnale sus viajes para que su ingreso empiece a medirse.`,
      };
    } catch (e) {
      // `DatoInvalido` sale VERBATIM (dice qué corregir); cualquier otra cosa
      // se loguea y sale como falla del sistema, para no acusar al usuario de
      // un error de base de datos.
      return { ok: false, error: mensajeParaPantalla(e, id ? 'guardar el cliente' : 'dar de alta el cliente') };
    }
  }

  async function guardarTarifa(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver la cartera de clientes.' };
    if (!puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota da de alta clientes y fija tarifas.' };
    }

    const id = String(fd.get('id') ?? '').trim();
    try {
      const valores = validarTarifa({
        clienteId: String(fd.get('clienteId') ?? ''),
        origen: String(fd.get('origen') ?? ''),
        destino: String(fd.get('destino') ?? ''),
        modo: String(fd.get('modo') ?? ''),
        precio: String(fd.get('precio') ?? ''),
        moneda: String(fd.get('moneda') ?? 'MXN'),
        vigenteDesde: String(fd.get('vigenteDesde') ?? ''),
        vigenteHasta: String(fd.get('vigenteHasta') ?? ''),
        activa: fd.get('activa') === 'on',
      });

      if (id) await editarTarifa(s.tenantId, id, valores, { id: s.userId });
      else await crearTarifa(s.tenantId, valores, { id: s.userId });

      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: id
          ? 'Tarifa actualizada. El precio nuevo aplica desde la fecha en que la pusiste a regir.'
          : 'Tarifa guardada. Ya se usa para decir qué precio aplicaría a cada viaje.',
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, id ? 'guardar la tarifa' : 'agregar la tarifa') };
    }
  }

  return (
    <VistaClientes
      panel={panel}
      puedeEditar={puedeAdministrar(rol)}
      // El catálogo viaja como PROP y no como import del componente cliente:
      // `clientes.ts` importa `supabaseAdmin`, que no puede acabar en el bundle
      // del navegador. Ver el encabezado de `forma.tsx`.
      modos={MODOS_TARIFA}
      guardarCliente={guardarCliente}
      guardarTarifa={guardarTarifa}
    />
  );
}
