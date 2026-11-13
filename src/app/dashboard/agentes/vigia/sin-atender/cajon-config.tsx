'use client';

import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Boton, Drawer, Icono, useAbrirPorUrl } from '@/app/ui-v2/componentes';
import '../vigia.css';

// ═══════════════════════════════════════════════════════════════════════════
// «CONFIGURACIÓN DE TU FLOTA» de «sin atender» como en Rovaq (tabla maestra → la configuración no va incrustada en la lista): un botón secundario en la cabecera
// abre un cajón de 420 con la forma. La acción de servidor (con su puerta de permisos y la flota atada) llega ya armada dentro de `children`; aquí no se toca.
// ═══════════════════════════════════════════════════════════════════════════

export function CajonConfiguracionSinAtender({ disparador, titulo, children }: { disparador: string; titulo: string; children: ReactNode }) {
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id: 'configuracion' });
  return (
    <>
      <Boton type="button" variante="secondary" tamano="sm" icono={<Icono icono={SlidersHorizontal} tam={14} />} aria-haspopup="dialog" onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo}>
        <div id="sin-atender-config">{children}</div>
      </Drawer>
    </>
  );
}
