'use client';

import { useSyncExternalStore } from 'react';
import { Search } from 'lucide-react';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/** El evento que abre el buscador ⌘K: lo escuchan `PaletaDashboard` (dashboard) y `CommandPalette` (/admin). */
export const EVENTO_ABRIR_BUSCADOR = 'likida:abrir-buscador';

const sinSuscripcion = () => () => {};
// En Mac el atajo es ⌘K; en el resto, Ctrl K. El servidor pinta ⌘K y el cliente se corrige (sin dato del sistema = ⌘K).
const esMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * El disparador VISIBLE del buscador (⌘K): un campo-botón con lupa, «Buscar» y el atajo en un <kbd>. Antes el atajo era solo de teclado
 * y nadie sabía que existía. No abre nada por sí mismo: avisa por evento, así que sirve igual para el buscador del dashboard y el de /admin.
 */
export default function BotonBuscar() {
  const { t } = useT('shell', shellEs);
  const mac = useSyncExternalStore(sinSuscripcion, esMac, () => true);
  const atajo = mac ? '⌘K' : 'Ctrl K';
  return (
    <button type="button" className="rv-cab-esc__buscar" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K"
      aria-label={t('cab.buscar.etiqueta', { atajo })} onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_BUSCADOR))}>
      <Search width={14} height={14} strokeWidth={TRAZO_ICONO} aria-hidden />
      <span className="rv-cab-esc__buscar-txt">{t('cab.buscar')}</span>
      <kbd>{atajo}</kbd>
    </button>
  );
}
