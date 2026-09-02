import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { UserRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BarraPagina } from '../../dashboard/resumen-visual';
import AvatarUploader from './avatar-uploader';

export const dynamic = 'force-dynamic';

const ROL_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', flota_admin: 'Dueño / Admin de flota', encargado: 'Encargado', contador: 'Contador', operador: 'Operador / Chofer',
};

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
    redirect('/admin/mi-perfil?ok=avatar');
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<UserRound width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Mi perfil"
        />

        <div className="px-5 py-5 flex-1">
          <div className="card p-5" style={{ maxWidth: 480 }}>
            {sp.ok && (
              <div className="flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg mb-5" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
                <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
                {sp.ok === 'avatar' ? 'Foto de perfil actualizada.' : 'Nombre guardado.'}
              </div>
            )}
            {sp.error && (
              <div className="flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg mb-5" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
                <AlertTriangle width={15} height={15} strokeWidth={1.75} />
                {sp.error === 'avatar' ? 'No se pudo subir la foto — intenta con otra imagen.'
                  : sp.error === 'avatar_guardar' ? 'La foto se subió, pero no se pudo guardar en tu perfil — intenta de nuevo.'
                    : sp.error === 'nombre_guardar' ? 'No se pudo guardar el nombre — intenta de nuevo.'
                      : 'El nombre no puede quedar vacío.'}
              </div>
            )}

            <AvatarUploader nombre={s.nombre ?? 'Javier'} avatarUrl={s.avatarUrl} accion={subirAvatar} />

            <form action={actualizarNombre} className="space-y-4 mt-6 pt-6 border-t" style={{ borderColor: 'var(--line2)' }}>
              <div>
                <label className="text-sm font-medium block mb-1.5">Nombre</label>
                <input name="nombre" type="text" defaultValue={s.nombre ?? ''} required
                  className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }} />
              </div>
              <button type="submit" className="text-sm px-4 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-85"
                style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                Guardar nombre
              </button>
            </form>

            <dl className="mt-6 pt-6 border-t space-y-3 text-sm" style={{ borderColor: 'var(--line2)' }}>
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Correo</dt>
                <dd className="text-right">{(fila?.email as string) ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Rol</dt>
                <dd className="text-right">{ROL_LABEL[s.rol] ?? s.rol}</dd>
              </div>
            </dl>
            <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>
              Correo y rol no son editables aquí — el correo está ligado a tu cuenta de acceso y el rol lo asigna otro superadmin.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
