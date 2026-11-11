'use client';

import { useRef, useState } from 'react';
import { useActionState } from 'react';
import { FileText, Image as ImageIcon, Video, Link2, MessageSquare, UploadCloud } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { Aviso as AvisoLinea, Boton, CampoTexto, CampoTextarea, SegmentedControl, StatusChip } from '../../../../ui-v2/componentes';
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
      <SegmentedControl
        etiqueta="Tipo de insumo"
        valor={tipo}
        onChange={setTipo}
        opciones={tiposAceptados.map((t) => ({ valor: t, etiqueta: ROTULO_TIPO[t] }))}
      />

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
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border py-8 transition-colors ${arrastrando ? 'border-[var(--marca)] bg-[var(--canvas)]' : 'border-[var(--line2)] bg-transparent'}`}
      >
        <UploadCloud width={22} height={22} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
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
      <CampoTexto name="titulo" required obligatorio etiqueta="Título del insumo — qué es esto para el agente" />
      <Aviso estado={estado} />
      <Boton type="submit" variante="primary" loading={pendiente}>
        {pendiente ? 'Subiendo…' : 'Agregar insumo'}
      </Boton>
    </form>
  );
}

function FormaTexto({ tipo, accion }: { tipo: 'link' | 'texto'; accion: AccionDeForma }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="tipo" value={tipo} />
      <CampoTexto name="titulo" required obligatorio etiqueta="Título del insumo" />
      {tipo === 'link' ? (
        <CampoTexto name="contenido" required obligatorio tipo="url" etiqueta="Dirección del link" placeholder="https://…" />
      ) : (
        <CampoTextarea name="contenido" required obligatorio rows={4} etiqueta="La idea, en tus palabras — el agente la lee en su siguiente corrida" />
      )}
      <Aviso estado={estado} />
      <Boton type="submit" variante="primary" loading={pendiente}>
        {pendiente ? 'Guardando…' : 'Agregar insumo'}
      </Boton>
    </form>
  );
}

/** "Qué le has dado, qué usó, qué aprendió de eso" — la frase del plan,
 *  literal. `Procesado` con su resumen cuando el agente ya lo consumió;
 *  `Pendiente` mientras espera la siguiente corrida. */
export function ListaInsumos({ insumos }: { insumos: Array<InsumoAgente & { url: string | null }> }) {
  return (
    <ul className="m-0 list-none divide-y divide-[var(--line2)] p-0">
      {insumos.map((i) => (
        <li key={i.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-muted">{ICONO_TIPO[i.tipo]}</span>
              <span className="truncate text-sm font-medium">{i.titulo}</span>
              {i.url && (
                <a href={i.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-[var(--marca)] hover:underline">
                  ver
                </a>
              )}
            </div>
            <StatusChip tono={i.procesadoEn ? 'ok' : 'neutral'}>
              {i.procesadoEn ? 'Procesado' : 'Pendiente'}
            </StatusChip>
          </div>
          <div className="text-xs text-muted">
            Subido {fechaHoraMx(i.subidoEn)}
            {i.tipo === 'link' && i.contenidoTexto && <> · <a href={i.contenidoTexto} target="_blank" rel="noreferrer" className="hover:underline">{i.contenidoTexto}</a></>}
            {i.tipo === 'texto' && i.contenidoTexto && <> · {i.contenidoTexto.slice(0, 140)}{i.contenidoTexto.length > 140 ? '…' : ''}</>}
          </div>
          {i.resumenUso && (
            <AvisoLinea tono="ok">Qué usó el agente: {i.resumenUso}</AvisoLinea>
          )}
        </li>
      ))}
    </ul>
  );
}
