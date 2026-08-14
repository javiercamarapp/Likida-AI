import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getViajes } from '@/lib/likida/analytics';
import { resolverCiudad, type Ciudad } from '@/lib/likida/geo/ciudades';
import { ahoraMs } from '@/lib/saludo';
import { proyectar } from './mexico-geo';
import { VistaMapa, type SinUbicar } from './vista';
import type { ViajeEnMapa } from './mapa-vivo';

export const dynamic = 'force-dynamic';

/** Km en línea recta (haversine) — se rotula "en línea recta" SIEMPRE: no es
 *  el kilometraje de carretera y no se presenta como tal. */
function kmEntre(a: Ciudad, b: Ciudad): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/**
 * El mapa de la operación (F3 del plan): los viajes VIVOS sobre México.
 *
 * LA VERDAD DE LOS DATOS: `posicion` y `geocerca` están vacías — no hay GPS.
 * Lo que se dibuja es el trayecto ILUSTRATIVO origen→destino geocodificado
 * contra la tabla estática de ciudades, y así se rotula. Nunca "posición
 * actual", nunca ETA. Una ciudad no reconocida NO desaparece el viaje: se
 * lista aparte con sus palabras.
 *
 * Área `operacion` (el jefe de tráfico es quien vigila rutas) y por eso
 * CERO pesos: las cards llevan días en ruta y fotos, no gasto.
 */
export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/mapa', sp);
  if (!puedeVerRuta(rol, '/dashboard/mapa')) redirect('/dashboard');

  const viajes = await getViajes(tenantId);
  const vivos = viajes.filter((v) => v.estatus === 'abierto' || v.estatus === 'en_cuadre');

  const ahora = ahoraMs();
  const ubicados: ViajeEnMapa[] = [];
  const sinUbicar: SinUbicar[] = [];

  for (const v of vivos) {
    const origen = resolverCiudad(v.origen);
    const destino = resolverCiudad(v.destino);
    if (!origen || !destino) {
      const faltas: string[] = [];
      if (!origen) faltas.push(v.origen ? `«${v.origen}» no está en el mapa todavía` : 'sin origen capturado');
      if (!destino) faltas.push(v.destino ? `«${v.destino}» no está en el mapa todavía` : 'sin destino capturado');
      sinUbicar.push({ id: v.id, folio: v.folio, operadorNombre: v.operadorNombre, motivo: faltas.join(' · ') });
      continue;
    }
    const o = proyectar(origen.lat, origen.lng);
    const d = proyectar(destino.lat, destino.lng);
    ubicados.push({
      id: v.id,
      folio: v.folio,
      operadorNombre: v.operadorNombre,
      origenNombre: origen.nombre,
      destinoNombre: destino.nombre,
      ox: +o.x.toFixed(1), oy: +o.y.toFixed(1),
      dx: +d.x.toFixed(1), dy: +d.y.toFixed(1),
      dias: v.fechaInicio
        ? Math.max(0, Math.floor((ahora - Date.parse(`${v.fechaInicio}T00:00:00Z`)) / 86_400_000))
        : null,
      fotos: v.intakePendientes,
      escalado: v.escaladoEn !== null && v.aceptadoEn === null,
      kmRecta: kmEntre(origen, destino),
    });
  }

  // Lo más atorado primero — mismo criterio que la cola de cobranza.
  ubicados.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));

  return <VistaMapa ubicados={ubicados} sinUbicar={sinUbicar} />;
}
