'use client';

import { useActionState } from 'react';
import { Aviso, Boton, CampoArchivo, CampoSelect, CampoTexto, Casilla } from '../../ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { admin_dinero } from '@/lib/i18n/es/admin_dinero';

export type ResultadoReferencia = { ok: true } | { error: string } | null;

/**
 * Personajes y lugares: FormData directo a través de un Server Action — mismo patrón que `avatar-uploader.tsx` (la foto cabe cómodo bajo el
 * límite de payload de la función; no necesita URL firmada como el video).
 */
export function SubirReferencia({ accion }: { accion: (previo: ResultadoReferencia, fd: FormData) => Promise<ResultadoReferencia> }) {
  const { t } = useT('admin_dinero', admin_dinero);
  const [estado, enviar, pendiente] = useActionState<ResultadoReferencia, FormData>(accion, null);

  return (
    <form action={enviar} className="adm-din-forma adm-din-forma--ancha">
      <CampoSelect etiqueta={t('neg5.mk_que_es')} name="tipo" defaultValue="personaje" disabled={pendiente}>
        <option value="personaje">{t('neg5.mk_personaje')}</option>
        <option value="lugar">{t('neg5.mk_lugar')}</option>
      </CampoSelect>
      <CampoTexto etiqueta={t('neg5.mk_nombre')} name="nombre" placeholder={t('neg5.mk_nombre_ph')} obligatorio disabled={pendiente} />
      <CampoTexto etiqueta={t('neg5.mk_etiqueta_libre')} name="etiqueta" placeholder={t('neg5.mk_etiqueta_ph')} disabled={pendiente} />
      <CampoArchivo etiqueta={t('neg5.mk_foto_ref')} name="foto" accept="image/jpeg,image/png,image/webp" obligatorio disabled={pendiente} />
      <Casilla
        name="consentimiento" disabled={pendiente}
        etiqueta={t('neg5.mk_consent_etq')}
        ayuda={t('neg5.mk_consent_ayuda')}
      />
      {estado && 'error' in estado ? <Aviso tono="error">{estado.error}</Aviso> : null}
      {estado && 'ok' in estado ? <Aviso tono="ok">{t('neg5.mk_guardado')}</Aviso> : null}
      <div>
        <Boton type="submit" variante="primary" tamano="sm" loading={pendiente}>{pendiente ? t('neg5.mk_subiendo') : t('neg5.mk_subir')}</Boton>
      </div>
    </form>
  );
}
