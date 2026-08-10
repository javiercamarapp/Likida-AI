import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { Send, UserCog, PackageCheck, Plus } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { listOperadores, reasignarOperador } from '@/lib/likida/repo';
import {
  getTableroOperacion, getViajesSinAsignar, getCargaOperadores, getUnidades,
  crearViaje, asignarUnidad,
  type TableroOperacion, type ViajeSinAsignar, type CargaOperador, type UnidadRow,
} from '@/lib/likida/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { TituloSeccion } from '../resumen-visual';
import { sufijoTenant } from '../sufijo';
import { TableroCifras, TablaSinAsignar, TablaCarga, FormaAlta } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * A qué tenant escribe la Server Action. Vive a nivel de MÓDULO, no dentro del
 * componente: una función anidada capturada por el closure de un `'use
 * server'` cuenta como valor a serializar hacia el cliente, y una función
 * plana no lo es — "Functions cannot be passed directly to Client
 * Components". Por eso recibe `sufijo`/`tenantPedido` como parámetros en vez
 * de cerrarlos del render.
 */
async function tenantDelAction(destino: string, sufijo: string, tenantPedido?: string) {
  const s = await requireSessionTenant(destino);
  if (!puedeAsignar(s.rol)) redirect(`${destino}${sufijo}`);
  if (s.rol === 'superadmin' && tenantPedido) {
    return await resolverTenantPedido(supabaseAdmin(), s.tenantId, tenantPedido);
  }
  return s.tenantId;
}

/**
 * DESPACHO — la pantalla del encargado (jefe de tráfico).
 *
 * Es la primera pantalla de la app donde alguien ESCRIBE en la base desde el
 * navegador: hasta aquí, crear un viaje o moverlo de chofer se hacía por
 * WhatsApp o con SQL a mano. Por eso los dos formularios repiten el chequeo
 * de permiso DENTRO del server action — el `puedeAsignar` de aquí arriba solo
 * decide si el formulario se pinta, y un contador que arme la petición a mano
 * (misma sesión válida, sin el botón) pasaría por encima de él. Es el mismo
 * criterio que ya usa `dashboard/[id]/page.tsx:59-66`.
 *
 * NO hay una sola cifra de dinero en esta pantalla, y no es un descuido: la
 * matriz de permisos (mig. 0044) le da al encargado asignar y exportar, no
 * ver finanzas. El anticipo se captura al crear el viaje porque el motor de
 * cuadre lo necesita, pero no se lista ni se suma en ninguna columna.
 */
export default async function DespachoPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/despacho', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  const [tablero, sinAsignar, carga, operadores, unidades] = await Promise.all([
    safe<TableroOperacion>(() => getTableroOperacion(tenantId)),
    safe<ViajeSinAsignar[]>(() => getViajesSinAsignar(tenantId)),
    safe<CargaOperador[]>(() => getCargaOperadores(tenantId)),
    safe<Array<{ id: string; nombre: string }>>(() => listOperadores(tenantId)),
    safe<UnidadRow[]>(() => getUnidades(tenantId)),
  ]);

  // ── Server actions ───────────────────────────────────────────────────────
  // Los dos resuelven el tenant OTRA VEZ desde la sesión en vez de confiar en
  // el `tenantId` que cerró el closure: un action es un endpoint con su propia
  // petición, y el valor capturado viene del render, no de quien hizo clic.

  async function accionAsignar(formData: FormData) {
    'use server';
    const t = await tenantDelAction('/dashboard/despacho', sufijo, sp?.tenant);
    const viajeId = String(formData.get('viajeId') ?? '');
    const operadorId = String(formData.get('operadorId') ?? '');
    const unidadId = String(formData.get('unidadId') ?? '');
    if (!viajeId || !operadorId) redirect(`/dashboard/despacho${sufijo}`);

    await reasignarOperador(t, viajeId, operadorId);
    // La unidad es OPCIONAL: un viaje se despacha sin ella (el flujo de
    // WhatsApp nunca la pregunta). Un '' no debe borrar una ya puesta, así
    // que solo se escribe cuando viene algo.
    if (unidadId) await asignarUnidad(t, viajeId, unidadId);

    revalidatePath('/dashboard/despacho');
    redirect(`/dashboard/despacho${sufijo ? `${sufijo}&` : '?'}ok=asignado`);
  }

  async function accionCrear(formData: FormData) {
    'use server';
    const t = await tenantDelAction('/dashboard/despacho', sufijo, sp?.tenant);
    const folio = String(formData.get('folio') ?? '').trim();
    const origen = String(formData.get('origen') ?? '').trim();
    const destino = String(formData.get('destino') ?? '').trim();
    const fecha = String(formData.get('fechaInicio') ?? '').trim();
    const operadorId = String(formData.get('operadorId') ?? '');
    const unidadId = String(formData.get('unidadId') ?? '');
    // Number y NO parseFloat: parseFloat("12abc") devuelve 12 en silencio, y
    // un anticipo mal tecleado que se guarda a medias descuadra la
    // liquidación entera sin que nadie lo note.
    const bruto = String(formData.get('anticipo') ?? '').trim();
    const anticipo = bruto === '' ? 0 : Number(bruto);
    if (!Number.isFinite(anticipo) || anticipo < 0) redirect(`/dashboard/despacho${sufijo}`);

    await crearViaje(t, {
      folio: folio || null,
      origen: origen || null,
      destino: destino || null,
      fechaInicio: fecha || null,
      anticipo,
      operadorId: operadorId || null,
      unidadId: unidadId || null,
    });

    revalidatePath('/dashboard/despacho');
    redirect(`/dashboard/despacho${sufijo ? `${sufijo}&` : '?'}ok=creado`);
  }

  const ops = operadores ?? [];
  const unidadesLibres = (unidades ?? []).filter((u) => u.estado === 'disponible' && u.activo);

  return (
    <main>
      <div className="glass-panel overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-center gap-2.5">
          <Send width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
          <div className="flex-1">
            <span className="text-sm font-medium block">Despacho</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Qué está sin repartir, quién trae cuánto, y a quién le toca
            </span>
          </div>
          {sp.ok === 'asignado' && <StatusPill estado="ok">Viaje asignado</StatusPill>}
          {sp.ok === 'creado' && <StatusPill estado="ok">Viaje creado</StatusPill>}
        </div>

        <div className="px-5 pb-4 pt-2">
          {tablero === null ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer el estado de la operación.</p>
          ) : (
            <TableroCifras t={tablero} />
          )}
        </div>

        <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2">
            <TituloSeccion>Sin asignar</TituloSeccion>
            {sinAsignar !== null && sinAsignar.length > 0 && (
              <StatusPill estado="warn">{String(sinAsignar.length)}</StatusPill>
            )}
          </div>
          <div className="mt-2.5">
            {sinAsignar === null ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la lista.</p>
            ) : sinAsignar.length === 0 ? (
              <EstadoVacio icono={<PackageCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Todo lo que está en curso ya trae chofer. Cuando entre un viaje sin asignar, aparece aquí.
              </EstadoVacio>
            ) : !puede ? (
              <EstadoVacio>
                Hay {sinAsignar.length} viaje(s) sin chofer, pero tu rol no puede asignar. Pídeselo al encargado o al
                dueño de la flota.
              </EstadoVacio>
            ) : ops.length === 0 ? (
              <EstadoVacio icono={<UserCog width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Hay {sinAsignar.length} viaje(s) sin chofer y ningún operador activo a quien asignárselos. Los
                operadores se dan de alta cuando escriben por WhatsApp por primera vez.
              </EstadoVacio>
            ) : (
              <TablaSinAsignar viajes={sinAsignar} operadores={ops} unidadesLibres={unidadesLibres} accion={accionAsignar} />
            )}
          </div>
        </div>

        <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Carga por operador</TituloSeccion>
          <div className="mt-2.5">
            {carga === null ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer la carga.</p>
            ) : (
              <TablaCarga carga={carga} />
            )}
          </div>
        </div>

        {puede && (
          <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2">
              <Plus width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
              <TituloSeccion>Dar de alta un viaje</TituloSeccion>
            </div>
            <div className="mt-2.5">
              <FormaAlta operadores={ops} unidadesLibres={unidadesLibres} accion={accionCrear} />
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                El anticipo se guarda porque el motor de cuadre lo necesita para comparar contra lo comprobado. No se
                lista ni se suma en esta pantalla: el dinero es de otra vista y de otro rol.
              </p>
            </div>
          </div>
        )}

        <div className="px-5 pb-5 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            El mapa en vivo, las geocercas y el ETA no aparecen porque no hay proveedor de rastreo conectado — no es
            una tabla que falte, es una integración que no existe. El margen por viaje tampoco: necesita el ingreso
            del flete, que hoy no se registra en ningún lado. Unidades, incidencias y POD sí tienen dónde vivir desde
            la migración 0047, y se administran en{' '}
            <Link href={`/dashboard/unidades${sufijo}`} className="underline">Unidades</Link> y{' '}
            <Link href={`/dashboard/viajes${sufijo}`} className="underline">Viajes</Link>.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
