'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { SECCIONES, type Item } from './rutas';
import { PieAdmin } from './sidebar-nav';
import { useRequiereAccion, etiquetaCampana } from './cabecera-admin';
import { CabeceraMovilVista } from '../dashboard/shell/cabecera-movil';
import { BarraInferiorVista } from '../dashboard/shell/barra-inferior';
import { HojaMasVista } from '../dashboard/shell/hoja-mas';
import { hrefActivo, type MenuV2 } from '../dashboard/shell/menu-por-perfil';
import type { DestinoMovil } from '../dashboard/shell/barra-inferior-destinos';

// ═══════════════════════════════════════════════════════════════════════════
// LA NAVEGACIÓN MÓVIL DE /admin (<768 px): las MISMAS piezas del dashboard (cabecera móvil, barra inferior flotante y hoja «Más»),
// alimentadas con los destinos del admin. Antes el admin dejaba un riel de 56 px con 25 iconos sin etiqueta.
//   · la barra lleva 4 destinos con etiqueta (Resumen, Bandeja, Agentes, Clientes) y «Más»;
//   · «Más» abre el árbol completo (las cuatro secciones de `rutas.ts`) y, abajo, el MISMO pie compartido del sidebar.
// ═══════════════════════════════════════════════════════════════════════════

const RESUMEN: Item = { href: '/admin', nombre: 'Resumen', Icono: LayoutGrid };

/** El menú del admin con la forma que entiende `ArbolMenu`: Resumen arriba y las cuatro secciones como grupos. */
export const MENU_ADMIN: MenuV2 = {
  resumen: [RESUMEN],
  grupos: SECCIONES.map((s) => ({ id: s.titulo.toLowerCase(), titulo: s.titulo, items: s.items })),
  pie: [],
};

const DESTINOS_BARRA: ReadonlyArray<{ href: string; etiqueta: string }> = [
  { href: '/admin', etiqueta: 'Resumen' },
  { href: '/admin/tu-turno', etiqueta: 'Bandeja' },
  { href: '/admin/agentes', etiqueta: 'Agentes' },
  { href: '/admin/flotas', etiqueta: 'Clientes' },
];

/** Los destinos de la barra, resueltos contra el mapa real (si una entrada desaparece de `rutas.ts`, desaparece de la barra). */
export function destinosBarraAdmin(): DestinoMovil[] {
  const porHref = new Map<string, Item>([RESUMEN, ...SECCIONES.flatMap((s) => s.items)].map((i) => [i.href, i]));
  return DESTINOS_BARRA.flatMap((d) => {
    const it = porHref.get(d.href);
    return it ? [{ href: it.href, nombre: it.nombre, etiqueta: d.etiqueta, Icono: it.Icono }] : [];
  });
}

/** La cabecera móvil del admin: logo, fecha y campana (mismo conteo real de «Avisos»; lectura caída = «sin dato», sin punto). */
export function CabeceraMovilAdmin() {
  const r = useRequiereAccion();
  return <CabeceraMovilVista hrefCasa="/admin" hrefAvisos="/admin/notificaciones" etiquetaAvisos={etiquetaCampana(r)} punto={!!r && (r.pendientes ?? 0) > 0} />;
}

export default function NavegacionMovilAdmin({ nombre, avatarUrl, flotas, flotaActual, salir }: {
  nombre: string | null; avatarUrl: string | null;
  flotas?: Array<{ id: string; nombre: string }> | null; flotaActual?: string | null; salir?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [abierta, setAbierta] = useState(false);
  const cerrar = () => setAbierta(false);
  const activo = hrefActivo(pathname, MENU_ADMIN);
  return (
    <>
      <BarraInferiorVista destinos={destinosBarraAdmin()} sufijo="" activo={activo} masAbierta={abierta} alAbrirMas={() => setAbierta(true)} />
      <HojaMasVista abierta={abierta} alCerrar={cerrar} menu={MENU_ADMIN} sufijo="" pathname={pathname}
        pie={<PieAdmin nombre={nombre} avatarUrl={avatarUrl} flotas={flotas} flotaActual={flotaActual} salir={salir} alNavegar={cerrar} />} />
    </>
  );
}
