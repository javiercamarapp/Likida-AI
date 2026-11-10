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
import { Aviso, AvisoCompacto, Disclosure, EstadoError, MarcoPagina, Tarjeta } from '../../ui-v2/componentes';
import '../dinero.css';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { SubirHook, type ResultadoFirmaHook, type ResultadoGuardar } from './subir-hook';
import { SubirReferencia, type ResultadoReferencia } from './subir-referencia';
import { TarjetaPieza, type ResultadoPublicar } from './tarjeta-pieza';

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
    const s = await requireSuperadmin();
    try {
      const tipo = String(fd.get('tipo') ?? '');
      if (!esTipoReferencia(tipo)) return { error: 'El tipo debe ser personaje o lugar.' };
      const nombre = String(fd.get('nombre') ?? '');
      const etiqueta = String(fd.get('etiqueta') ?? '') || null;
      const archivo = fd.get('foto');
      if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Elige una foto.' };
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
    const s = await requireSuperadmin();
    try {
      const id = String(fd.get('referencia') ?? '');
      await borrarReferencia(id);
      await anotarBitacora(
        { tenantId: null, actor: { id: s.userId }, accion: 'marketing.referencia_borrada', entidad: 'marketing_referencia', entidadId: id, detalle: null },
        { evento: 'marketing.bitacora' },
      );
      revalidatePath('/admin/marketing');
      return { ok: 'Referencia borrada: fila y foto.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'borrar la referencia') };
    }
  }

  async function accionPublicarPieza(_previo: ResultadoPublicar, fd: FormData): Promise<ResultadoPublicar> {
    'use server';
    const s = await requireSuperadmin();
    try {
      await aprobarPieza(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/marketing');
      return { ok: 'Publicada: quedó aprobada en la bandeja.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'publicar la pieza') };
    }
  }

  async function accionRechazarPieza(_previo: ResultadoPublicar, fd: FormData): Promise<ResultadoPublicar> {
    'use server';
    const s = await requireSuperadmin();
    try {
      await rechazarPieza(String(fd.get('pieza') ?? ''), s.userId, String(fd.get('motivo') ?? ''));
      revalidatePath('/admin/marketing');
      return { ok: 'Rechazada con motivo.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'rechazar la pieza') };
    }
  }

  // La bandeja no se declara «estancada» como hecho fijo: se mide con la pieza pendiente más reciente.
  const DIAS_ESTANCADA = 7;
  const masReciente = pendientes && pendientes.length > 0 ? pendientes.map((p) => p.creadoEn).sort().at(-1)! : null;
  const diasSinPiezas = masReciente ? Math.floor((Date.parse(`${hoyMx()}T00:00:00Z`) - Date.parse(`${masReciente.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null;

  return (
    <MarcoPagina titulo="Crecimiento" apoyo="Estudio de marketing: los insumos que subes y las piezas que esperan tu aprobación.">
      {diasSinPiezas !== null && diasSinPiezas >= DIAS_ESTANCADA ? (
        <Aviso tono="warn" titulo={`La pieza pendiente más reciente es de hace ${diasSinPiezas} días`}>
          No han llegado piezas nuevas a la bandeja. Puede ser que los agentes de contenido no estén entregando; la causa no se conoce desde aquí.
        </Aviso>
      ) : null}
      <AvisoCompacto
        tono="info"
        resumen="Entre más insumo le das, mejor salen las piezas. Ninguna se genera sola; publicar sigue siendo tu aprobación."
        mas="Sube el video que te gustó o la foto del chofer o del patio, y abajo lees el guion, el carrusel, la promo del día y los encargos de imagen y video. No hay render en el servidor."
      />

      <Tarjeta titulo={`Banco de hooks${hooks !== null ? ` (${hooks.length})` : ''}`}>
        <p className="adm-din-nota">Sube un video que te gustó y anota el hook que usa. No hay transcripción automática todavía: la anotación es tuya.</p>
        <SubirHook pedirFirma={accionPedirFirmaHook} guardar={accionGuardarHook} />
        {hooks === null ? (
          <EstadoError compacto>No se pudo leer el banco de hooks — esto NO significa que esté vacío.</EstadoError>
        ) : hooks.length === 0 ? (
          <p className="adm-din-nota">Sin hooks guardados todavía.</p>
        ) : (
          <div className="adm-din-rejilla">
            {hooks.map((h) => (
              <div key={h.id} className="adm-din-plan">
                {h.videoUrl ? <video src={h.videoUrl} controls className="adm-din-video" /> : <Aviso tono="error">No se pudo firmar la vista previa del video.</Aviso>}
                <p className="adm-din-nota">{h.hookTexto}</p>
                <span className="adm-din-sub">{fechaHoraMx(h.creadoEn)}</span>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo={`Personajes y lugares${referencias !== null ? ` (${referencias.length})` : ''}`}>
        <p className="adm-din-nota">El pipeline de video usa estas fotos tal cual y produce solo lo que falta.</p>
        <SubirReferencia accion={accionSubirReferencia} />
        {referencias === null ? (
          <EstadoError compacto>No se pudo leer el archivo de referencias — esto NO significa que esté vacío.</EstadoError>
        ) : referencias.length === 0 ? (
          <p className="adm-din-nota">Sin personajes ni lugares subidos todavía.</p>
        ) : (
          <div className="adm-din-rejilla">
            {referencias.map((r) => (
              <div key={r.id} className="adm-din-plan">
                {r.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- referencia interna del estudio, no next/image en el resto del repo
                  <img src={r.fotoUrl} alt={r.nombre} className="adm-din-miniatura" />
                ) : (
                  <Aviso tono="warn">Sin vista previa de la foto.</Aviso>
                )}
                <div className="adm-din-plan__cab"><span>{r.nombre}</span></div>
                <span className="adm-din-sub">{r.tipo}</span>
                <FormaConAviso
                  accion={accionBorrarReferencia} boton="Borrar" columnas="md:grid-cols-1"
                  confirmar={{ titulo: `Borrar «${r.nombre}»`, descripcion: 'Se borran la fila y la foto, y no se puede deshacer. Es la baja de quien dio su consentimiento para usar su imagen.', etiquetaConfirmar: 'Sí, borrar' }}
                >
                  <input type="hidden" name="referencia" value={r.id} />
                </FormaConAviso>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo={`Piezas del día${pendientes !== null ? ` (${pendientes.length})` : ''}`}>
        <p className="adm-din-nota">
          Lo que el agente de crecimiento ya redactó hacia la bandeja: guiones, carrusel del mercado, promo del día y encargos de imagen y video. Publicar es la misma
          aprobación de siempre, la que también ves en <a href="/admin/aprobaciones">Aprobaciones</a>.
        </p>
        {pendientes === null ? (
          <EstadoError compacto>No se pudieron leer las piezas del día — esto NO significa que no haya.</EstadoError>
        ) : pendientes.length === 0 ? (
          <p className="adm-din-nota">Nada pendiente ahora mismo. Las piezas llegan aquí cuando el reloj de crecimiento las redacta.</p>
        ) : (
          <div className="adm-din-rejilla">
            {pendientes.map((p) => <TarjetaPieza key={p.id} pieza={p} publicar={accionPublicarPieza} rechazar={accionRechazarPieza} />)}
          </div>
        )}
        {aprobadas !== null && aprobadas.length > 0 ? (
          <>
            <p className="adm-din-nota">Ya publicadas</p>
            <ul className="adm-din-lista">
              {aprobadas.map((p) => <li key={p.id}>{p.titulo} <span>{p.agente}</span></li>)}
            </ul>
          </>
        ) : null}
      </Tarjeta>

      <Disclosure titulo="Qué no hace el estudio todavía" resumen="Generación de imagen y video">
        <p className="adm-din-nota">
          La generación real de imagen y video sigue siendo un punto de extensión explícito, no algo activado aquí: el estudio entrega el insumo y la aprobación; el render vive en el flujo local del dueño.
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Estudio de marketing' };
