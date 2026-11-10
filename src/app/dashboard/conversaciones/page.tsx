import { redirect } from 'next/navigation';
import { MessageCircle, MessagesSquare } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getHilosDeFlota, contarHilosDeFlota, TOPE_HILOS } from '@/lib/likida/conversaciones';
import { fechaHoraMx } from '@/lib/formato';
import { logger } from '@/lib/logger';
import type { Metadata } from 'next';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Disclosure, EstadoError, EstadoVacio, Icono, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import './conversaciones.css';
export const metadata: Metadata = { title: 'Conversaciones de WhatsApp' };

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
    // El detalle va al registro (sin teléfonos ni contenido de mensajes) y no a la pantalla: una cadena cruda de la base no le dice nada al dueño.
    logger.error('conversaciones.lectura_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    errorCarga = 'lectura';
  }
  const mensajes = hilos.reduce((s, h) => s + h.turns.length, 0);
  const recortado = total !== null && total > hilos.length;

  return (
    <MarcoPagina titulo="Equipo" apoyo="Lo que tu bot habló con tus operadores, tal cual quedó guardado: sirve para verificar qué se le dijo a un chofer.">
      <TiraCifras sello={selloHoy('Hilos de WhatsApp')}>
        <Cifra
          icono={<Icono icono={MessageCircle} />}
          etiqueta="Hilos de tu flota" info="conversaciones.hilos" valor={total} formato="entero"
          mensaje={total === null ? 'No se pudo contar — esto no significa que no haya ninguno.' : undefined}
        />
        <Cifra
          icono={<Icono icono={MessagesSquare} />}
          etiqueta={`Mensajes en los ${hilos.length} que se listan`} info="conversaciones.mensajes" valor={mensajes} formato="entero"
        />
      </TiraCifras>

      <Tarjeta titulo={recortado ? `Los ${TOPE_HILOS} más recientes de ${total}` : 'Todos tus hilos'} info="conversaciones.hilos">
        {errorCarga !== null ? (
          <EstadoError reintentar>
            No se pudieron leer las conversaciones ahora mismo. Recarga en un momento: hasta que la base conteste no hay forma de saber si el bot habló con alguien.
          </EstadoError>
        ) : hilos.length === 0 ? (
          <EstadoVacio icono={MessageCircle} contenido titulo="Sin conversaciones todavía">
            El bot todavía no ha conversado con ningún número de tu flota. En cuanto un operador le
            escriba por WhatsApp, el hilo aparece aquí.
          </EstadoVacio>
        ) : (
          <div className="rv-cv__hilos">
            {hilos.map((h) => (
              <Disclosure key={h.telefono} variante="tarjeta"
                titulo={(
                  <>
                    {h.operadorNombre ?? h.telefono}
                    <span className="rv-cv__sub">
                      {h.operadorNombre ? `${h.telefono} · ` : ''}
                      {h.viajeFolio ? `viaje ${h.viajeFolio} · ` : ''}
                      {fechaHoraMx(h.actualizadaEn)}
                    </span>
                  </>
                )}
                resumen={h.turns.length > 0 ? `${h.turns.length} mensajes` : 'sin mensajes guardados'}>
                {h.turns.length > 0 && (
                  <div className="rv-cv__turnos">
                    {h.turns.map((t, i) => (
                      <div key={i} className="rv-cv__turno" data-rol={t.role === 'user' ? 'chofer' : 'bot'}>
                        <div className="rv-cv__burbuja">{t.content}</div>
                      </div>
                    ))}
                    <p className="rv-cv__nota">
                      Ventana reciente de la conversación: Likida guarda los últimos turnos, no el
                      historial completo desde el primer día.
                    </p>
                  </div>
                )}
              </Disclosure>
            ))}
          </div>
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
