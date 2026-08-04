'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';

/**
 * `accion` es un Server Action de verdad (`'use server'` adentro, definido
 * en page.tsx) — SÍ se puede pasar de un Server Component a un Client
 * Component como prop (a diferencia de una función normal: eso es lo que
 * revienta el build con "Functions cannot be passed directly to Client
 * Components", el bug que ya salió esta sesión con `formato`/`icono` en
 * la librería de gráficas). Elegir la foto envía el form de inmediato —
 * sin botón "Guardar foto" aparte, la vista previa local YA es la
 * confirmación visual de qué se subió.
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
    <form ref={formRef} action={accion} className="flex items-center gap-4">
      <button type="button" onClick={() => inputRef.current?.click()}
        className="relative w-16 h-16 rounded-full shrink-0 group" aria-label="Cambiar foto de perfil">
        {mostrar ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar de usuario, no next/image en el resto del repo
          <img src={mostrar} alt={nombre} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <span className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold"
            style={{ background: 'var(--marca)', color: 'white' }}>
            {nombre.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.45)' }}>
          <Camera width={18} height={18} style={{ color: 'white' }} />
        </span>
      </button>
      <div>
        <div className="text-sm font-medium">{nombre}</div>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="text-xs mt-0.5 font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>
          Cambiar foto
        </button>
      </div>
      <input ref={inputRef} type="file" name="avatar" accept="image/*" className="hidden" onChange={onChange} />
    </form>
  );
}
