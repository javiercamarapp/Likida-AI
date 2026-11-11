'use client';

import { useRef } from 'react';

/**
 * Fecha del filtro de la Bitácora como texto AAAA-MM-DD. El `<input type="date">` nativo pinta su plantilla según el idioma del NAVEGADOR
 * («mm/dd/yyyy» en un Chrome en inglés), no según el de la página: aquí la plantilla es la nuestra, igual en cualquier navegador.
 * Envía la forma al salir del campo o con Intro, solo con una fecha completa y válida (o vacía, que quita el filtro).
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function valida(v: string): boolean {
  if (v === '') return true;
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function FiltroFechaIso({ nombre, etiqueta, valor, plantilla }: { nombre: string; etiqueta: string; valor?: string | null; plantilla: string }) {
  const ultimo = useRef(valor ?? '');
  const enviar = (el: HTMLInputElement) => {
    if (el.value !== ultimo.current && valida(el.value)) { ultimo.current = el.value; el.form?.requestSubmit(); }
  };
  return (
    <label className="rv-fl rv-fl--fecha" data-activo={valor ? '' : undefined}>
      <span className="rv-fl__etq">{etiqueta}</span>
      <input
        type="text" inputMode="numeric" name={nombre} defaultValue={valor ?? ''} placeholder={plantilla} maxLength={10} autoComplete="off"
        pattern="\d{4}-\d{2}-\d{2}" className="border-0 bg-transparent" data-anillo="envolvente" style={{ width: '7.6rem' }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(e.currentTarget); } }}
        onBlur={(e) => enviar(e.currentTarget)}
      />
    </label>
  );
}
