import { revalidatePath } from 'next/cache';
import { Wrench } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar, puedeAdministrar } from '@/lib/auth/permisos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getTaller, validarRutina, crearRutina, abrirOrdenProgramada, cerrarOrden,
  type OrdenTaller, type PropuestaRutina,
} from '@/lib/likida/mantenimiento';
import { fechaHoraMx, numero } from '@/lib/formato';
import { FormaConAviso, Campo, type ResultadoAccion } from '../../admin/ui/forma';

/**
 * EL TALLER (Fase 9, 0209) — la sección de mantenimiento del registro de
 * unidades. Enseña lo que la tabla `mantenimiento` por fin registra:
 *
 *  · Órdenes abiertas, con su origen dicho (avería firmada de talacha, rutina
 *    preventiva, o captura) — cerrarlas pide el km del servicio si se sabe,
 *    y un km que no se sabe se queda null, jamás 0.
 *  · Rutinas preventivas por días y/o km ("lo que ocurra primero") y sus
 *    PROPUESTAS: la vencida se enseña con su motivo — incluido "sin odómetro
 *    declarado", que es una falta de dato, no un "al día". La orden la abre
 *    un humano con el botón; aquí no hay cron que gaste solo.
 *
 * Puertas: VER es área operacion (la misma de la página); abrir/cerrar
 * órdenes es `puedeAsignar` (el encargado opera el taller); declarar rutinas
 * es `puedeAdministrar` (una rutina es política de la flota, como la unidad
 * misma). Las tres se RE-COMPRUEBAN dentro de cada action.
 */

const RUTA = '/dashboard/unidades';

const MOTIVO: Record<PropuestaRutina['motivo'], string> = {
  vencida_por_dias: 'vencida por días',
  vencida_por_km: 'vencida por kilómetros',
  sin_historial: 'sin historial — nunca se le ha hecho; propuesta de arranque',
  sin_odometro: 'sin odómetro declarado — la rutina es por km y la unidad no tiene km capturado: no se puede evaluar',
};

function Origen({ o }: { o: OrdenTaller }) {
  if (o.deAveria) return <span>de avería autorizada (talacha)</span>;
  if (o.deRutina) return <span>de rutina «{o.deRutina}»</span>;
  return <span>capturada</span>;
}

export async function BloqueTaller({
  sp,
}: {
  sp: { tenant?: string; rol?: string; vista?: string };
}) {
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) return null;

  // SIN catch (el criterio de la página): una sección que existe para avisar
  // de mantenimiento vencido no puede pintar "todo al día" porque la lectura
  // falló — se cae y error.tsx lo dice.
  const taller = await getTaller(tenantId);
  const opera = puedeAsignar(rol);
  const administra = puedeAdministrar(rol);

  async function accionCrearRutina(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede ver las unidades.' };
    if (!puedeAdministrar(s.rol)) return { error: 'Solo el dueño de la flota declara rutinas de mantenimiento.' };
    try {
      const v = validarRutina({
        nombre: String(fd.get('nombre') ?? ''),
        cadaDias: String(fd.get('cadaDias') ?? ''),
        cadaKm: String(fd.get('cadaKm') ?? ''),
      });
      await crearRutina(s.tenantId, v, s.userId);
      revalidatePath(RUTA);
      return { ok: `La rutina «${v.nombre}» quedó declarada. Sus propuestas salen aquí en cuanto venza en alguna unidad.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'declarar la rutina') };
    }
  }

  async function accionAbrirOrden(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return;
    try {
      await abrirOrdenProgramada(s.tenantId, String(fd.get('rutinaId') ?? ''), String(fd.get('unidadId') ?? ''));
    } catch {
      // El candado real es la unique de la 0209; el doble clic que pierde la
      // carrera simplemente ve la orden ya abierta al revalidar.
    }
    revalidatePath(RUTA);
  }

  async function accionCerrarOrden(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede ver las unidades.' };
    if (!puedeAsignar(s.rol)) return { error: 'Cerrar órdenes de taller es del encargado o del dueño.' };
    try {
      const kmCrudo = String(fd.get('kmServicio') ?? '').trim();
      const km = kmCrudo === '' ? null : Number(kmCrudo);
      if (km !== null && !Number.isFinite(km)) return { error: 'El kilometraje tiene que ser un número (o déjalo vacío si no se sabe).' };
      await cerrarOrden(s.tenantId, String(fd.get('ordenId') ?? ''), km === null ? null : Math.trunc(km));
      revalidatePath(RUTA);
      return { ok: 'Orden cerrada.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'cerrar la orden') };
    }
  }

  return (
    <section className="mt-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4" aria-hidden />
        <h2 className="text-sm font-semibold">Taller — mantenimiento de la flota</h2>
      </div>

      {/* ── Órdenes abiertas ── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">Órdenes abiertas ({taller.ordenesAbiertas.length})</h3>
        {taller.ordenesAbiertas.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Sin órdenes abiertas. Las averías que tu jefe de patio autoriza por WhatsApp abren la suya solas.
          </p>
        ) : (
          taller.ordenesAbiertas.map((o) => (
            <details key={o.id} className="rounded-xl hairline px-3.5 py-2.5">
              <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="font-medium">unidad {o.unidadEco}</span>
                <span style={{ color: 'var(--muted)' }}>{o.tipo}</span>
                <span style={{ color: 'var(--muted)' }}><Origen o={o} /></span>
                <span className="ml-auto" style={{ color: 'var(--muted)' }}>{fechaHoraMx(o.abiertaEn)}</span>
              </summary>
              <div className="mt-2.5 flex flex-col gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                {o.descripcion && <span>{o.descripcion}</span>}
                {opera && (
                  <FormaConAviso accion={accionCerrarOrden} boton="Cerrar orden" columnas="md:grid-cols-2">
                    <input type="hidden" name="ordenId" value={o.id} />
                    <Campo
                      nombre="kmServicio" etiqueta="Km al momento del servicio" tipo="number"
                      ayuda="Déjalo vacío si no se sabe — un km que no se midió no se inventa. Alimenta el reloj de las rutinas por km."
                    />
                  </FormaConAviso>
                )}
              </div>
            </details>
          ))
        )}
      </div>

      {/* ── Propuestas de las rutinas ── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">Rutinas preventivas — propuestas ({taller.propuestas.length})</h3>
        {taller.rutinas.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Sin rutinas declaradas. Declara abajo la primera (p. ej. «Servicio de motor» cada 10,000 km o 180 días) y Likida
            te propone aquí cuál unidad ya la trae vencida.
          </p>
        ) : taller.propuestas.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Ninguna rutina vencida en las unidades activas — con los relojes que se pueden leer (el km solo cuenta si está
            capturado en la unidad y en el servicio anterior).
          </p>
        ) : (
          taller.propuestas.map((p) => (
            <div key={`${p.rutinaId}|${p.unidadId}`} className="rounded-xl hairline px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className="font-medium">unidad {p.unidadEco}</span>
              <span>«{p.rutinaNombre}»</span>
              <span style={{ color: 'var(--muted)' }}>
                {MOTIVO[p.motivo]}
                {p.diasDesdeServicio !== null && ` · ${p.diasDesdeServicio} días del último servicio`}
                {p.kmDesdeServicio !== null && ` · ${numero(p.kmDesdeServicio)} km recorridos`}
              </span>
              {opera && p.motivo !== 'sin_odometro' && (
                <form action={accionAbrirOrden} className="ml-auto">
                  <input type="hidden" name="rutinaId" value={p.rutinaId} />
                  <input type="hidden" name="unidadId" value={p.unidadId} />
                  <button type="submit" className="rounded-lg hairline px-2.5 py-1 text-xs font-medium">
                    Abrir orden
                  </button>
                </form>
              )}
              {opera && p.motivo === 'sin_odometro' && (
                <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>captura el km de la unidad para evaluarla</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Declarar rutina ── */}
      {administra && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium">Declarar una rutina</h3>
          <FormaConAviso accion={accionCrearRutina} boton="Declarar rutina">
            <Campo nombre="nombre" etiqueta="Nombre" placeholder="Servicio de motor" requerido />
            <Campo nombre="cadaDias" etiqueta="Cada cuántos días" tipo="number" ayuda="Vacío si la rutina no corre por tiempo." />
            <Campo nombre="cadaKm" etiqueta="Cada cuántos km" tipo="number" ayuda="Vacío si no corre por km. Con ambos, vence lo que ocurra primero." />
          </FormaConAviso>
        </div>
      )}
    </section>
  );
}
