import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { sufijoTenant } from '../sufijo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import '@/lib/likida/orquestador/fuentes_reales';
import { leerTareasDeDinero, TOPE_TAREAS_DINERO } from '@/lib/likida/orquestador/tareas_de_dinero';
import { TareasAbiertas } from '../viajes-en-vivo/vista';
import { InicioContador } from './inicio-contador';

export const dynamic = 'force-dynamic';

/**
 * LA CASA DEL CONTADOR — la raíz reconstruida el 14-ago-2026 (la primera
 * versión, con sus 5 subrutas, se borró el 10-ago para rehacerse desde cero).
 *
 * La puerta es la MISMA que la de cualquier página de dinero
 * (combustible-casetas, facturación): `resolverTenantEfectivo` recibe la ruta
 * y adentro gatea con `puedeVerRuta` — `/dashboard/contador` está declarada
 * como `dinero` en AREA_POR_RUTA, así que el encargado rebota a su propio
 * inicio y el contador, el dueño y el superadmin pasan. La lectura no tiene
 * una segunda puerta: cruza `puedeVerRuta`. La declaración del estímulo de
 * peaje (Fase 3) SÍ es una server action — vive en `estimulo-peaje.tsx` y
 * re-gatea adentro, porque el rol del render no es el de la acción.
 *
 * El contenido vive en `inicio-contador.tsx` exportado — mismas dos razones
 * que documenta `InicioContenido`: Next valida los exports de una Page (un
 * export extra rompe el build), y sin export el preview headless no puede
 * montar el componente REAL sin sesión.
 */
export default async function PanelContadorPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantNombre, nombre, tenantExiste, rol } = await resolverTenantEfectivo('/dashboard/contador', sp);
  // El MISMO contrato de sufijo que el sidebar y que `/dashboard/page.tsx`:
  // los links que esta página emite cargan el `?tenant=`/`?vista=`/`?rol=`
  // del superadmin; para roles reales queda vacío. `sufijoTenant` es la
  // versión canónica de esa lógica para páginas server.
  const sufijo = sufijoTenant(sp);

  // Las tareas de dinero que el asistente derivó (liquidación, contador): su dueño es quien ve `dinero`, y el contador no
  // entra a /dashboard/viajes-en-vivo (es de operación), así que las lee aquí. Solo lectura: atenderlas es de quien asigna.
  // A37-S17-03: el filtro de dinero va en la consulta (no después de un límite), se avisa si hay más de las que se pintan y un
  // fallo de lectura se dice (no se confunde con «no hay tareas»).
  const lectura = await leerTareasDeDinero(tenantId, rol);
  const veLaRuta = puedeVerRuta(rol, '/dashboard/contador');
  const tareas = lectura.estado === 'ok' ? lectura.tareas : null;
  const hayTareas = veLaRuta && tareas !== null && tareas.length > 0;
  const hayMas = lectura.estado === 'ok' && lectura.hayMas;

  return (
    <>
    <InicioContador
      tenantId={tenantId}
      tenantNombre={tenantNombre}
      nombre={nombre}
      tenantExiste={tenantExiste}
      sufijo={sufijo}
      searchParams={sp}
    />
    {hayTareas && (
      <main className="px-4 md:px-6 pb-6 space-y-2">
        <TareasAbiertas tareas={tareas} accion={null} ocultos={{}} />
        {hayMas && <p className="text-[12px]" role="status" style={{ color: 'var(--muted)' }}>Hay más de {TOPE_TAREAS_DINERO} tareas de dinero abiertas: se muestran las {TOPE_TAREAS_DINERO} más recientes.</p>}
      </main>
    )}
    {veLaRuta && lectura.estado === 'error' && (
      <main className="px-4 md:px-6 pb-6">
        <p className="card p-4 text-[12.5px]" role="alert">No se pudieron leer las tareas de dinero que dejó el asistente. No es que no haya: no pudimos consultarlas ahora. Recarga la página.</p>
      </main>
    )}
    </>
  );
}
