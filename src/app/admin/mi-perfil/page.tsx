import type { Metadata } from 'next';
import { AvisoCompacto, Boton } from '@/app/ui-v2/componentes';
import { EsqueletoConfiguracion, FilaConfig } from '@/app/ui-v2/esqueletos';
import { getT } from '@/lib/i18n/servidor';
import { PreferenciasFilas } from './preferencias-filas';
import { CampoTexto } from '../../ui-v2/componentes/campos';
import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { ROL_LABEL, type RolAppUser } from '@/lib/auth/provisionar';
import AvatarUploader from './avatar-uploader';
import { descartarAvataresViejos } from '@/lib/perfil/avatar_huerfanos';
import '../resumen.css';

export const dynamic = 'force-dynamic';

/** Tipos de imagen que el bucket acepta. Un `.svg` puede traer script
 *  adentro y el bucket `avatares` es PÚBLICO — servirlo desde nuestro
 *  dominio sería XSS almacenado, así que no entra. MISMA lista y MISMO
 *  tope que `dashboard/mi-perfil/page.tsx` (auditoría 13, seguridad,
 *  MEDIO): esta ruta —la del superadmin, no la del cliente— nació sin
 *  esta puerta, aunque el hermano correcto ya la tenía documentada con
 *  esta misma razón. Sin ella, subir aquí no validaba tipo ni peso: un
 *  `.svg` renombrado o un archivo de varios MB entraban igual al bucket
 *  público. */
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TOPE_BYTES = 2 * 1024 * 1024;

/**
 * Editable de verdad — nombre y foto de perfil escriben a `app_user`
 * (0046_perfil_avatar.sql), no son un formulario decorativo. Correo y rol
 * se muestran pero NO son editables aquí: el correo está ligado a la
 * cuenta de Supabase Auth (cambiarlo es un flujo de verificación aparte,
 * no un campo de texto) y el rol lo asigna otro superadmin, no uno mismo.
 * Mismo patrón que `usuarios/nuevo/page.tsx`: Server Action inline,
 * gateada por `requireSuperadmin()` otra vez adentro, `supabaseAdmin()`
 * para la escritura (no hay policy de UPDATE en `app_user` para "yo
 * mismo" — añadir una para este único caso no vale más que reusar el
 * mismo patrón ya probado del resto del repo).
 */
export default async function MiPerfilPage({
  searchParams,
}: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSuperadmin();
  const sp = await searchParams;
  const { t, idioma } = await getT('publico');
  const { t: ts } = await getT('admin_sistema');
  const admin = supabaseAdmin();
  const { data: fila } = await admin.from('app_user').select('email').eq('id', s.userId).maybeSingle();

  async function actualizarNombre(formData: FormData) {
    'use server';
    const { userId } = await requireSuperadmin();
    const nombre = String(formData.get('nombre') ?? '').trim();
    if (!nombre) redirect('/admin/mi-perfil?error=nombre');
    // ADM-14 (auditoría 24, MEDIO): el `error` de este update se
    // descartaba — "Guardado" salía SIEMPRE, aunque la escritura fallara.
    // Viola "fallar cerrado y decirlo": un guardado que no guardó es peor
    // que uno que dice que falló.
    const { error } = await supabaseAdmin().from('app_user').update({ nombre }).eq('id', userId);
    if (error) redirect('/admin/mi-perfil?error=nombre_guardar');
    redirect('/admin/mi-perfil?ok=nombre');
  }

  async function subirAvatar(formData: FormData) {
    'use server';
    const { userId } = await requireSuperadmin();
    const archivo = formData.get('avatar');
    if (!(archivo instanceof File) || archivo.size === 0) redirect('/admin/mi-perfil?error=avatar');
    // TIPO y PESO, antes de tocar storage — mismo candado que
    // dashboard/mi-perfil/page.tsx. `archivo.type` lo declara el navegador
    // y es del cliente, pero decidir la extensión CON ÉL (y no con el
    // nombre del archivo) es lo que impide que un `.svg` renombrado a
    // `.png` decida cómo se sirve luego.
    if (!TIPOS.has(archivo.type)) redirect('/admin/mi-perfil?error=tipo');
    if (archivo.size > TOPE_BYTES) redirect('/admin/mi-perfil?error=peso');
    const admin2 = supabaseAdmin();
    const ext = archivo.type === 'image/png' ? 'png' : archivo.type === 'image/webp' ? 'webp' : 'jpg';
    const ruta = `${userId}/avatar.${ext}`;
    const { error } = await admin2.storage.from('avatares').upload(ruta, archivo, { upsert: true, contentType: archivo.type });
    if (error) redirect('/admin/mi-perfil?error=avatar');
    const { data: pub } = admin2.storage.from('avatares').getPublicUrl(ruta);
    // `?t=` para reventar el caché del navegador — la ruta pública es
    // siempre la misma (mismo userId, mismo nombre de archivo), así que
    // sin esto el navegador podría seguir mostrando la foto vieja.
    //
    // ADM-14: este segundo `error` también se descartaba — el archivo ya
    // subió a Storage, pero si ESTA escritura falla, `app_user.avatar_url`
    // se queda apuntando a la foto VIEJA mientras la pantalla dice
    // "Foto de perfil actualizada."
    const { error: errAvatar } = await admin2.from('app_user').update({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` }).eq('id', userId);
    if (errAvatar) redirect('/admin/mi-perfil?error=avatar_guardar');
    // A37-S07-06: el bucket es público; si cambió la extensión, el avatar anterior
    // quedaría servido sin referencia. Se retira SOLO tras guardar el nuevo.
    await descartarAvataresViejos(admin2, userId, ext);
    redirect('/admin/mi-perfil?ok=avatar');
  }

  const mensajeError = sp.error === 'avatar' ? 'No se pudo subir la foto — intenta con otra imagen.'
    : sp.error === 'tipo' ? 'Solo se aceptan imágenes JPG, PNG o WebP.'
      : sp.error === 'peso' ? 'La imagen pasa de 2 MB — usa una más ligera.'
        : sp.error === 'avatar_guardar' ? 'La foto se subió, pero no se pudo guardar en tu perfil — intenta de nuevo.'
          : sp.error === 'nombre_guardar' ? 'No se pudo guardar el nombre — intenta de nuevo.'
            : 'El nombre no puede quedar vacío.';

  return (
    <EsqueletoConfiguracion
      titulo="Mi perfil" apoyo="Tu nombre y tu foto. El correo y el rol los define la cuenta."
      avisos={(
        <>
          {sp.ok && <AvisoCompacto tono="ok" resumen={sp.ok === 'avatar' ? 'Foto de perfil actualizada.' : 'Nombre guardado.'} />}
          {sp.error && <AvisoCompacto tono="error" resumen={mensajeError} />}
        </>
      )}
      secciones={[
        {
          // UNA tarjeta de filas rótulo-control (Rovaq CF): foto, nombre, correo, rol, idioma y tema.
          id: 'perfil', titulo: ts('mi_perfil.tu_cuenta'),
          contenido: (
            <>
              <FilaConfig rotulo={ts('mi_perfil.foto')} ayuda={ts('mi_perfil.foto_ayuda')}>
                <AvatarUploader nombre={s.nombre ?? 'Javier'} avatarUrl={s.avatarUrl} accion={subirAvatar} />
              </FilaConfig>
              <FilaConfig rotulo={ts('mi_perfil.nombre')} ayuda={ts('mi_perfil.nombre_ayuda')}>
                <form action={actualizarNombre} className="adm-perfil-form adm-perfil-form--fila">
                  <CampoTexto etiqueta={ts('mi_perfil.nombre')} etiquetaOculta name="nombre" defaultValue={s.nombre ?? ''} obligatorio />
                  <Boton type="submit" variante="secondary" tamano="sm">{ts('mi_perfil.guardar_nombre')}</Boton>
                </form>
              </FilaConfig>
              <FilaConfig rotulo={ts('mi_perfil.correo')} ayuda={ts('mi_perfil.correo_ayuda')}>
                <span className="adm-perfil-valor">{(fila?.email as string) ?? '—'}</span>
              </FilaConfig>
              <FilaConfig rotulo={ts('mi_perfil.rol')} ayuda={ts('mi_perfil.rol_ayuda')}>
                <span className="adm-perfil-valor">{ROL_LABEL[s.rol as RolAppUser] ?? s.rol}</span>
              </FilaConfig>
              <PreferenciasFilas idiomaActivo={idioma} textos={{
                idioma: t('cta.idioma'), ayudaIdioma: ts('mi_perfil.idioma_ayuda'), tema: t('cta.tema'), ayudaTema: ts('mi_perfil.tema_ayuda'),
                temaClaro: t('cta.tema.claro'), temaSistema: t('cta.tema.sistema'), temaOscuro: t('cta.tema.oscuro'),
                es: 'Español', en: 'English', enProximamente: t('cta.en_pronto'), fallo: t('cta.idioma.fallo'),
              }} />
            </>
          ),
        },
      ]}
    />
  );
}

export const metadata: Metadata = { title: 'Mi perfil' };
