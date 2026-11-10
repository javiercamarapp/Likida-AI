'use client';

import { useState } from 'react';
import { Check, Copy, Printer } from 'lucide-react';
import { Boton, Icono, useNotificar } from '@/app/ui-v2/componentes';
import './whatsapp.css';

/** Copiar el enlace y imprimir el cartel — los dos gestos de la guía de arranque. */
export function AccionesEnlace({ enlace, esPrueba = false }: { enlace: string; esPrueba?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const { notificar } = useNotificar();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      notificar({ tono: 'ok', mensaje: 'Enlace copiado. Pégalo en el grupo de tus choferes.' });
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles (navegador, iframe): se dice, y el enlace
      // sigue visible arriba para seleccionarlo a mano.
      notificar({ tono: 'aviso', mensaje: 'Tu navegador no dejó copiar. Selecciona el enlace y cópialo a mano.' });
    }
  }

  return (
    <div className="rv-wa__botones">
      <Boton type="button" onClick={copiar} disabled={esPrueba} variante="secondary" icono={<Icono icono={copiado ? Check : Copy} />}>
        {copiado ? 'Copiado' : 'Copiar enlace'}
      </Boton>
      <Boton type="button" onClick={() => window.print()} disabled={esPrueba} variante="secondary" icono={<Icono icono={Printer} />}>
        Imprimir cartel
      </Boton>
    </div>
  );
}
