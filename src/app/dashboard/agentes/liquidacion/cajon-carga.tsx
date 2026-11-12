'use client';

import type { ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { Boton, Drawer, Icono, useAbrirPorUrl } from '@/app/ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// «IMPORTAR DATOS» como en Rovaq: una acción primaria en la cabecera de la página que abre un cajón. Los formularios (server actions
// ya armadas por el servidor) viajan como hijos; el cajón nace abierto cuando la página vuelve de una carga con su resultado
// (`abiertoInicial`), para que el aviso y el detalle se vean donde se hizo la carga. No toca ninguna acción de servidor.
// ═══════════════════════════════════════════════════════════════════════════

export function CajonCarga({ id = 'importar', titulo, descripcion, disparador, abiertoInicial = false, children }: {
  id?: string; titulo: string; descripcion?: ReactNode; disparador: string; abiertoInicial?: boolean; children: ReactNode;
}) {
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id, abiertoInicial });
  return (
    <>
      <Boton type="button" variante="primary" tamano="sm" icono={<Icono icono={Upload} />} onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion} tamano="l">
        <div id={id === 'importar' ? 'cargas' : undefined} className="rv-liq-cajon">{children}</div>
      </Drawer>
    </>
  );
}
