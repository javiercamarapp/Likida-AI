import { redirect } from 'next/navigation';
import { UserRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import AvatarUploader from '../../admin/mi-perfil/avatar-uploader';
import { BarraPagina } from '../resumen-visual';
import { sufijoTenant } from '../sufijo';

export const dynamic = 'force-dynamic';

const ROL_LABEL: Record<string, string> = {
  superadmin: 'Superadmin',
  flota_admin: 'Dueño / Admin de flota',
  encargado: 'Encargado',
  contador: 'Contador',
  operador: 'Operador / Chofer',
};

/** Tipos de imagen que el bucket acepta. Un `.svg` puede traer script
 *  adentro y el bucket `avatares` es PÚBLICO — servirlo desde nuestro
 *  dominio sería XSS almacenado, así que no entra. */
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TOPE_BYTES = 2 * 1024 * 1024;

/**
 * MI PERFIL — el panel del cliente por fin edita su propio perfil.
 *
 * La migración 0046 dejó `app_user.avatar_url` y el bucket público
 * `avatares` desde el 12-ago, y su propio comentario decía que la columna
 * servía "el día que su propio panel tenga edición de perfil". Hasta hoy solo
 * la usaba Javier desde /admin/mi-perfil: el contralor de una flota veía su
 * inicial en un círculo y no tenía dónde cambiarla.
 *
 * Se reusa el `AvatarUploader` de /admin — mismo componente, no una copia
 * (una copia se desincroniza y termina siendo dos productos).
 *
 * SEGURIDAD: las dos server actions vuelven a exigir sesión ADENTRO y
 * escriben SIEMPRE contra el `userId` de esa sesión — nunca contra un id que
 * venga del formulario. El modo de falla #1 del código escrito por agentes es
 * IDOR, y un perfil editable es exactamente donde aparecería.
 */
export default async function MiPerfilFlota({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; tenant?: string; vista?: string; rol?: string }>;
}) {
  const s = await requireSessionTenant('/dashboard/mi-perfil');
  const sp = await searchParams;
  const sufijo = sufijoTenant(sp);

  const { data: fila } = await supabaseAdmin()
    .from('app_user').select('email').eq('id', s.userId).maybeSingle();

  /** El destino de vuelta, conservando el `?tenant=` del superadmin. */
  function volverA(estado: string) {
    return `/dashboard/mi-perfil${sufijo ? `${sufijo}&` : '?'}${estado}`;
  }

  async function actualizarNombre(formData: FormData) {
    'use server';
    // Re-gateo adentro: el `s` de arriba es del render, no de esta llamada.
    const { userId } = await requireSessionTenant('/dashboard/mi-perfil');
    const nombre = String(formData.get('nombre') ?? '').trim();
    if (!nombre) redirect(volverA('error=nombre'));
    // Tope de 80: la misma medida que la firma del Agente de Cobranza. Un
    // nombre de 4,000 caracteres rompe el sidebar y el PDF.
    if (nombre.length > 80) redirect(volverA('error=largo'));
    await supabaseAdmin().from('app_user').update({ nombre }).eq('id', userId);
    redirect(volverA('ok=nombre'));
  }

  async function subirAvatar(formData: FormData) {
    'use server';
    const { userId } = await requireSessionTenant('/dashboard/mi-perfil');
    const archivo = formData.get('avatar');
    if (!(archivo instanceof File) || archivo.size === 0) redirect(volverA('error=avatar'));
    if (!TIPOS.has(archivo.type)) redirect(volverA('error=tipo'));
    if (archivo.size > TOPE_BYTES) redirect(volverA('error=peso'));

    const admin = supabaseAdmin();
    // La extensión sale del TIPO validado, no del nombre del archivo: un
    // `foto.svg` renombrado a `.png` no debe decidir cómo se sirve.
    const ext = archivo.type === 'image/png' ? 'png' : archivo.type === 'image/webp' ? 'webp' : 'jpg';
    // La ruta la fija el servidor con el userId de la sesión — nada del
    // formulario toca el path, o se podría escribir sobre el avatar de otro.
    const ruta = `${userId}/avatar.${ext}`;
    const { error } = await admin.storage.from('avatares')
      .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
    if (error) redirect(volverA('error=avatar'));

    const { data: pub } = admin.storage.from('avatares').getPublicUrl(ruta);
    // `?t=` revienta el caché: la ruta pública no cambia entre subidas.
    await admin.from('app_user')
      .update({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` }).eq('id', userId);
    redirect(volverA('ok=avatar'));
  }

  const OK: Record<string, string> = {
    avatar: 'Foto de perfil actualizada.',
    nombre: 'Nombre guardado.',
  };
  const ERROR: Record<string, string> = {
    avatar: 'No se pudo subir la foto — intenta con otra imagen.',
    nombre: 'El nombre no puede quedar vacío.',
    largo: 'El nombre no puede pasar de 80 caracteres.',
    tipo: 'Solo se aceptan imágenes JPG, PNG o WebP.',
    peso: 'La imagen pasa de 2 MB — usa una más ligera.',
  };

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<UserRound width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Mi perfil"
        />

        <div className="px-5 py-5 flex-1">
          <div className="card p-6" style={{ maxWidth: 480 }}>
            {sp.ok && OK[sp.ok] && (
              <div className="flex items-center gap-2 text-[13px] px-3.5 py-2.5 rounded-lg mb-5"
                style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
                <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
                {OK[sp.ok]}
              </div>
            )}
            {sp.error && ERROR[sp.error] && (
              <div className="flex items-center gap-2 text-[13px] px-3.5 py-2.5 rounded-lg mb-5"
                style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
                <AlertTriangle width={15} height={15} strokeWidth={1.75} />
                {ERROR[sp.error]}
              </div>
            )}

            <AvatarUploader nombre={s.nombre ?? 'Tú'} avatarUrl={s.avatarUrl} accion={subirAvatar} />

            <form action={actualizarNombre} className="space-y-4 mt-6 pt-6 border-t" style={{ borderColor: 'var(--line)' }}>
              <div>
                <label htmlFor="perfil-nombre" className="text-[13px] font-medium block mb-1.5">Nombre</label>
                <input id="perfil-nombre" name="nombre" type="text" defaultValue={s.nombre ?? ''} required maxLength={80}
                  className="w-full text-[13px] px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
                <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                  Es el nombre con el que te ven tus compañeros de flota en el panel.
                </p>
              </div>
              <button type="submit" className="text-[13px] px-4 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-85"
                style={{ background: 'var(--marca)', color: 'white' }}>
                Guardar nombre
              </button>
            </form>

            <dl className="mt-6 pt-6 border-t space-y-3 text-[13px]" style={{ borderColor: 'var(--line)' }}>
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Correo</dt>
                <dd className="text-right">{(fila?.email as string) ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt style={{ color: 'var(--muted)' }}>Rol</dt>
                <dd className="text-right">{ROL_LABEL[s.rol] ?? s.rol}</dd>
              </div>
            </dl>
            <p className="text-[11px] mt-4" style={{ color: 'var(--faint)' }}>
              Correo y rol no se editan aquí: el correo está ligado a tu acceso (cambiarlo es un flujo
              de verificación aparte) y el rol lo asigna el dueño de la flota desde Usuarios.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
