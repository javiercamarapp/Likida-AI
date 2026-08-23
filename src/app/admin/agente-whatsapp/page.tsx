import {
  getResumenNegocio, getConversacionesActivas, contarConversacionesActivas, TOPE_CONVERSACIONES,
} from '@/lib/admin/negocio';
import { MessagesSquare, MessageCircle, ChevronDown, DollarSign } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ICONO_KPI = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/**
 * Agente de WhatsApp — la capa de conversación que lleva al operador de
 * principio a fin. Real: `llm_costo` filtrado por `fase === 'whatsapp'`
 * (`getResumenNegocio`) y `wa_conversacion.estado` para las conversaciones
 * activas (mismo render que Inicio, con más espacio para leerlas).
 *
 * Re-envuelta en la anatomía de página (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts` (MessagesSquare, el mismo del sidebar) +
 * `StatCard` del kit. Cifras y fuente no cambian. Un cero aquí es MEDIDO:
 * cero filas en `llm_costo` para la fase es cero gasto real, no un relleno.
 */
export default async function AgenteWhatsappPage() {
  const [r, conversaciones, total] = await Promise.all([
    getResumenNegocio(), getConversacionesActivas(), contarConversacionesActivas(),
  ]);
  // FE-9: "Conversaciones activas" listaba 20 sin decir que eran 20 de N.
  const recortado = total !== null && total > conversaciones.length;
  const whatsapp = r.porFase.find((f) => f.fase === 'whatsapp');

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<MessagesSquare width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de WhatsApp"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>La conversación completa con el operador — costo real, histórico</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <StatCard icono={<DollarSign {...ICONO_KPI} />}
              etiqueta="Gastado en WhatsApp" valor={whatsapp ? whatsapp.costoUsd : 0} formato="usd"
            />
            <StatCard icono={<MessageCircle {...ICONO_KPI} />}
              etiqueta="Llamadas de WhatsApp" valor={whatsapp ? whatsapp.n : 0} formato="entero"
            />
          </div>

          {/* Mismo render que la sección "Conversaciones de WhatsApp" de
              Inicio (consola.tsx) — misma fuente, más espacio para leerlas. */}
          <div className="card p-3">
            <TituloSeccion>
              {recortado ? `Conversaciones activas — las ${TOPE_CONVERSACIONES} más recientes de ${total}` : 'Conversaciones activas'}
            </TituloSeccion>
            {conversaciones.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {conversaciones.map((c) => (
                  <details key={`${c.tenantId ?? "sin-flota"}-${c.telefono}`} className="hairline rounded-lg overflow-hidden group" style={{ background: 'var(--surface)' }}>
                    <summary className="px-3 py-2.5 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[var(--canvas)] transition-colors">
                      <div>
                        <div className="text-sm font-medium">{c.telefono}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{c.tenantNombre}</div>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {c.turns.length > 0 ? `${c.turns.length} mensajes` : 'sin mensajes'}
                        <ChevronDown width={14} height={14} className="transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    {c.turns.length > 0 && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--line2)' }}>
                        {c.turns.slice(-6).map((t, i) => (
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
                  </details>
                ))}
              </div>
            )}
          </div>

          <div className="card p-3">
            <TituloSeccion>Lo que falta</TituloSeccion>
            <div className="mt-2">
              <EstadoVacio>
                Entrega (enviados/entregados/leídos), ventana de 24h, opt-ins — requiere integrar la Meta WhatsApp
                Business API más a fondo de lo que Likida usa hoy.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
