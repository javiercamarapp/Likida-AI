import { cifrasUniformes } from '../formato';
import { redirect } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getHilosDeFlota, contarHilosDeFlota, TOPE_HILOS } from '@/lib/likida/conversaciones';
import { fechaHoraMx, numero } from '@/lib/formato';
import { logger } from '@/lib/logger';
import type { Metadata } from 'next';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { BarraFiltros, BotonEnlace, EstadoError, EstadoVacio, FiltroBusqueda } from '@/app/ui-v2/componentes';
import { TarjetaTabla } from '../bloque';
import { TablaLista, type ColumnaTabla } from '@/app/ui-v2/datos';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { sufijoTenant } from '../sufijo';
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
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; ver?: string; q?: string }>;
}) {
  const { t, idioma } = await getT('operacion');
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
  // Búsqueda en memoria sobre los hilos que la lectura del tenant YA trajo (nunca una consulta más amplia): chofer, teléfono o folio.
  const q = (sp.q ?? '').trim().slice(0, 80);
  const norm = (x: string | null | undefined) => (x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (q) hilos = hilos.filter((h) => [h.operadorNombre, h.telefono, h.viajeFolio].some((x) => norm(x).includes(norm(q))));
  const mensajes = hilos.reduce((s, h) => s + h.turns.length, 0);
  const recortado = total !== null && total > hilos.length;

  type Hilo = (typeof hilos)[number];
  const hrefVer = (tel: string | null) => {
    const qs = new URLSearchParams(sufijoTenant(sp).replace(/^\?/, ''));
    if (tel) qs.set('ver', tel); else qs.delete('ver');
    const q = qs.toString();
    return `${RUTA}${q ? `?${q}` : ''}`;
  };
  // El cajón solo abre un hilo que la lectura del tenant trajo: un `?ver=` ajeno no muestra nada.
  const verTel = (sp.ver ?? '').trim().slice(0, 40);
  const seleccion = verTel ? hilos.findIndex((h) => h.telefono === verTel) : -1;
  const sel = seleccion >= 0 ? hilos[seleccion] : null;

  const cifras: PropsCifra[] = [
    { etiqueta: t('conv.hilos'), info: 'conversaciones.hilos', valor: total, formato: 'entero', mensaje: total === null ? t('conv.hilos.nocuenta') : undefined },
    { etiqueta: t('conv.mensajes.etiqueta'), info: 'conversaciones.mensajes', valor: mensajes, formato: 'entero' },
  ];
  const columnas: ColumnaTabla<Hilo>[] = [
    { id: 'chofer', titulo: t('conv.col.chofer'), principal: true, celda: (h) => (<>{h.operadorNombre ?? h.telefono}{h.operadorNombre ? <span className="rv-tl__sub">{h.telefono}</span> : null}</>) },
    { id: 'viaje', titulo: t('conv.col.viaje'), corta: true, celda: (h) => h.viajeFolio ?? <span className="rv-tl__tenue rv-tl__nada">—</span> },
    { id: 'mensajes', titulo: t('conv.col.mensajes'), corta: true, alinear: 'der', celda: (h) => (h.turns.length > 0 ? numero(h.turns.length, idioma) : <span className="rv-tl__tenue">{t('conv.sinmensajes')}</span>) },
    { id: 'actividad', titulo: t('conv.col.actualizada'), corta: true, celda: (h) => <span className="rv-tl__apagado">{fechaHoraMx(h.actualizadaEn, idioma)}</span> },
    { id: 'accion', titulo: t('conv.vr.ver'), alinear: 'der', tituloOculto: true, celda: (h) => <BotonEnlace variante="ghost" tamano="sm" href={hrefVer(h.telefono)} className="rv-tl__enlace">{t('conv.vr.ver')}</BotonEnlace> },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('conv.titulo')}
      apoyo={t('conv.apoyo')}
      filtros={errorCarga === null ? (
        <BarraFiltros enLinea accion={RUTA} buscar etiqueta={t('conv.filtros')} nActivos={q ? 1 : 0} limpiarHref={`${RUTA}${sufijoTenant(sp)}`}
          ocultos={[...new URLSearchParams(sufijoTenant(sp).replace(/^\?/, '')).entries()]}>
          <FiltroBusqueda nombre="q" valor={q} placeholder={t('conv.buscar.ph')} etiqueta={t('conv.buscar.aria')} />
        </BarraFiltros>
      ) : undefined}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy(t('conv.sello'))}
      pie={errorCarga === null && hilos.length > 0 ? (recortado ? t('conv.tarjeta.recientes', { tope: TOPE_HILOS, total: total ?? 0 }) : t('conv.tarjeta.todos')) : undefined}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.operadorNombre ?? sel.telefono}
          subtitulo={t('conv.vr.sub', { n: numero(seleccion + 1, idioma), total: numero(hilos.length, idioma) })}
          hrefCerrar={hrefVer(null)}
          cifras={[
            { etiqueta: t('conv.col.mensajes'), valor: numero(sel.turns.length, idioma) },
            { etiqueta: t('conv.vr.chofer'), valor: numero(sel.turns.filter((x) => x.role === 'user').length, idioma) },
            { etiqueta: t('conv.vr.bot'), valor: numero(sel.turns.filter((x) => x.role !== 'user').length, idioma) },
            { etiqueta: t('conv.col.actualizada'), valor: fechaHoraMx(sel.actualizadaEn, idioma) },
          ]}
        >
          {sel.turns.length > 0 && (
            <div className="rv-cv__turnos">
              {sel.turns.map((turno, i) => (
                <div key={i} className="rv-cv__turno" data-rol={turno.role === 'user' ? 'chofer' : 'bot'}>
                  <div className="rv-cv__burbuja">{turno.content}</div>
                </div>
              ))}
              <p className="rv-cv__nota">
                {t('conv.nota')}
              </p>
            </div>
          )}
        </CajonVistaRapida>
      ) : null}
    >
      <TarjetaTabla titulo={t('conv.tabla')} contador={errorCarga === null && hilos.length > 0 ? numero(hilos.length, idioma) : undefined}>
        {errorCarga !== null ? (
          <EstadoError reintentar>
            {t('conv.error')}
          </EstadoError>
        ) : hilos.length === 0 ? (
          <EstadoVacio icono={MessageCircle} contenido titulo={q ? t('conv.sincoincidencias') : t('conv.vacio.titulo')}>
            {t('conv.vacio')}
          </EstadoVacio>
        ) : (
          <TablaLista<Hilo> etiqueta={t('conv.tabla')} columnas={columnas} filas={hilos} idFila={(h) => h.telefono} base={RUTA} params={{}} />
        )}
      </TarjetaTabla>
    </EsqueletoTablaMaestra>
  );
}
