'use client';

import { useState } from 'react';
import { Check, Copy, Printer } from 'lucide-react';
import { Boton, Icono, useNotificar } from '@/app/ui-v2/componentes';
import './whatsapp.css';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

/** Copiar el enlace y imprimir el cartel — los dos gestos de la guía de arranque. */
export function AccionesEnlace({ enlace, esPrueba = false }: { enlace: string; esPrueba?: boolean }) {
  const { t } = useT('operacion', operacionEs);
  const [copiado, setCopiado] = useState(false);
  const { notificar } = useNotificar();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      notificar({ tono: 'ok', mensaje: t('wa.copiado.ok') });
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles (navegador, iframe): se dice, y el enlace
      // sigue visible arriba para seleccionarlo a mano.
      notificar({ tono: 'aviso', mensaje: t('wa.copiado.error') });
    }
  }

  return (
    <div className="rv-wa__botones">
      <Boton type="button" onClick={copiar} disabled={esPrueba} variante="secondary" icono={<Icono icono={copiado ? Check : Copy} />}>
        {copiado ? t('wa.copiado') : t('wa.copiar')}
      </Boton>
      <Boton type="button" onClick={() => window.print()} disabled={esPrueba} variante="secondary" icono={<Icono icono={Printer} />}>
        {t('wa.imprimir')}
      </Boton>
    </div>
  );
}
