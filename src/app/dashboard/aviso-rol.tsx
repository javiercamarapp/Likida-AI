'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Eye } from 'lucide-react';

const NOMBRE: Record<string, string> = {
  flota_admin: 'Dueño de la flota',
  encargado: 'Jefe de tráfico',
  contador: 'Contador',
};

/**
 * La cinta que avisa "estás viendo el panel con los ojos de otro rol".
 *
 * Sin esto, `?rol=encargado` es indistinguible de la sesión propia: el
 * superadmin vería media app y concluiría que faltan pantallas. Un modo que
 * cambia lo que ves y no se anuncia es un bug reportado por el usuario.
 *
 * Solo se pinta si el rol REAL es superadmin — para cualquier otro el
 * parámetro se ignora del lado del servidor (`rolEfectivo`), así que anunciar
 * algo aquí sería mentir sobre lo que está pasando.
 */
export default function AvisoRol({ rolReal }: { rolReal: string }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const rolVista = sp.get('rol');

  if (rolReal !== 'superadmin' || !rolVista || !NOMBRE[rolVista]) return null;

  // Salir conserva el tenant que estabas viendo y solo tira `?rol=`: perder
  // la flota al salir del modo te devolvería al tenant demo sin avisar.
  const restantes = new URLSearchParams(sp.toString());
  restantes.delete('rol');
  const qs = restantes.toString();

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2 rounded-xl mb-3 text-xs"
      style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}
    >
      <Eye width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
      <span style={{ color: 'var(--muted)' }}>
        Estás viendo el panel como <strong style={{ color: 'var(--ink)' }}>{NOMBRE[rolVista]}</strong>.
        Solo cambia lo que se te enseña, no lo que puedes hacer.
      </span>
      <Link
        href={`${pathname}${qs ? `?${qs}` : ''}`}
        className="ml-auto font-medium underline shrink-0"
        style={{ color: 'var(--ink)' }}
      >
        Salir
      </Link>
    </div>
  );
}
