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
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('operacion');
  return { title: t('meta.conversaciones') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/conversaciones';

/**
 * LO QUE EL BOT LE DIJO A TUS CHOFERES — auditoría 20, hallazgo 6 (MEDIO).
 *
 * Hasta el 29-ago-2026 la conversación bot y chofer sólo se leía desde /admin
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
  const { t, tp, idioma } = await getT('operacion');
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
    <MarcoPagina titulo={t('conv.titulo')} apoyo={t('conv.apoyo')}>
      <TiraCifras sello={selloHoy(t('conv.sello'))}>
        <Cifra
          icono={<Icono icono={MessageCircle} />}
          etiqueta={t('conv.hilos')} info="conversaciones.hilos" valor={total} formato="entero"
          mensaje={total === null ? t('conv.hilos.nocuenta') : undefined}
        />
        <Cifra
          icono={<Icono icono={MessagesSquare} />}
          etiqueta={t('conv.mensajes.etiqueta', { n: hilos.length })} info="conversaciones.mensajes" valor={mensajes} formato="entero"
        />
      </TiraCifras>

      <Tarjeta titulo={recortado ? t('conv.tarjeta.recientes', { tope: TOPE_HILOS, total }) : t('conv.tarjeta.todos')} info="conversaciones.hilos">
        {errorCarga !== null ? (
          <EstadoError reintentar>
            {t('conv.error')}
          </EstadoError>
        ) : hilos.length === 0 ? (
          <EstadoVacio icono={MessageCircle} contenido titulo={t('conv.vacio.titulo')}>
            {t('conv.vacio')}
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
                      {h.viajeFolio ? t('conv.viaje', { folio: h.viajeFolio }) : ''}
                      {fechaHoraMx(h.actualizadaEn, idioma)}
                    </span>
                  </>
                )}
                resumen={h.turns.length > 0 ? tp('conv.mensajes', h.turns.length) : t('conv.sinmensajes')}>
                {h.turns.length > 0 && (
                  <div className="rv-cv__turnos">
                    {h.turns.map((turno, i) => (
                      <div key={i} className="rv-cv__turno" data-rol={turno.role === 'user' ? 'chofer' : 'bot'}>
                        <div className="rv-cv__burbuja">{turno.content}</div>
                      </div>
                    ))}
                    <p className="rv-cv__nota">
                      {t('conv.nota')}
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
