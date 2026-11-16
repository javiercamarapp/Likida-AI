'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Aviso } from '../ui-v2/componentes/aviso';
import { useT } from '@/lib/i18n/proveedor';
import { rico } from '@/lib/i18n/rico';
import { dashboard_b as dashboard_bEs } from '@/lib/i18n/es/dashboard_b';
import { shell as shellEs } from '@/lib/i18n/es/shell';

/** Los tres roles que un superadmin puede previsualizar (`PREVISUALIZABLES`
 *  de visibilidad.ts). El NOMBRE sale de `roles.ts` — H18 (auditoría 24):
 *  esta cinta decía «Jefe de tráfico» y la lista del equipo «Encargado» para
 *  el mismo rol, y dos nombres se leen como dos roles. `visibilidad.ts` no se
 *  importa aquí a propósito: este es un Client Component. */
const PREVISUALIZABLES = ['flota_admin', 'encargado', 'contador'] as const;
const CLAVE_ROL = { flota_admin: 'rol.flota_admin', encargado: 'rol.encargado', contador: 'rol.contador' } as const;

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
  const { t } = useT('dashboard_b', dashboard_bEs);
  const { t: ts } = useT('shell', shellEs);
  const sp = useSearchParams();
  const pathname = usePathname();
  const rolVista = sp.get('rol');

  if (rolReal !== 'superadmin') return null;

  const comoRol = rolVista && (PREVISUALIZABLES as readonly string[]).includes(rolVista)
    ? ts(CLAVE_ROL[rolVista as keyof typeof CLAVE_ROL])
    : null;
  // Sin rol previsualizado, esta cinta solo aplica al "ver como" por query
  // string (`?vista=demo` o `?tenant=`). Un superadmin SIN esos params está en
  // la flota que eligió en /admin/elegir-flota (cookie de admin-context.ts,
  // 16-ago-2026) — ese camino no pasa por aquí (esto es un Client Component
  // que solo ve la URL): su aviso es el badge "viendo como superadmin ·
  // <flota>" que las páginas pintan con `tenantNombre` del servidor.
  const enPanelDeFlota = sp.get('vista') !== null || sp.get('tenant') !== null;
  if (!comoRol && !enPanelDeFlota) return null;

  // Salir del ROL conserva el tenant que estabas viendo y solo tira `?rol=`:
  // perder la flota al salir del modo te devolvería al tenant demo sin avisar.
  const restantes = new URLSearchParams(sp.toString());
  restantes.delete('rol');
  const qs = restantes.toString();

  return (
    <Aviso
      tono="info"
      className="mb-3"
      acciones={(
        <>
          {comoRol && <Link href={`${pathname}${qs ? `?${qs}` : ''}`} className="underline">{t('avr.quitar')}</Link>}
          <Link href="/admin" className="inline-flex items-center gap-1 font-medium underline">
            <ArrowLeft width={11} height={11} strokeWidth={2} aria-hidden="true" /> {t('avr.volver')}
          </Link>
        </>
      )}
    >
      {comoRol ? (
        <>{rico(t('avr.como', { rol: comoRol }), { strong: (c) => <strong>{c}</strong> })}</>
      ) : (
        <>{rico(t('avr.previa'), { strong: (c) => <strong>{c}</strong> })}</>
      )}
    </Aviso>
  );
}
