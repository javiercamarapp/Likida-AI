'use client';

import { useRef, useState } from 'react';
import { Boton, Monograma } from '@/app/ui-v2/componentes';

const TIPOS_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * `accion` es un Server Action de verdad (`'use server'` adentro, definido en page.tsx) — SÍ se puede pasar de un Server Component a un
 * Client Component como prop. Elegir la foto envía el form de inmediato: la vista previa local YA es la confirmación visual de qué se subió.
 */
export default function AvatarUploader({
  nombre, avatarUrl, accion,
}: { nombre: string; avatarUrl: string | null; accion: (formData: FormData) => void }) {
  // Sin vista previa local: la imagen que se pinta es SIEMPRE la que ya guardó el servidor (`avatarUrl`), nunca una URL
  // derivada del archivo que el usuario eligió (CodeQL js/xss-through-dom). Elegir la foto envía el form; al revalidar,
  // la página trae la foto nueva. Mientras tanto se dice «Subiendo…».
  const [subiendo, setSubiendo] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo || !TIPOS_PERMITIDOS.has(archivo.type)) return;
    setSubiendo(true);
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={async (fd) => { try { await accion(fd); } finally { setSubiendo(false); } }} className="adm-perfil-avatar">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar de usuario, no next/image en el resto del repo
        <img src={avatarUrl} alt={nombre} className="adm-perfil-avatar__img" />
      ) : (
        <Monograma id={nombre} nombre={nombre} tamano={40} />
      )}
      <div className="adm-perfil-avatar__texto">
        <strong>{nombre}</strong>
        <Boton tamano="sm" variante="secondary" onClick={() => inputRef.current?.click()} disabled={subiendo}>
          {subiendo ? 'Subiendo…' : 'Cambiar foto'}
        </Boton>
      </div>
      <input ref={inputRef} type="file" name="avatar" accept="image/jpeg,image/png,image/webp" hidden onChange={onChange} />
    </form>
  );
}
