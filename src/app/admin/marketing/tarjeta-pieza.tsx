'use client';

import { useActionState, useState } from 'react';
import { Check, X } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { Aviso, Boton, CampoTexto, Icono, StatusChip } from '../../ui-v2/componentes';
// Del módulo PURO (`piezas.ts`), no de `estudio.ts` — ese último importa `supabaseAdmin` y, con él, built-ins de Node que el bundle del
// navegador no puede resolver (ver la cabecera de `piezas.ts`).
import { partirCopyPorCanal, type PiezaEstudio } from '@/lib/likida/marketing/piezas';

export type ResultadoPublicar = { ok?: string; error?: string } | null;
export type AccionPublicar = (previo: ResultadoPublicar, fd: FormData) => Promise<ResultadoPublicar>;

const ETIQUETA_TIPO: Record<string, string> = {
  guion_video: 'Guion de video',
  carrusel_noticias: 'Carrusel del mercado',
  promo_diaria: 'Promo del día',
  encargo_visual: 'Encargo visual',
  encargo_video_demo: 'Encargo de video demo',
  encargo_video_marketing: 'Encargo de reel',
};

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
        <StatusChip tono="neutral">{ETIQUETA_TIPO[pieza.tipo] ?? pieza.tipo}</StatusChip>
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
        {rechazando ? <CampoTexto etiqueta="Motivo del rechazo" name="motivo" placeholder="Motivo del rechazo (obligatorio)" obligatorio /> : null}
        <div className="adm-din-acciones">
          {!rechazando ? (
            <Boton type="submit" name="operacion" value="publicar" variante="primary" tamano="sm" disabled={pendiente} icono={<Icono icono={Check} tam={14} />}>Publicar</Boton>
          ) : null}
          {rechazando ? (
            <>
              <Boton type="submit" name="operacion" value="rechazar" variante="danger" tamano="sm" disabled={pendiente} icono={<Icono icono={X} tam={14} />}>Rechazar</Boton>
              <Boton variante="secondary" tamano="sm" onClick={() => setRechazando(false)}>Cancelar</Boton>
            </>
          ) : (
            <Boton variante="secondary" tamano="sm" onClick={() => setRechazando(true)} icono={<Icono icono={X} tam={14} />}>Rechazar…</Boton>
          )}
        </div>
      </form>
      <p className="adm-din-nota">
        Publicar aquí es tu aprobación en la bandeja; postearlo en el canal sigue siendo tu tap fuera de Likida: no hay integración de redes sociales todavía.
      </p>
    </div>
  );
}
