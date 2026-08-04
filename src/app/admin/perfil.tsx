import Link from 'next/link';

/**
 * Ya NO es un menú desplegable — pedido explícito del usuario: quitar el
 * popup, quitar los botones "Cerrar sesión"/"Mi perfil" de adentro de un
 * menú. El chip de avatar+nombre ahora es un link directo a
 * /admin/mi-perfil; "Cerrar sesión" vive aparte, como su propio botón
 * siempre visible más abajo en el sidebar (ver layout.tsx). Sin estado,
 * sin 'use client': es un Server Component otra vez.
 */
export default function PerfilMenu({ nombre, avatarUrl }: { nombre: string; avatarUrl?: string | null }) {
  return (
    <Link href="/admin/mi-perfil"
      className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full hairline hover:opacity-80 transition-opacity">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar de usuario, no next/image en el resto del repo
        <img src={avatarUrl} alt={nombre} className="w-7 h-7 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
          style={{ background: 'var(--marca)', color: 'white' }}>
          {nombre.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-sm font-medium hidden lg:inline">{nombre}</span>
    </Link>
  );
}
