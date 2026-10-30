'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// ═══════════════════════════════════════════════════════════════════════════
// H29 (auditoría 24) — "Mi cuenta"/el nombre en el user card del sidebar
// apagaba la previsualización del superadmin.
//
// `chrome.tsx` es un Server Component; `layout.tsx` NO recibe `searchParams`
// (limitación documentada de Next.js — ver su propio comentario), así que el
// `?tenant=`/`?vista=`/`?rol=` no puede resolverse ahí. El link a `/cuenta`
// vivía como `href="/cuenta"` crudo: un superadmin previsualizando una flota
// que hiciera clic en su propio nombre/avatar volvía a `/cuenta` SIN esos
// parámetros — la previsualización se apagaba a media revisión, exactamente
// la trampa que `dashboard/sufijo.ts` documenta para las páginas server, y
// que `sidebar-nav.tsx` (`useSufijoYRol`) ya resuelve para los links del menú
// con el MISMO patrón: un Client Component propio que lee `useSearchParams()`.
//
// Se replica esa misma lógica aquí (no se importa `useSufijoYRol` porque es
// una función privada de `sidebar-nav.tsx`, ajeno a este agente) — mismo
// contrato: `tenant` gana sobre `vista`; sin ninguno, un superadmin real cae
// a `?vista=demo` porque las subpáginas ya lo mandaron ahí y un link sin
// sufijo lo expulsaría del panel; `rol` (previsualización de rol) viaja
// siempre que exista.
// ═══════════════════════════════════════════════════════════════════════════
export function EnlaceCuenta({ rol, children, className, role, tabIndex, onClick }: {
  rol: string; children: React.ReactNode; className?: string;
  /** Solo el menú de la tarjeta de cuenta v2 los usa (role="menuitem", foco por flechas, cerrar al navegar); sin ellos, idéntico. */
  role?: string; tabIndex?: number; onClick?: () => void;
}) {
  const sp = useSearchParams();
  const tenant = sp.get('tenant');
  const vista = sp.get('vista');
  const rolVista = sp.get('rol');
  const base = tenant
    ? `?tenant=${tenant}`
    : vista ? `?vista=${vista}`
    : rol === 'superadmin' ? '?vista=demo' : '';
  const sufijo = rolVista ? `${base}${base ? '&' : '?'}rol=${rolVista}` : base;
  return <Link href={`/cuenta${sufijo}`} className={className} role={role} tabIndex={tabIndex} onClick={onClick}>{children}</Link>;
}
