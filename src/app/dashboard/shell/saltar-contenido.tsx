'use client';

import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';

/** El enlace «Saltar al contenido» (primer elemento enfocable del marco). Cliente solo para leer el idioma activo. */
export default function SaltarAlContenido({ className }: { className: string }) {
  const { t } = useT('shell', shellEs);
  return <a href="#contenido-principal" className={className}>{t('marco.saltar')}</a>;
}
