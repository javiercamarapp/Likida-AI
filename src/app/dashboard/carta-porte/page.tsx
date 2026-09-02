import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  getEstadoCartaPorte, validarDeclaracion, declararCcp,
  validarMercancia, guardarMercancia, borrarMercancia,
  validarDatosCliente, guardarDatosCliente,
  type EstadoCartaPorte,
} from '@/lib/likida/carta_porte_datos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { VistaCartaPorte } from './vista';
import { sufijoTenant } from '../sufijo';
import type { ResultadoForma } from './forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/carta-porte';

/**
 * CARTA PORTE — área `operacion` a propósito: no enseña un peso, y su usuario
 * diario es el jefe de tráfico, que es quien conoce la ruta y puede DECLARAR
 * si pisa federal (la "plena certeza" de la regla 2.7.7.2.1 es suya, no del
 * software). La declaración queda en la fila del viaje y en la bitácora.
 */
export default async function PaginaCartaPorte({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay viajes: un semáforo de cumplimiento pintado
  // sobre una base caída diría "no necesitas nada" — la conclusión más cara
  // posible en la pantalla equivocada.
  let datos: EstadoCartaPorte | null;
  try {
    datos = await getEstadoCartaPorte(tenantId);
  } catch {
    datos = null;
  }

  async function declarar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede declarar rutas.' };
    try {
      const d = validarDeclaracion({
        pisaFederal: String(fd.get('pisaFederal') ?? ''),
        radioKm: String(fd.get('radioKm') ?? ''),
      });
      await declararCcp(s.tenantId, String(fd.get('viajeId') ?? ''), d, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Declaración guardada. El semáforo de arriba ya la refleja.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la declaración') };
    }
  }

  async function agregarMercancia(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede capturar mercancía.' };
    try {
      const m = validarMercancia({
        descripcion: String(fd.get('descripcion') ?? ''),
        bienesTransp: String(fd.get('bienesTransp') ?? ''),
        cantidad: String(fd.get('cantidad') ?? ''),
        claveUnidad: String(fd.get('claveUnidad') ?? ''),
        pesoKg: String(fd.get('pesoKg') ?? ''),
        materialPeligroso: String(fd.get('materialPeligroso') ?? ''),
      });
      await guardarMercancia(s.tenantId, String(fd.get('viajeId') ?? ''), m, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Mercancía agregada. El checklist y el borrador ya la cuentan.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'agregar la mercancía') };
    }
  }

  async function quitarMercancia(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede capturar mercancía.' };
    try {
      await borrarMercancia(s.tenantId, String(fd.get('mercanciaId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Renglón quitado.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'quitar la mercancía') };
    }
  }

  async function datosCliente(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede capturar estos datos.' };
    try {
      const d = validarDatosCliente({
        origenCp: String(fd.get('origenCp') ?? ''),
        destinoCp: String(fd.get('destinoCp') ?? ''),
        origenEstado: String(fd.get('origenEstado') ?? ''),
        destinoEstado: String(fd.get('destinoEstado') ?? ''),
        rfcDestinatario: String(fd.get('rfcDestinatario') ?? ''),
        transpInternac: String(fd.get('transpInternac') ?? ''),
      });
      await guardarDatosCliente(s.tenantId, String(fd.get('viajeId') ?? ''), d, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Datos del cliente guardados. El checklist ya los refleja.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los datos del cliente') };
    }
  }

  return (
    <VistaCartaPorte
      datos={datos}
      declarar={declarar}
      agregarMercancia={agregarMercancia}
      quitarMercancia={quitarMercancia}
      guardarDatosCliente={datosCliente}
      sufijo={sufijoTenant(sp)}
    />
  );
}
