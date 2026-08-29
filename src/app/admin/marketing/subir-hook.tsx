'use client';

import { useRef, useState, useTransition } from 'react';
import { Film, UploadCloud } from 'lucide-react';
import { subirConUrlFirmada } from '@/lib/supabase/browser-storage';

export type ResultadoFirmaHook =
  | { ok: true; bucket: string; path: string; token: string }
  | { ok: false; error: string };
export type ResultadoGuardar = { ok: true } | { ok: false; error: string };

/**
 * El banco de hooks: sube el VIDEO directo a Storage (el servidor solo firma
 * la ruta, nunca ve los bytes — ver el porqué en `lib/likida/marketing/
 * estudio.ts`) y, cuando la subida termina, guarda el hook que Javier anotó.
 * Tres pasos, un solo botón: pedir la firma → subir → guardar la fila.
 */
export function SubirHook({
  pedirFirma, guardar,
}: {
  pedirFirma: (mime: string) => Promise<ResultadoFirmaHook>;
  guardar: (videoRuta: string, hookTexto: string) => Promise<ResultadoGuardar>;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [hookTexto, setHookTexto] = useState('');
  const [estado, setEstado] = useState<{ fase: 'idle' | 'subiendo' | 'ok' | 'error'; mensaje?: string }>({ fase: 'idle' });
  const [pendiente, empezar] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setArchivo(f);
    setEstado({ fase: 'idle' });
  }

  function enviar() {
    if (!archivo) { setEstado({ fase: 'error', mensaje: 'Elige un video primero.' }); return; }
    if (!hookTexto.trim()) { setEstado({ fase: 'error', mensaje: 'Anota qué hook usa el video.' }); return; }
    const elArchivo = archivo;
    const elHook = hookTexto;
    empezar(async () => {
      setEstado({ fase: 'subiendo' });
      try {
        const firma = await pedirFirma(elArchivo.type);
        if (!firma.ok) { setEstado({ fase: 'error', mensaje: firma.error }); return; }
        await subirConUrlFirmada(firma.bucket, firma.path, firma.token, elArchivo);
        const guardado = await guardar(firma.path, elHook);
        if (!guardado.ok) { setEstado({ fase: 'error', mensaje: guardado.error }); return; }
        setEstado({ fase: 'ok' });
        setArchivo(null);
        setHookTexto('');
        if (inputRef.current) inputRef.current.value = '';
      } catch (e) {
        setEstado({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo subir el video.' });
      }
    });
  }

  return (
    <div className="hairline rounded-lg p-3 space-y-2.5" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2">
        <Film width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <span className="text-[13px] font-medium">Subir un video de referencia</span>
      </div>
      <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
        onChange={elegirArchivo} disabled={pendiente}
        className="text-[12.5px] w-full" />
      <textarea value={hookTexto} onChange={(e) => setHookTexto(e.target.value)} disabled={pendiente}
        placeholder="¿Qué hook usa este video? (ej. «la pregunta llega igual en todas las flotas…»)"
        rows={2} className="w-full text-[12.5px] leading-relaxed px-3 py-2 rounded-lg hairline"
        style={{ background: 'var(--canvas)' }} />
      {estado.fase === 'error' && <p className="text-[12px] m-0" style={{ color: 'var(--bad)' }}>{estado.mensaje}</p>}
      {estado.fase === 'ok' && <p className="text-[12px] m-0" style={{ color: 'var(--ok)' }}>Hook guardado.</p>}
      <button type="button" onClick={enviar} disabled={pendiente || !archivo}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
        style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
        <UploadCloud width={13} height={13} strokeWidth={2} />
        {estado.fase === 'subiendo' ? 'Subiendo…' : 'Subir y guardar hook'}
      </button>
    </div>
  );
}
