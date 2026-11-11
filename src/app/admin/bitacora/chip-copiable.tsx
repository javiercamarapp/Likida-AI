'use client';

import { useState } from 'react';

/**
 * Id-chip de Rovaq (P7): texto en mono dentro de una caja de 28 px y radio 8, con «Copiar». El texto que se copia es el MISMO que se ve:
 * aquí nunca va un correo ni un identificador de persona (la Bitácora no los muestra), solo el número de registro o el nombre del actor.
 */
export function ChipCopiable({ texto, copiar, copiado, mono = true }: { texto: string; copiar: string; copiado: string; mono?: boolean }) {
  const [hecho, setHecho] = useState(false);
  const alCopiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setHecho(true);
      setTimeout(() => setHecho(false), 1500);
    } catch { /* sin portapapeles (contexto no seguro o permiso negado): el chip sigue siendo legible y seleccionable */ }
  };
  return (
    <span className="adm-bit-chip" data-mono={mono || undefined}>
      <span className="adm-bit-chip__texto">{texto}</span>
      <button type="button" className="adm-bit-chip__copiar" onClick={alCopiar} aria-label={`${copiar}: ${texto}`}>{hecho ? copiado : copiar}</button>
    </span>
  );
}
