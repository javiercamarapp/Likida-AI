'use client';

import { useRef, useState } from 'react';
import { useActionState } from 'react';
import { FileText, Image as ImageIcon, Video, Link2, MessageSquare, UploadCloud } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { StatusPill } from '../../../ui/kit';
import { Aviso, type AccionDeForma, type ResultadoAccion } from '../../../ui/forma';
// De `insumos_tipos.ts`, NUNCA de `insumos.ts`: ese módulo importa
// `supabaseAdmin` (usa `node:async_hooks`), y este archivo es 'use client' —
// importar un VALOR desde ahí arrastra ese módulo entero al bundle del
// navegador y revienta el build ("UnhandledSchemeError: node:async_hooks").
import { TIPOS_ARCHIVO as TIPOS_ARCHIVO_LISTA, type InsumoAgente, type TipoInsumo } from '@/lib/likida/agentes/insumos_tipos';

const ICONO_TIPO: Record<TipoInsumo, React.ReactNode> = {
  documento: <FileText width={15} height={15} strokeWidth={1.75} />,
  imagen: <ImageIcon width={15} height={15} strokeWidth={1.75} />,
  video: <Video width={15} height={15} strokeWidth={1.75} />,
  link: <Link2 width={15} height={15} strokeWidth={1.75} />,
  texto: <MessageSquare width={15} height={15} strokeWidth={1.75} />,
};

const ROTULO_TIPO: Record<TipoInsumo, string> = {
  documento: 'Documento', imagen: 'Imagen', video: 'Video', link: 'Link', texto: 'Idea (texto libre)',
};

const ACEPTA_POR_TIPO: Record<'documento' | 'imagen' | 'video', string> = {
  documento: '.pdf,.csv,.xls,.xlsx,.doc,.docx',
  imagen: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/quicktime,video/webm',
};

const TIPOS_ARCHIVO = new Set<TipoInsumo>(TIPOS_ARCHIVO_LISTA);

/**
 * El formulario de la zona de arrastrar-y-soltar — tipificado a lo que ESTE
 * agente acepta (`tiposAceptados`, resuelto en el servidor por
 * `tiposAceptadosPorAgente`). Un tipo de archivo (documento/imagen/video)
 * dispara el sub-formulario de Storage; link/texto disparan el de
 * contenido en la propia fila. Nunca los dos formularios envían a la vez:
 * uno solo está montado según el tipo elegido.
 */
export function FormularioInsumo({
  tiposAceptados, accionArchivo, accionTexto,
}: {
  tiposAceptados: TipoInsumo[];
  accionArchivo: AccionDeForma;
  accionTexto: AccionDeForma;
}) {
  const [tipo, setTipo] = useState<TipoInsumo>(tiposAceptados[0] ?? 'texto');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de insumo">
        {tiposAceptados.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tipo === t}
            onClick={() => setTipo(t)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full hairline transition-opacity"
            style={tipo === t
              ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
              : { background: 'var(--canvas)', color: 'var(--muted)' }}
          >
            {ICONO_TIPO[t]}
            {ROTULO_TIPO[t]}
          </button>
        ))}
      </div>

      {TIPOS_ARCHIVO.has(tipo)
        ? <FormaArchivo key={tipo} tipo={tipo as 'documento' | 'imagen' | 'video'} accion={accionArchivo} />
        : <FormaTexto key={tipo} tipo={tipo as 'link' | 'texto'} accion={accionTexto} />}
    </div>
  );
}

function FormaArchivo({ tipo, accion }: { tipo: 'documento' | 'imagen' | 'video'; accion: AccionDeForma }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  function tomarArchivo(archivo: File | undefined) {
    if (!archivo || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(archivo);
    inputRef.current.files = dt.files;
    setNombreArchivo(archivo.name);
  }

  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="tipo" value={tipo} />
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          tomarArchivo(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-colors"
        style={{ borderColor: arrastrando ? 'var(--marca)' : 'var(--line2)', background: arrastrando ? 'var(--canvas)' : 'transparent' }}
      >
        <UploadCloud width={22} height={22} strokeWidth={1.5} style={{ color: 'var(--muted)' }} />
        <p className="text-sm text-center px-4">
          {nombreArchivo ?? <>Arrastra un {ROTULO_TIPO[tipo].toLowerCase()} aquí, o haz click para elegirlo</>}
        </p>
        <input
          ref={inputRef}
          type="file"
          name="archivo"
          accept={ACEPTA_POR_TIPO[tipo]}
          className="hidden"
          onChange={(e) => setNombreArchivo(e.target.files?.[0]?.name ?? null)}
        />
      </div>
      <input name="titulo" required placeholder="Título del insumo — qué es esto para el agente"
        className="w-full text-sm rounded-lg px-2.5 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }} />
      <Aviso estado={estado} />
      <button type="submit" disabled={pendiente}
        className="text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
        {pendiente ? 'Subiendo…' : 'Agregar insumo'}
      </button>
    </form>
  );
}

function FormaTexto({ tipo, accion }: { tipo: 'link' | 'texto'; accion: AccionDeForma }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="tipo" value={tipo} />
      <input name="titulo" required placeholder="Título del insumo"
        className="w-full text-sm rounded-lg px-2.5 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }} />
      {tipo === 'link' ? (
        <input name="contenido" required type="url" placeholder="https://…"
          className="w-full text-sm rounded-lg px-2.5 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }} />
      ) : (
        <textarea name="contenido" required rows={4} placeholder="La idea, en tus palabras — el agente la lee en su siguiente corrida"
          className="w-full text-sm rounded-lg px-2.5 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }} />
      )}
      <Aviso estado={estado} />
      <button type="submit" disabled={pendiente}
        className="text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
        {pendiente ? 'Guardando…' : 'Agregar insumo'}
      </button>
    </form>
  );
}

/** "Qué le has dado, qué usó, qué aprendió de eso" — la frase del plan,
 *  literal. `Procesado` con su resumen cuando el agente ya lo consumió;
 *  `Pendiente` mientras espera la siguiente corrida. */
export function ListaInsumos({ insumos }: { insumos: Array<InsumoAgente & { url: string | null }> }) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--line2)' }}>
      {insumos.map((i) => (
        <li key={i.id} className="px-4 py-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span style={{ color: 'var(--muted)' }}>{ICONO_TIPO[i.tipo]}</span>
              <span className="text-sm font-medium truncate">{i.titulo}</span>
              {i.url && (
                <a href={i.url} target="_blank" rel="noreferrer" className="text-xs shrink-0 hover:underline" style={{ color: 'var(--marca)' }}>
                  ver
                </a>
              )}
            </div>
            <StatusPill estado={i.procesadoEn ? 'ok' : 'neutral'}>
              {i.procesadoEn ? 'Procesado' : 'Pendiente'}
            </StatusPill>
          </div>
          <div className="text-xs" style={{ color: 'var(--faint)' }}>
            Subido {fechaHoraMx(i.subidoEn)}
            {i.tipo === 'link' && i.contenidoTexto && <> · <a href={i.contenidoTexto} target="_blank" rel="noreferrer" className="hover:underline">{i.contenidoTexto}</a></>}
            {i.tipo === 'texto' && i.contenidoTexto && <> · {i.contenidoTexto.slice(0, 140)}{i.contenidoTexto.length > 140 ? '…' : ''}</>}
          </div>
          {i.resumenUso && (
            <div className="text-xs rounded-lg px-2.5 py-1.5 mt-0.5" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
              Qué usó el agente: {i.resumenUso}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
