'use client';

import { useRef, useState } from 'react';
import { Boton, Monograma } from '@/app/ui-v2/componentes';

/**
 * `accion` es un Server Action de verdad (`'use server'` adentro, definido en page.tsx) — SÍ se puede pasar de un Server Component a un
 * Client Component como prop. Elegir la foto envía el form de inmediato: la vista previa local YA es la confirmación visual de qué se subió.
 */
export default function AvatarUploader({
  nombre, avatarUrl, accion,
}: { nombre: string; avatarUrl: string | null; accion: (formData: FormData) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setPreview(URL.createObjectURL(archivo));
    formRef.current?.requestSubmit();
  }

  const mostrar = preview ?? avatarUrl;

  return (
    <form ref={formRef} action={accion} className="adm-perfil-avatar">
      {mostrar ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar de usuario, no next/image en el resto del repo
        <img src={mostrar} alt={nombre} className="adm-perfil-avatar__img" />
      ) : (
        <Monograma id={nombre} nombre={nombre} tamano={40} />
      )}
      <div className="adm-perfil-avatar__texto">
        <strong>{nombre}</strong>
        <Boton tamano="sm" variante="secondary" onClick={() => inputRef.current?.click()}>Cambiar foto</Boton>
      </div>
      <input ref={inputRef} type="file" name="avatar" accept="image/jpeg,image/png,image/webp" hidden onChange={onChange} />
    </form>
  );
}
