import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { getConversacion, type ConversacionActiva } from '@/lib/admin/negocio';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../../../dashboard/resumen-visual';
import { EstadoError } from '../../../ui/kit';

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
  const { tenant, telefono: telefonoParam } = await params;
  const telefono = decodeURIComponent(telefonoParam);
  if (!UUID.test(tenant)) notFound();

  let conversacion: ConversacionActiva | null | undefined;
  try {
    conversacion = await getConversacion(tenant, telefono);
  } catch {
    conversacion = undefined;
  }
  if (conversacion === null) notFound();

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<MessageCircle {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo={conversacion === undefined ? 'Conversación' : `Conversación — ${conversacion.telefono}`}
          derecha={
            <Link href="/admin/conversaciones" className="text-xs flex items-center gap-1.5 hairline rounded-lg px-2.5 py-1.5" style={{ color: 'var(--muted)' }}>
              <ArrowLeft width={13} height={13} strokeWidth={1.75} /> Volver
            </Link>
          }
        />
        <div className="px-5 py-5 flex-1">
          {conversacion === undefined ? (
            <EstadoError mensaje="No se pudo leer la conversación. La consulta falló — no es que no exista, es que no se pudo mirar." />
          ) : (
            <>
              <div className="card p-3 mb-2.5">
                <TituloSeccion>{conversacion.tenantNombre}</TituloSeccion>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Última actividad: {fechaHoraMx(conversacion.actualizadaEn)} · {conversacion.turns.length} mensaje{conversacion.turns.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="card p-3">
                <TituloSeccion>Historial completo</TituloSeccion>
                {conversacion.turns.length === 0 ? (
                  <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Sin mensajes en la ventana rodante.</p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {conversacion.turns.map((t, i) => (
                      <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                        <div className="max-w-[80%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap"
                          style={t.role === 'user'
                            ? { background: 'var(--canvas)', border: '1px solid var(--line2)' }
                            : { background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                          {t.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
