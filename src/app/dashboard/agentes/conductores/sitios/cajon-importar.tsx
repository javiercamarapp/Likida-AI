'use client';

import type { ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { Boton, Drawer, Icono, useAbrirPorUrl } from '@/app/ui-v2/componentes';
import '../conductores.css';

// ═══════════════════════════════════════════════════════════════════════════
// «IMPORTAR» DEL CATÁLOGO DE SITIOS, como en Rovaq (tabla maestra → alta o carga en CAJÓN, no formularios largos dentro de la página). Un solo botón
// secundario en la cabecera abre el cajón con los tres importadores (CSV de sitios, catálogo depurado y equivalencias texto→sitio). Las acciones de servidor
// (con su puerta de permisos y la flota atada) viajan como hijos ya armados: este archivo no toca ninguna. Con `abiertoInicial` o `?abrir=importar` nace abierto.
// ═══════════════════════════════════════════════════════════════════════════

export function CajonImportarSitios({ disparador, titulo, descripcion, abiertoInicial = false, children }: {
  disparador: string; titulo: string; descripcion?: ReactNode; abiertoInicial?: boolean; children: ReactNode;
}) {
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id: 'importar', abiertoInicial });
  return (
    <>
      <Boton type="button" variante="secondary" tamano="sm" icono={<Icono icono={Upload} />} aria-haspopup="dialog" onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion}>
        <div className="rv-cd__cajon">{children}</div>
      </Drawer>
    </>
  );
}
