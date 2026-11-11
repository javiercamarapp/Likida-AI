'use client';

import { LogOut } from 'lucide-react';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { Tooltip } from '../ui-v2/componentes/overlay';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';

/**
 * El BOTÓN de «Cerrar sesión» de la tarjeta de usuario de /admin. El `<form action={cerrarSesion}>` se queda en el servidor
 * (`chrome.tsx`: ninguna función cruza al cliente, ver `kit_sin_funciones.test.ts`); este botón solo existe para leer el idioma activo.
 */
export default function BotonSalirAdmin() {
  const { t } = useT('shell', shellEs);
  return (
    <Tooltip texto={t('pie.cuenta.salir')}>
      <button type="submit" aria-label={t('pie.cuenta.salir')} className="rv-icono-boton">
        <LogOut width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
      </button>
    </Tooltip>
  );
}
