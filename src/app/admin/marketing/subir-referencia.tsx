'use client';

import { useActionState } from 'react';
import { UserSquare2 } from 'lucide-react';

export type ResultadoReferencia = { ok: true } | { error: string } | null;

/**
 * Personajes y lugares: FormData directo a través de un Server Action —
 * mismo patrón que `avatar-uploader.tsx` (la foto cabe cómodo bajo el
 * límite de payload de la función; no necesita URL firmada como el video).
 */
export function SubirReferencia({ accion }: { accion: (previo: ResultadoReferencia, fd: FormData) => Promise<ResultadoReferencia> }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoReferencia, FormData>(accion, null);

  return (
    <form action={enviar} className="hairline rounded-lg p-3 space-y-2.5" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2">
        <UserSquare2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <span className="text-[13px] font-medium">Subir personaje o lugar</span>
      </div>
      <div className="flex gap-2">
        <select name="tipo" defaultValue="personaje" disabled={pendiente}
          className="text-[12.5px] px-2 py-1.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }}>
          <option value="personaje">Personaje</option>
          <option value="lugar">Lugar</option>
        </select>
        <input name="nombre" placeholder="Nombre (ej. «Chofer Ramón», «Patio norte»)" required disabled={pendiente}
          className="flex-1 text-[12.5px] px-3 py-1.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }} />
      </div>
      <input name="etiqueta" placeholder="Etiqueta libre — opcional (edad, vestuario, hora del día…)" disabled={pendiente}
        className="w-full text-[12.5px] px-3 py-1.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }} />
      <input type="file" name="foto" accept="image/jpeg,image/png,image/webp" required disabled={pendiente}
        className="text-[12.5px] w-full" />
      {estado && 'error' in estado && <p className="text-[12px] m-0" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
      {estado && 'ok' in estado && <p className="text-[12px] m-0" style={{ color: 'var(--ok)' }}>Guardado.</p>}
      <button type="submit" disabled={pendiente}
        className="text-[12.5px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
        style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
        {pendiente ? 'Subiendo…' : 'Subir'}
      </button>
    </form>
  );
}
