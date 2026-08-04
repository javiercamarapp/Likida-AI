import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { UserRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import AvatarUploader from './avatar-uploader';

export const dynamic = 'force-dynamic';

const ROL_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', flota_admin: 'Dueño / Admin de flota', encargado: 'Encargado', contador: 'Contador', operador: 'Operador / Chofer',
};

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
    await supabaseAdmin().from('app_user').update({ nombre }).eq('id', userId);
    redirect('/admin/mi-perfil?ok=nombre');
  }

  async function subirAvatar(formData: FormData) {
    'use server';
    const { userId } = await requireSuperadmin();
    const archivo = formData.get('avatar');
    if (!(archivo instanceof File) || archivo.size === 0) redirect('/admin/mi-perfil?error=avatar');
    const admin2 = supabaseAdmin();
    const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase();
    const ruta = `${userId}/avatar.${ext}`;
    const { error } = await admin2.storage.from('avatares').upload(ruta, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (error) redirect('/admin/mi-perfil?error=avatar');
    const { data: pub } = admin2.storage.from('avatares').getPublicUrl(ruta);
    // `?t=` para reventar el caché del navegador — la ruta pública es
    // siempre la misma (mismo userId, mismo nombre de archivo), así que
    // sin esto el navegador podría seguir mostrando la foto vieja.
    await admin2.from('app_user').update({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` }).eq('id', userId);
    redirect('/admin/mi-perfil?ok=avatar');
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center gap-2.5 px-5">
        <UserRound width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Mi perfil</span>
      </header>

      <div className="glass-panel p-6" style={{ maxWidth: 480 }}>
        {sp.ok && (
          <div className="flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg mb-5" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
            <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
            {sp.ok === 'avatar' ? 'Foto de perfil actualizada.' : 'Nombre guardado.'}
          </div>
        )}
        {sp.error && (
          <div className="flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg mb-5" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
            <AlertTriangle width={15} height={15} strokeWidth={1.75} />
            {sp.error === 'avatar' ? 'No se pudo subir la foto — intenta con otra imagen.' : 'El nombre no puede quedar vacío.'}
          </div>
        )}

        <AvatarUploader nombre={s.nombre ?? 'Javier'} avatarUrl={s.avatarUrl} accion={subirAvatar} />

        <form action={actualizarNombre} className="space-y-4 mt-6 pt-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div>
            <label className="text-sm font-medium block mb-1.5">Nombre</label>
            <input name="nombre" type="text" defaultValue={s.nombre ?? ''} required
              className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
          </div>
          <button type="submit" className="text-sm px-4 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-85"
            style={{ background: 'var(--marca)', color: 'white' }}>
            Guardar nombre
          </button>
        </form>

        <dl className="mt-6 pt-6 border-t space-y-3 text-sm" style={{ borderColor: 'var(--line)' }}>
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
  );
}
