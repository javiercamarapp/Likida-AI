'use client';

import { useActionState } from 'react';
import { Aviso, Boton, CampoArchivo, CampoSelect, CampoTexto, Casilla } from '../../ui-v2/componentes';

export type ResultadoReferencia = { ok: true } | { error: string } | null;

/**
 * Personajes y lugares: FormData directo a través de un Server Action — mismo patrón que `avatar-uploader.tsx` (la foto cabe cómodo bajo el
 * límite de payload de la función; no necesita URL firmada como el video).
 */
export function SubirReferencia({ accion }: { accion: (previo: ResultadoReferencia, fd: FormData) => Promise<ResultadoReferencia> }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoReferencia, FormData>(accion, null);

  return (
    <form action={enviar} className="adm-din-forma">
      <CampoSelect etiqueta="Qué es" name="tipo" defaultValue="personaje" disabled={pendiente}>
        <option value="personaje">Personaje</option>
        <option value="lugar">Lugar</option>
      </CampoSelect>
      <CampoTexto etiqueta="Nombre" name="nombre" placeholder="Ej. «Chofer Ramón», «Patio norte»" obligatorio disabled={pendiente} />
      <CampoTexto etiqueta="Etiqueta libre (opcional)" name="etiqueta" placeholder="Edad, vestuario, hora del día…" disabled={pendiente} />
      <CampoArchivo etiqueta="Foto de referencia" name="foto" accept="image/jpeg,image/png,image/webp" obligatorio disabled={pendiente} />
      <Casilla
        name="consentimiento" disabled={pendiente}
        etiqueta="Consentimiento del personaje"
        ayuda="Si es un personaje (una persona real, p. ej. un chofer): confirmo que dio su consentimiento para usar su imagen en material publicitario y que puede pedir su baja (se borra desde su tarjeta)."
      />
      {estado && 'error' in estado ? <Aviso tono="error">{estado.error}</Aviso> : null}
      {estado && 'ok' in estado ? <Aviso tono="ok">Guardado.</Aviso> : null}
      <div>
        <Boton type="submit" variante="primary" tamano="sm" loading={pendiente}>{pendiente ? 'Subiendo…' : 'Subir'}</Boton>
      </div>
    </form>
  );
}
