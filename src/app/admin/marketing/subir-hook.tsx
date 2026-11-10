'use client';

import { useRef, useState, useTransition } from 'react';
import { UploadCloud } from 'lucide-react';
import { Aviso, Boton, CampoArchivo, CampoTextarea, Icono } from '../../ui-v2/componentes';
import { subirConUrlFirmada } from '@/lib/supabase/browser-storage';

export type ResultadoFirmaHook =
  | { ok: true; bucket: string; path: string; token: string }
  | { ok: false; error: string };
export type ResultadoGuardar = { ok: true } | { ok: false; error: string };

/**
 * El banco de hooks: sube el VIDEO directo a Storage (el servidor solo firma la ruta, nunca ve los bytes — ver el porqué en
 * `lib/likida/marketing/estudio.ts`) y, cuando la subida termina, guarda el hook que el dueño anotó. Tres pasos, un solo botón: pedir la
 * firma → subir → guardar la fila.
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
    <div className="adm-din-forma">
      <CampoArchivo etiqueta="Video de referencia" entradaRef={inputRef} accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
        nombreArchivo={archivo?.name ?? null} onChange={elegirArchivo} disabled={pendiente} />
      <CampoTextarea etiqueta="Hook que usa el video" value={hookTexto} onChange={(e) => setHookTexto(e.target.value)} disabled={pendiente}
        placeholder="¿Qué hook usa este video? (ej. «la pregunta llega igual en todas las flotas…»)" rows={2} />
      {estado.fase === 'error' ? <Aviso tono="error">{estado.mensaje}</Aviso> : null}
      {estado.fase === 'ok' ? <Aviso tono="ok">Hook guardado.</Aviso> : null}
      <div>
        <Boton variante="primary" tamano="sm" onClick={enviar} disabled={pendiente || !archivo} loading={estado.fase === 'subiendo'} icono={<Icono icono={UploadCloud} tam={14} />}>
          {estado.fase === 'subiendo' ? 'Subiendo…' : 'Subir y guardar hook'}
        </Boton>
      </div>
    </div>
  );
}
