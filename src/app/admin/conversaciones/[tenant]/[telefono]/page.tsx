import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getConversacion, type ConversacionActiva } from '@/lib/admin/negocio';
import { fechaHoraMx } from '@/lib/formato';
import { BotonEnlace, EstadoError, MarcoPagina, Tarjeta } from '../../../../ui-v2/componentes';
import { HiloMensajes } from '../../hilo';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ADM-1 — el detalle de UNA conversación por su propia URL: el hueco que
 * dejaba `/admin/conversaciones` (solo las 20 más recientes, sin ruta por
 * conversación). Mismo patrón que `corridas/[id]`: un `tenant` que ni
 * siquiera es uuid es un 404, no un error de consulta; una lectura que
 * falla se dice, no se confunde con "no existe" (`getConversacion` = null).
 * `requireSuperadmin()` ya lo hizo el layout de /admin.
 */
export default async function ConversacionPage({
  params,
}: {
  params: Promise<{ tenant: string; telefono: string }>;
}) {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { tenant, telefono: telefonoParam } = await params;
  if (!UUID.test(tenant)) notFound();

  let conversacion: ConversacionActiva | null | undefined;
  try {
    // A37-S05-06: Next ya entrega el parámetro decodificado; decodificarlo OTRA VEZ lanzaba URIError (500) con
    // un % mal formado y doble-decodificaba un %25 legítimo. Se busca tal cual y, solo si no existe, con una
    // decodificación protegida (por si algún camino lo entrega crudo).
    conversacion = await getConversacion(tenant, telefonoParam);
    if (conversacion === null && telefonoParam.includes('%')) {
      let alterno: string | null = null;
      try { alterno = decodeURIComponent(telefonoParam); } catch { /* % mal formado: no existe */ }
      if (alterno && alterno !== telefonoParam) conversacion = await getConversacion(tenant, alterno);
    }
  } catch {
    conversacion = undefined;
  }
  if (conversacion === null) notFound();

  return (
    <MarcoPagina
      titulo={conversacion === undefined ? 'Conversación' : `Conversación — ${conversacion.telefono}`}
      acciones={<BotonEnlace href="/admin/conversaciones" variante="secondary" tamano="sm" icono={<ArrowLeft width={13} height={13} strokeWidth={1.75} />}>Volver</BotonEnlace>}
    >
      {conversacion === undefined ? (
        <EstadoError>No se pudo leer la conversación. La consulta falló — no es que no exista, es que no se pudo mirar.</EstadoError>
      ) : (
        <>
          <Tarjeta titulo={conversacion.tenantNombre}>
            <p className="m-0 text-xs text-muted">
              Última actividad: {fechaHoraMx(conversacion.actualizadaEn)} · {conversacion.turns.length} mensaje{conversacion.turns.length === 1 ? '' : 's'}
            </p>
          </Tarjeta>
          <Tarjeta titulo="Historial completo">
            {conversacion.turns.length === 0 ? (
              <p className="m-0 text-sm text-muted">Sin mensajes en la ventana rodante.</p>
            ) : (
              <HiloMensajes turnos={conversacion.turns} />
            )}
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Conversación' };
