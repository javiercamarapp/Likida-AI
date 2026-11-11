import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { aprobarPieza, rechazarPieza } from '@/lib/likida/agentes/cola';
import {
  listarHooks, listarReferencias, piezasEstudioPendientes, piezasEstudioAprobadasRecientes,
  pedirUrlFirmadaHook, guardarHook, guardarReferencia, subirFotoReferencia, validarFotoReferencia,
  esTipoReferencia, exigirConsentimientoReferencia, borrarReferencia, type UrlFirmadaSubida,
} from '@/lib/likida/marketing/estudio';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { fechaHoraMx, hoyMx } from '@/lib/formato';
import { Aviso, AvisoCompacto, Disclosure, EstadoError, FilaTarjetas, Tarjeta } from '../../ui-v2/componentes';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { uniformes } from '../cifras-uniformes';
import { observadas } from '../sello-observado';
import '../dinero.css';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { SubirHook, type ResultadoFirmaHook, type ResultadoGuardar } from './subir-hook';
import { SubirReferencia, type ResultadoReferencia } from './subir-referencia';
import { TarjetaPieza, type ResultadoPublicar } from './tarjeta-pieza';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

/**
 * /admin/marketing — el estudio de marketing (Fase D, orden del 16-ago).
 *
 * POR QUÉ UNA PÁGINA NUEVA Y NO SE EXTIENDE /admin/comunicacion: son dos
 * capacidades DISTINTAS que comparten nombre en español y nada más.
 * `/admin/comunicacion` es sobre AVISOS Y CAMPAÑAS INTERNAS — mensajes
 * masivos a choferes/flotas (segmentación, historial de envíos con métricas
 * de apertura) — y esa capacidad sigue sin existir: el único canal ahí sigue
 * siendo el bot de WhatsApp 1 a 1. Este estudio es sobre CONTENIDO DE
 * CRECIMIENTO hacia AFUERA (LinkedIn/Instagram/TikTok, banco de hooks,
 * personajes y lugares para el pipeline de video) — el dominio que
 * `agentes/crecimiento.ts` (0230) ya fabrica. Meter esto dentro de
 * `/admin/comunicacion` habría hecho verdadera a medias una frase que hoy es
 * enteramente cierta para su dominio real (avisos internos). Tampoco se pone
 * en `/admin/crecimiento`: esa página es el tablero de negocio (CPL,
 * embudos, campañas de ads) — un lienzo de KPIs, no una zona de subir
 * insumos y aprobar piezas.
 *
 * QUÉ HACE ESTA PÁGINA (y qué NO): lee lo que `crecimiento.ts` YA produce
 * hacia `cola_aprobacion` y dos tablas nuevas de insumo (`marketing_hook`,
 * `marketing_referencia`, 0266). No fabrica ninguna pieza, no genera ni una
 * imagen ni un video (ese pipeline sigue en el flujo LOCAL de Javier con
 * Higgsfield — TODO explícito en `lib/likida/marketing/estudio.ts`), y
 * "publicar" es exactamente `aprobarPieza`/`rechazarPieza` de
 * `agentes/cola.ts`, el mismo mecanismo de siempre.
 */
export default async function EstudioMarketingPage() {
  const { t } = await getT('admin_dinero');
  await requireSuperadmin();

  const [hooks, referencias, pendientes, aprobadas] = await Promise.all([
    listarHooks().catch(() => null),
    listarReferencias().catch(() => null),
    piezasEstudioPendientes().catch(() => null),
    piezasEstudioAprobadasRecientes().catch(() => null),
  ]);

  async function accionPedirFirmaHook(mime: string): Promise<ResultadoFirmaHook> {
    'use server';
    await requireSuperadmin();
    try {
      const r: UrlFirmadaSubida = await pedirUrlFirmadaHook(mime);
      return { ok: true, bucket: r.bucket, path: r.path, token: r.token };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'preparar la subida del video') };
    }
  }

  async function accionGuardarHook(videoRuta: string, hookTexto: string): Promise<ResultadoGuardar> {
    'use server';
    const s = await requireSuperadmin();
    try {
      await guardarHook({ videoRuta, hookTexto, actorId: s.userId });
      revalidatePath('/admin/marketing');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar el hook') };
    }
  }

  async function accionSubirReferencia(_previo: ResultadoReferencia, fd: FormData): Promise<ResultadoReferencia> {
    'use server';
  const { t } = await getT('admin_dinero');
    const s = await requireSuperadmin();
    try {
      const tipo = String(fd.get('tipo') ?? '');
      if (!esTipoReferencia(tipo)) return { error: t('marketing.el_tipo_debe_ser') };
      const nombre = String(fd.get('nombre') ?? '');
      const etiqueta = String(fd.get('etiqueta') ?? '') || null;
      const archivo = fd.get('foto');
      if (!(archivo instanceof File) || archivo.size === 0) return { error: t('marketing.elige_una_foto') };
      validarFotoReferencia(archivo.type, archivo.size);
      exigirConsentimientoReferencia(tipo, fd.get('consentimiento'));
      const ruta = await subirFotoReferencia(archivo, archivo.type);
      const idRef = await guardarReferencia({ tipo, nombre, etiqueta, fotoRuta: ruta, actorId: s.userId });
      await anotarBitacora(
        { tenantId: null, actor: { id: s.userId }, accion: 'marketing.referencia_subida', entidad: 'marketing_referencia', entidadId: idRef, detalle: { tipo, consentimiento: tipo === 'personaje' } },
        { evento: 'marketing.bitacora' },
      );
      revalidatePath('/admin/marketing');
      return { ok: true };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'subir la referencia') };
    }
  }

  async function accionBorrarReferencia(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('admin_dinero');
    const s = await requireSuperadmin();
    try {
      const id = String(fd.get('referencia') ?? '');
      await borrarReferencia(id);
      await anotarBitacora(
        { tenantId: null, actor: { id: s.userId }, accion: 'marketing.referencia_borrada', entidad: 'marketing_referencia', entidadId: id, detalle: null },
        { evento: 'marketing.bitacora' },
      );
      revalidatePath('/admin/marketing');
      return { ok: t('marketing.referencia_borrada_fila_y') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'borrar la referencia') };
    }
  }

  async function accionPublicarPieza(_previo: ResultadoPublicar, fd: FormData): Promise<ResultadoPublicar> {
    'use server';
  const { t } = await getT('admin_dinero');
    const s = await requireSuperadmin();
    try {
      await aprobarPieza(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/marketing');
      return { ok: t('marketing.publicada_quedo_aprobada_en') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'publicar la pieza') };
    }
  }

  async function accionRechazarPieza(_previo: ResultadoPublicar, fd: FormData): Promise<ResultadoPublicar> {
    'use server';
  const { t } = await getT('admin_dinero');
    const s = await requireSuperadmin();
    try {
      await rechazarPieza(String(fd.get('pieza') ?? ''), s.userId, String(fd.get('motivo') ?? ''));
      revalidatePath('/admin/marketing');
      return { ok: t('marketing.rechazada_con_motivo') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'rechazar la pieza') };
    }
  }

  // La bandeja no se declara «estancada» como hecho fijo: se mide con la pieza pendiente más reciente.
  const DIAS_ESTANCADA = 7;
  const masReciente = pendientes && pendientes.length > 0 ? pendientes.map((p) => p.creadoEn).sort().at(-1)! : null;
  const diasSinPiezas = masReciente ? Math.floor((Date.parse(`${hoyMx()}T00:00:00Z`) - Date.parse(`${masReciente.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null;

  // Cada cifra es un conteo de lo que se leyó; una lectura caída es «No disponible», nunca 0.
  const conteo = (etiqueta: string, lista: readonly unknown[] | null) =>
    lista === null ? { etiqueta, valor: null, estado: 'error' as const, mensaje: t('marketing.no_se_pudo_leer'), reintentar: true } : { etiqueta, valor: lista.length, formato: 'entero' as const };
  const cifras = [
    conteo(t('marketing.k_hooks'), hooks),
    conteo(t('marketing.k_referencias'), referencias),
    conteo(t('marketing.k_pendientes'), pendientes),
    conteo(t('marketing.k_publicadas'), aprobadas),
  ];

  return (
    <EsqueletoPanelCifras
      titulo={t('marketing.crecimiento')} apoyo={t('marketing.estudio_de_marketing_los')}
      etiquetaCifras={t('marketing.k_etiqueta')} cifras={observadas(uniformes(cifras), t('a1r4.observado'))}
      avisos={(
        <>
          {diasSinPiezas !== null && diasSinPiezas >= DIAS_ESTANCADA ? (
            <Aviso tono="warn" titulo={t('marketing.la_pieza_pendiente_mas', { diasSinPiezas })}>
              {t('marketing.no_han_llegado_piezas')}
            </Aviso>
          ) : null}
          <AvisoCompacto
            tono="info"
            resumen="Entre más insumo le das, mejor salen las piezas. Ninguna se genera sola; publicar sigue siendo tu aprobación."
            mas="Sube el video que te gustó o la foto del chofer o del patio, y abajo lees el guion, el carrusel, la promo del día y los encargos de imagen y video. No hay render en el servidor."
          />
        </>
      )}
    >
      {/* Plantilla PC (Rovaq): cifras → bloques de trabajo en 6-6 → el formulario ancho a todo el ancho de su tarjeta → lo que no se hace. */}
      <FilaTarjetas variante="6-6">
      <Tarjeta titulo={t('marketing.piezas_del_dia', { pendientes: pendientes !== null ? ` (${pendientes.length})` : '' })}>
        <p className="adm-din-nota">
          
          {t('marketing.lo_que_el_agente')} <a href="/admin/aprobaciones">Aprobaciones</a>.
        </p>
        {pendientes === null ? (
          <EstadoError compacto>{t('marketing.no_se_pudieron_leer')}</EstadoError>
        ) : pendientes.length === 0 ? (
          <p className="adm-din-nota">{t('marketing.nada_pendiente_ahora_mismo')}</p>
        ) : (
          <div className="adm-din-rejilla adm-din-rejilla--compacta">
            {pendientes.map((p) => <TarjetaPieza key={p.id} pieza={p} publicar={accionPublicarPieza} rechazar={accionRechazarPieza} />)}
          </div>
        )}
        {aprobadas !== null && aprobadas.length > 0 ? (
          <>
            <p className="adm-din-nota">{t('marketing.ya_publicadas')}</p>
            <ul className="adm-din-lista">
              {aprobadas.map((p) => <li key={p.id}>{p.titulo} <span>{p.agente}</span></li>)}
            </ul>
          </>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo={t('marketing.banco_de_hooks', { hooks: hooks !== null ? ` (${hooks.length})` : '' })}>
        <p className="adm-din-nota">{t('marketing.sube_un_video_que')}</p>
        <SubirHook pedirFirma={accionPedirFirmaHook} guardar={accionGuardarHook} />
        {hooks === null ? (
          <EstadoError compacto>{t('marketing.no_se_pudo_leer')}</EstadoError>
        ) : hooks.length === 0 ? (
          <p className="adm-din-nota">{t('marketing.sin_hooks_guardados_todavia')}</p>
        ) : (
          <div className="adm-din-rejilla adm-din-rejilla--compacta">
            {hooks.map((h) => (
              <div key={h.id} className="adm-din-plan">
                {h.videoUrl ? <video src={h.videoUrl} controls className="adm-din-video" /> : <Aviso tono="error">{t('marketing.no_se_pudo_firmar')}</Aviso>}
                <p className="adm-din-nota">{h.hookTexto}</p>
                <span className="adm-din-sub">{fechaHoraMx(h.creadoEn)}</span>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      </FilaTarjetas>

      <Tarjeta titulo={t('marketing.personajes_y_lugares', { referencias: referencias !== null ? ` (${referencias.length})` : '' })}>
        <p className="adm-din-nota">{t('marketing.el_pipeline_de_video')}</p>
        <SubirReferencia accion={accionSubirReferencia} />
        {referencias === null ? (
          <EstadoError compacto>{t('marketing.no_se_pudo_leer_2')}</EstadoError>
        ) : referencias.length === 0 ? (
          <p className="adm-din-nota">{t('marketing.sin_personajes_ni_lugares')}</p>
        ) : (
          <div className="adm-din-rejilla adm-din-rejilla--compacta">
            {referencias.map((r) => (
              <div key={r.id} className="adm-din-plan">
                {r.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- referencia interna del estudio, no next/image en el resto del repo
                  <img src={r.fotoUrl} alt={r.nombre} className="adm-din-miniatura" />
                ) : (
                  <Aviso tono="warn">{t('marketing.sin_vista_previa_de')}</Aviso>
                )}
                <div className="adm-din-plan__cab"><span>{r.nombre}</span></div>
                <span className="adm-din-sub">{r.tipo}</span>
                <FormaConAviso
                  accion={accionBorrarReferencia} boton="Borrar" columnas="md:grid-cols-1"
                  confirmar={{ titulo: t('marketing.borrar', { nombre: r.nombre }), descripcion: t('marketing.se_borran_la_fila'), etiquetaConfirmar: t('marketing.si_borrar') }}
                >
                  <input type="hidden" name="referencia" value={r.id} />
                </FormaConAviso>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      <Disclosure titulo={t('marketing.que_no_hace_el')} resumen="Generación de imagen y video">
        <p className="adm-din-nota">
          
          {t('marketing.la_generacion_real_de')}
        </p>
      </Disclosure>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_dinero');
  return { title: t('marketing.estudio_de_marketing') };
}
