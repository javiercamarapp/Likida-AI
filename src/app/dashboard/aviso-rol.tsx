'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Eye, ArrowLeft } from 'lucide-react';

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
 *
 * ── TAMBIÉN SE PINTA SIN `?rol=`, Y ESA ES LA MITAD QUE FALTABA ───────────
 *
 * `/dashboard?vista=demo` (el link de siempre del sidebar de /admin) no lleva
 * `?rol=`, así que la cinta no salía. Y la insignia del sidebar se esconde a
 * propósito para superadmin —decía SUPERADMIN encima del panel del cliente—,
 * de modo que en esa vista NADA en pantalla decía dónde estabas parado: el
 * panel del cliente, con el nombre y el saludo del dueño, servido a la sesión
 * de Javier. Previsualizar sin `?rol=` sigue siendo previsualizar.
 *
 * ── Y LLEVA LA PUERTA DE SALIDA ──────────────────────────────────────────
 *
 * /dashboard no tenía un solo link de vuelta a /admin: el sidebar es el del
 * cliente y lo único que hay abajo es "Cerrar sesión". Se salía con el botón
 * de atrás del navegador o tecleando la URL — y "cerrar sesión" estaba justo
 * donde el ojo busca la salida. La cinta es lo único que aparece en las
 * cuatro vistas, así que el regreso vive aquí.
 */
export default function AvisoRol({ rolReal }: { rolReal: string }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const rolVista = sp.get('rol');

  if (rolReal !== 'superadmin') return null;

  const comoRol = rolVista && NOMBRE[rolVista] ? NOMBRE[rolVista] : null;
  // Sin rol previsualizado, la cinta solo tiene sentido si de verdad estás en
  // el panel de una flota: `?vista=demo` o `?tenant=`. Un superadmin en
  // /dashboard sin ninguno de los dos ni siquiera llega — `esRaiz` lo rebota a
  // /admin (tenant-efectivo.ts).
  const enPanelDeFlota = sp.get('vista') !== null || sp.get('tenant') !== null;
  if (!comoRol && !enPanelDeFlota) return null;

  // Salir del ROL conserva el tenant que estabas viendo y solo tira `?rol=`:
  // perder la flota al salir del modo te devolvería al tenant demo sin avisar.
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
        {comoRol ? (
          <>
            Estás viendo el panel como <strong style={{ color: 'var(--ink)' }}>{comoRol}</strong>.
            Solo cambia lo que se te enseña, no lo que puedes hacer.
          </>
        ) : (
          <>
            Estás previsualizando <strong style={{ color: 'var(--ink)' }}>el panel del cliente</strong> con
            tu sesión de superadmin. Lo que ves es lo que vería el dueño de la flota.
          </>
        )}
      </span>
      <span className="ml-auto flex items-center gap-3 shrink-0">
        {comoRol && (
          <Link href={`${pathname}${qs ? `?${qs}` : ''}`} className="underline" style={{ color: 'var(--muted)' }}>
            Quitar el rol
          </Link>
        )}
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 font-medium underline"
          style={{ color: 'var(--ink)' }}
        >
          <ArrowLeft width={11} height={11} strokeWidth={2} /> Volver a mi consola
        </Link>
      </span>
    </div>
  );
}
