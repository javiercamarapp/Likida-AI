'use client';

import { Info } from 'lucide-react';
import { useId, useRef, useSyncExternalStore } from 'react';
import { INFO, type InfoClave } from '../info-catalogo';
import { ContenidoInfo } from './info-contenido';
import { Drawer } from './overlay';

// ═══════════════════════════════════════════════════════════════════════════
// InfoTip (ⓘ): botón de 24 px (toque 44) en la esquina del encabezado de cada recuadro. Abre un CAJÓN (Drawer de 420, como Rovaq; hoja
// inferior en móvil) con la explicación en bloques (`ContenidoInfo`: Qué es · Cómo se calcula · Fuente/Periodo/Cobertura · Lo que no
// sabemos · Qué hacer · Clase de dato). UN SOLO ⓘ abierto a la vez en toda la página (almacén de módulo). El <dialog> nativo da foco
// atrapado, Esc y devolución del foco al ⓘ. El texto sale de info-catalogo.ts; los campos opcionales vacíos no se pintan.
// ═══════════════════════════════════════════════════════════════════════════

let abiertoId: string | null = null;
const oyentes = new Set<() => void>();
const poner = (id: string | null) => { abiertoId = id; oyentes.forEach((f) => f()); };
const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
const useAbierto = (id: string) => useSyncExternalStore(suscribir, () => abiertoId === id, () => false);

export function InfoTip({ clave }: { clave: InfoClave }) {
  const id = useId();
  const ancla = useRef<HTMLButtonElement>(null);
  const abierto = useAbierto(id);
  const t = INFO[clave];
  const cerrar = () => { if (abiertoId === id) poner(null); };
  return (
    <>
      <button
        ref={ancla} type="button" className="rv-info" aria-label={`Información: ${t.titulo}`}
        aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => poner(abierto ? null : id)}
      >
        <Info aria-hidden="true" size={14} strokeWidth={1.75} />
      </button>
      {/* Se monta solo abierto: una página con decenas de ⓘ no carga decenas de cajones. Al desmontar, el motor devuelve el foco al ⓘ. */}
      {abierto ? <Drawer abierto onCerrar={cerrar} titulo={t.titulo}><ContenidoInfo texto={t} /></Drawer> : null}
    </>
  );
}
