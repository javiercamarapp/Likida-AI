import { revalidatePath } from 'next/cache';
import { Clapperboard, Film, UserSquare2, ListChecks } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { aprobarPieza, rechazarPieza } from '@/lib/likida/agentes/cola';
import {
  listarHooks, listarReferencias, piezasEstudioPendientes, piezasEstudioAprobadasRecientes,
  pedirUrlFirmadaHook, guardarHook, guardarReferencia, subirFotoReferencia, validarFotoReferencia,
  esTipoReferencia, type UrlFirmadaSubida,
} from '@/lib/likida/marketing/estudio';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio } from '../ui/kit';
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
      const ruta = await subirFotoReferencia(archivo, archivo.type);
      await guardarReferencia({ tipo, nombre, etiqueta, fotoRuta: ruta, actorId: s.userId });
      revalidatePath('/admin/marketing');
      return { ok: true };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'subir la referencia') };
    }
  }

  async function accionPublicarPieza(_previo: ResultadoPublicar, fd: FormData): Promise<ResultadoPublicar> {
    'use server';
    const s = await requireSuperadmin();
    try {
      await aprobarPieza(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/marketing');
      return { ok: 'Publicada — quedó aprobada en cola_aprobacion.' };
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

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Clapperboard width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Estudio de marketing"
        />
        <div className="px-5 py-5 flex-1 space-y-3">
          <div className="card p-4">
            <h1 className="text-base font-semibold tracking-tight">Entre más le das, más entienden</h1>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
              Sube lo que te sirve de insumo — el video que te gustó, la foto del chofer o del patio — y lo demás lo
              lees abajo: el guion, el carrusel, la promo del día, los encargos de imagen y video. Ninguno se genera
              solo (no hay pipeline de render en el servidor); publicar sigue siendo tu tap.
            </p>
          </div>

          {/* ── 1. BANCO DE HOOKS ────────────────────────────────────────── */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <Film width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>Banco de hooks</TituloSeccion>
              {hooks !== null && (
                <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                  {hooks.length}
                </span>
              )}
            </div>
            <p className="text-[12.5px] mt-1.5 mb-2.5" style={{ color: 'var(--muted)' }}>
              Sube un video que te gustó y anota el hook que usa. No hay transcripción automática todavía — la
              anotación es tuya (crecimiento.ts destila hooks de los artículos ya publicados mientras tanto).
            </p>
            <SubirHook pedirFirma={accionPedirFirmaHook} guardar={accionGuardarHook} />
            {hooks === null ? (
              <p className="text-[12.5px] mt-2.5" style={{ color: 'var(--bad)' }}>No se pudo leer el banco de hooks — esto NO significa que esté vacío.</p>
            ) : hooks.length === 0 ? (
              <p className="text-[12.5px] mt-2.5" style={{ color: 'var(--muted)' }}>Sin hooks guardados todavía.</p>
            ) : (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {hooks.map((h) => (
                  <div key={h.id} className="hairline rounded-lg p-2.5" style={{ background: 'var(--surface)' }}>
                    {h.videoUrl ? (
                      <video src={h.videoUrl} controls className="w-full rounded-md max-h-40" />
                    ) : (
                      <p className="text-[11.5px]" style={{ color: 'var(--bad)' }}>No se pudo firmar la vista previa del video.</p>
                    )}
                    <p className="text-[12px] mt-1.5 m-0 leading-relaxed">{h.hookTexto}</p>
                    <p className="text-[10.5px] mt-1 m-0" style={{ color: 'var(--faint)' }}>{fechaHoraMx(h.creadoEn)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 2. PERSONAJES Y LUGARES ──────────────────────────────────── */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <UserSquare2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>Personajes y lugares</TituloSeccion>
              {referencias !== null && (
                <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                  {referencias.length}
                </span>
              )}
            </div>
            <p className="text-[12.5px] mt-1.5 mb-2.5" style={{ color: 'var(--muted)' }}>
              El pipeline de video (MARCA.md §6: character sheets → lugares sheets → sequence sheets → animación) usa
              estas fotos tal cual y produce solo lo que falta.
            </p>
            <SubirReferencia accion={accionSubirReferencia} />
            {referencias === null ? (
              <p className="text-[12.5px] mt-2.5" style={{ color: 'var(--bad)' }}>No se pudo leer el archivo de referencias — esto NO significa que esté vacío.</p>
            ) : referencias.length === 0 ? (
              <p className="text-[12.5px] mt-2.5" style={{ color: 'var(--muted)' }}>Sin personajes ni lugares subidos todavía.</p>
            ) : (
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {referencias.map((r) => (
                  <div key={r.id} className="hairline rounded-lg p-2 text-center" style={{ background: 'var(--surface)' }}>
                    {r.fotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- referencia interna del estudio, no next/image en el resto del repo
                      <img src={r.fotoUrl} alt={r.nombre} className="w-full h-20 object-cover rounded-md" />
                    ) : (
                      <div className="w-full h-20 rounded-md flex items-center justify-center text-[10.5px]" style={{ background: 'var(--canvas)', color: 'var(--bad)' }}>
                        sin preview
                      </div>
                    )}
                    <p className="text-[11.5px] font-medium mt-1 m-0 truncate">{r.nombre}</p>
                    <p className="text-[10px] m-0" style={{ color: 'var(--faint)' }}>{r.tipo}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 3. PIEZAS DEL DÍA ────────────────────────────────────────── */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <ListChecks width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>Piezas del día</TituloSeccion>
              {pendientes !== null && (
                <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                  {pendientes.length}
                </span>
              )}
            </div>
            <p className="text-[12.5px] mt-1.5 mb-2.5" style={{ color: 'var(--muted)' }}>
              Lo que `crecimiento.ts` ya redactó hacia la cola de aprobación — guiones, carrusel del mercado, promo del
              día y los encargos de imagen/video. Publicar es la misma aprobación de siempre (`aprobarPieza`), la que
              también ves en <a href="/admin/aprobaciones" className="underline">Aprobaciones</a>.
            </p>
            {pendientes === null ? (
              <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>No se pudieron leer las piezas del día — esto NO significa que no haya.</p>
            ) : pendientes.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Nada pendiente ahora mismo. Las piezas llegan aquí solas cuando corre el reloj de crecimiento (cada 4 horas).
              </p>
            ) : (
              <div className="space-y-2.5">
                {pendientes.map((p) => (
                  <TarjetaPieza key={p.id} pieza={p} publicar={accionPublicarPieza} rechazar={accionRechazarPieza} />
                ))}
              </div>
            )}
            {aprobadas !== null && aprobadas.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line2)' }}>
                <p className="text-[11px] uppercase font-semibold tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>Ya publicadas</p>
                <div className="space-y-1">
                  {aprobadas.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-[12px] flex-wrap">
                      <span className="truncate">{p.titulo}</span>
                      <span className="shrink-0" style={{ color: 'var(--faint)' }}>{p.agente}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <EstadoVacio>
            La generación real de imagen y video (Higgsfield/Canva) sigue siendo un punto de extensión explícito, no
            algo activado aquí: el estudio entrega el insumo y la aprobación, el render vive en el flujo local de
            Javier hasta que se decida lo contrario.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
