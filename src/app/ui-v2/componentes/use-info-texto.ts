'use client';

import { useEffect, useState } from 'react';
import { useIdioma } from '@/lib/i18n/proveedor';
import type { InfoClave, InfoTexto } from '../info-catalogo';
import { cargarInfoEn, infoDeIdioma, infoEnCargado } from '../info-idioma';

/**
 * El texto del ⓘ en el idioma activo. Sin proveedor = español (las pruebas actuales no cambian). En inglés dispara la carga perezosa de los
 * textos en inglés y re-pinta al llegar; mientras tanto (y si falla la carga) devuelve el español. El primer render coincide con el del servidor.
 */
export function useInfoTexto(clave: InfoClave): InfoTexto {
  const idioma = useIdioma();
  const [, avisar] = useState(0);
  useEffect(() => {
    if (idioma !== 'en' || infoEnCargado()) return;
    let vivo = true;
    cargarInfoEn().then(() => { if (vivo) avisar((n) => n + 1); }).catch(() => { /* se queda en español */ });
    return () => { vivo = false; };
  }, [idioma]);
  return infoDeIdioma(clave, idioma);
}
