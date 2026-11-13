'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';
import { Boton, Icono, Popover } from '@/app/ui-v2/componentes';

/** UN solo control por renglón del equipo: «Acciones» abre un popover del sistema con las formas (cada una conserva su server action, su
 *  aviso y su diálogo de confirmación). Sustituye al `<details>` con formularios: foco, Esc y clic fuera los pone el Popover. */
export function MenuAcciones({ rotulo, etiqueta, children }: { rotulo: string; etiqueta: string; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Boton ref={ancla} variante="ghost" tamano="sm" className="rv-usu__mas" aria-label={etiqueta} title={rotulo} aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}><Icono icono={Ellipsis} tam={16} /></Boton>
      <Popover abierto={abierto} onCerrar={() => setAbierto(false)} ancla={ancla} etiqueta={etiqueta} className="rv-usu__acciones">
        {children}
      </Popover>
    </>
  );
}
