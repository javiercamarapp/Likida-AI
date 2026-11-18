'use client';

import { useActionState, useState } from 'react';
import { Check, X } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { Aviso, Boton, CampoTexto, Icono, StatusChip } from '../../ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { admin_dinero } from '@/lib/i18n/es/admin_dinero';
// Del módulo PURO (`piezas.ts`), no de `estudio.ts` — ese último importa `supabaseAdmin` y, con él, built-ins de Node que el bundle del
// navegador no puede resolver (ver la cabecera de `piezas.ts`).
import { partirCopyPorCanal, type PiezaEstudio } from '@/lib/likida/marketing/piezas';

export type ResultadoPublicar = { ok?: string; error?: string } | null;
export type AccionPublicar = (previo: ResultadoPublicar, fd: FormData) => Promise<ResultadoPublicar>;

const CLAVE_TIPO = {
  guion_video: 'neg5.mk_t_guion',
  carrusel_noticias: 'neg5.mk_t_carrusel',
  promo_diaria: 'neg5.mk_t_promo',
  encargo_visual: 'neg5.mk_t_encargo_visual',
  encargo_video_demo: 'neg5.mk_t_encargo_demo',
  encargo_video_marketing: 'neg5.mk_t_encargo_reel',
} as const;

/**
 * UNA pieza del estudio como tarjeta: el copy por canal cuando el agente lo marcó así (`promos_diarias`), el cuerpo completo cuando no (un
 * guion o un encargo no son "copy por canal" — partirCopyPorCanal() devuelve `null` y aquí se respeta, no se inventa una estructura).
 * Publicar = `aprobarPieza` de `agentes/cola.ts`, el MISMO mecanismo que usa /admin/aprobaciones — no hay un segundo camino de publicación.
 */
export function TarjetaPieza({ pieza, publicar, rechazar }: {
  pieza: PiezaEstudio;
  publicar: AccionPublicar;
  rechazar: AccionPublicar;
}) {
  const { t } = useT('admin_dinero', admin_dinero);
  const [estado, enviar, pendiente] = useActionState<ResultadoPublicar, FormData>(
    async (previo, fd) => (String(fd.get('operacion')) === 'rechazar' ? rechazar(previo, fd) : publicar(previo, fd)),
    null,
  );
  const [rechazando, setRechazando] = useState(false);
  const bloques = partirCopyPorCanal(pieza.cuerpo);

  if (estado?.ok) return <Aviso tono="ok">{estado.ok}</Aviso>;

  return (
    <div className="adm-din-plan">
      <div className="adm-din-plan__cab">
        <span>{pieza.titulo}</span>
        <StatusChip tono="neutral">{pieza.tipo in CLAVE_TIPO ? t(CLAVE_TIPO[pieza.tipo as keyof typeof CLAVE_TIPO]) : pieza.tipo}</StatusChip>
      </div>
      <span className="adm-din-sub">{pieza.agente} · {fechaHoraMx(pieza.creadoEn)}</span>

      {bloques === null ? (
        <pre className="adm-din-pre">{pieza.cuerpo}</pre>
      ) : (
        bloques.map((b) => (
          <div key={b.canal} className="adm-din-bloque">
            <b>{b.canal}</b>
            <p>{b.texto}</p>
          </div>
        ))
      )}

      {estado?.error ? <Aviso tono="error">{estado.error}</Aviso> : null}

      <form action={enviar} className="adm-din-forma">
        <input type="hidden" name="pieza" value={pieza.id} />
        {rechazando ? <CampoTexto etiqueta={t('neg5.mk_motivo_etq')} name="motivo" placeholder={t('neg5.mk_motivo_ph')} obligatorio /> : null}
        <div className="adm-din-acciones">
          {!rechazando ? (
            <Boton type="submit" name="operacion" value="publicar" variante="primary" tamano="sm" disabled={pendiente} icono={<Icono icono={Check} tam={14} />}>{t('neg5.mk_publicar')}</Boton>
          ) : null}
          {rechazando ? (
            <>
              <Boton type="submit" name="operacion" value="rechazar" variante="danger" tamano="sm" disabled={pendiente} icono={<Icono icono={X} tam={14} />}>{t('neg5.mk_rechazar')}</Boton>
              <Boton variante="secondary" tamano="sm" onClick={() => setRechazando(false)}>{t('neg5.mk_cancelar')}</Boton>
            </>
          ) : (
            <Boton variante="secondary" tamano="sm" onClick={() => setRechazando(true)} icono={<Icono icono={X} tam={14} />}>{t('neg5.mk_rechazar_puntos')}</Boton>
          )}
        </div>
      </form>
      <p className="adm-din-nota">
        {t('neg5.mk_nota_publicar')}
      </p>
    </div>
  );
}
