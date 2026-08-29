import { redirect } from 'next/navigation';
import { MessageCircle, MessagesSquare, ChevronDown } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getHilosDeFlota, contarHilosDeFlota, TOPE_HILOS } from '@/lib/likida/conversaciones';
import { fechaHoraMx } from '@/lib/formato';
import { EstadoVacio, KpiTile } from '../../admin/ui/kit';
import { BarraPagina, TituloSeccion } from '../resumen-visual';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/conversaciones';

/**
 * LO QUE EL BOT LE DIJO A TUS CHOFERES — auditoría 20, hallazgo 6 (MEDIO).
 *
 * Hasta el 29-ago-2026 la conversación bot↔chofer sólo se leía desde /admin
 * (`getConversacionesActivas`, cruzada de TODAS las flotas). El dueño de la
 * flota —que es de quien son esos datos— no tenía dónde verla: cuando un
 * chofer alegaba "el bot me dijo que ya estaba liquidado", la única forma de
 * comprobarlo era pedírselo a Likida. Esta pantalla es esa lectura, acotada.
 *
 * EL AISLAMIENTO ES EL PUNTO, y va en dos capas:
 *   · `getHilosDeFlota(tenantId)` filtra en la BASE por tenant (y las filas
 *     sin flota atribuida quedan fuera por la semántica de `=`);
 *   · `puedeVerRuta` la declara `administracion`, o sea SOLO el dueño y el
 *     superadmin. No es `operacion` a propósito: el bot le dicta al chofer
 *     montos comprobados y diferencias de liquidación, y el jefe de tráfico
 *     no ve el dinero de la flota (ver `dinero_por_area.test.ts`). Un hilo de
 *     WhatsApp es dinero en prosa.
 *
 * Lo que la pantalla NO promete: no es el historial completo. `conv.ts` guarda
 * una ventana rodante de turnos en `wa_conversacion.estado`, y eso es lo que
 * hay — se dice, no se insinúa lo contrario.
 */
export default async function ConversacionesFlotaPage({ searchParams }: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Fail-cerrado: una lista vacía sobre una base caída afirmaría "el bot no ha
  // hablado con ninguno de tus choferes". El error se DICE.
  let hilos: Awaited<ReturnType<typeof getHilosDeFlota>> = [];
  let errorCarga: string | null = null;
  let total: number | null = null;
  try {
    [hilos, total] = await Promise.all([getHilosDeFlota(tenantId), contarHilosDeFlota(tenantId)]);
  } catch (e) {
    errorCarga = e instanceof Error ? e.message : String(e);
  }
  const mensajes = hilos.reduce((s, h) => s + h.turns.length, 0);
  const recortado = total !== null && total > hilos.length;

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<MessageCircle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conversaciones de WhatsApp"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Lo que tu bot habló con tus operadores, tal cual quedó guardado. Sirve para verificar qué se
            le dijo a un chofer cuando la versión de él y la tuya no coinciden.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <KpiTile
              icono={<MessageCircle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Hilos de tu flota" valor={total} formato="entero"
              vacio={total === null ? 'No se pudo contar — esto no significa que no haya ninguno.' : undefined}
            />
            <KpiTile
              icono={<MessagesSquare width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta={`Mensajes en los ${hilos.length} que se listan`} valor={mensajes} formato="entero"
            />
          </div>

          <div className="card p-3">
            <TituloSeccion>
              {recortado ? `Los ${TOPE_HILOS} más recientes de ${total}` : 'Todos tus hilos'}
            </TituloSeccion>

            {errorCarga !== null ? (
              <div className="rounded-lg p-3 text-sm mt-2"
                style={{ background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)', color: 'var(--color-warn)' }}>
                No se pudieron leer las conversaciones ahora mismo ({errorCarga.slice(0, 120)}). Recarga en un
                momento — hasta que la base conteste no hay forma de saber si el bot habló con alguien.
              </div>
            ) : hilos.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<MessageCircle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  El bot todavía no ha conversado con ningún número de tu flota. En cuanto un operador le
                  escriba por WhatsApp, el hilo aparece aquí.
                </EstadoVacio>
              </div>
            ) : (
              <div className="space-y-1.5 mt-2">
                {hilos.map((h) => (
                  <details key={h.telefono} className="hairline rounded-lg overflow-hidden group" style={{ background: 'var(--surface)' }}>
                    <summary className="px-3 py-2.5 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[var(--canvas)] transition-colors">
                      <div>
                        <div className="text-sm font-medium">{h.operadorNombre ?? h.telefono}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                          {h.operadorNombre ? `${h.telefono} · ` : ''}
                          {h.viajeFolio ? `viaje ${h.viajeFolio} · ` : ''}
                          {fechaHoraMx(h.actualizadaEn)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {h.turns.length > 0 ? `${h.turns.length} mensajes` : 'sin mensajes guardados'}
                        <ChevronDown width={14} height={14} className="transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    {h.turns.length > 0 && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--line2)' }}>
                        {h.turns.map((t, i) => (
                          <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                            <div className="max-w-[80%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap"
                              style={t.role === 'user'
                                ? { background: 'var(--canvas)', border: '1px solid var(--line2)' }
                                : { background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                              {t.content}
                            </div>
                          </div>
                        ))}
                        <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
                          Ventana reciente de la conversación: Likida guarda los últimos turnos, no el
                          historial completo desde el primer día.
                        </p>
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
