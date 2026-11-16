'use client';

import { Camera, FileImage, Paperclip } from 'lucide-react';
import type { RefObject } from 'react';
import { MenuItem, MenuList, Popover } from '../ui-v2/componentes/overlay';
import { useT } from '@/lib/i18n/proveedor';
import { dashboard_b as dashboard_bEs } from '@/lib/i18n/es/dashboard_b';

/**
 * El menú «Adjuntar» del chat: tomar foto / subir imágenes / adjuntar archivos (los tres terminan en el mismo OCR real).
 * Es el Popover + MenuList del motor único de overlays (L3): Esc cierra y devuelve el foco al clip, clic afuera cierra,
 * flechas recorren las filas, Tab fuera lo cierra. Sustituye al velo `fixed inset-0 z-20` y al panel `absolute` a mano.
 */
export default function MenuAdjuntar({ abierto, onCerrar, ancla, onCamara, onImagen, onArchivo }: {
  abierto: boolean;
  onCerrar: () => void;
  /** El botón del clip: ancla del panel y destino del foco al cerrar. */
  ancla: RefObject<HTMLElement | null>;
  onCamara: () => void;
  onImagen: () => void;
  onArchivo: () => void;
}) {
  const { t } = useT('dashboard_b', dashboard_bEs);
  const elegir = (accion: () => void) => () => { onCerrar(); accion(); };
  return (
    <Popover abierto={abierto} onCerrar={onCerrar} ancla={ancla} etiqueta={t('adj.etiqueta')} alineacion="fin" className="rv-pop--adjuntar">
      <MenuList etiqueta={t('adj.etiqueta')}>
        <MenuItem icono={<Camera aria-hidden="true" />} onSelect={elegir(onCamara)}>
          <span>{t('adj.foto')}</span><span className="rv-menu__apoyo">{t('adj.foto_apoyo')}</span>
        </MenuItem>
        <MenuItem icono={<FileImage aria-hidden="true" />} onSelect={elegir(onImagen)}>
          <span>{t('adj.imagenes')}</span><span className="rv-menu__apoyo">{t('adj.imagenes_apoyo')}</span>
        </MenuItem>
        <MenuItem icono={<Paperclip aria-hidden="true" />} onSelect={elegir(onArchivo)}>
          <span>{t('adj.archivos')}</span><span className="rv-menu__apoyo">{t('adj.archivos_apoyo')}</span>
        </MenuItem>
      </MenuList>
    </Popover>
  );
}
