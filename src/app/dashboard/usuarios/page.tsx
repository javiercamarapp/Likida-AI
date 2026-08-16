import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { provisionarUsuario } from '@/lib/auth/provisionar';
import { validarInvitacion, descifrarErrorProvision, ROLES_INVITABLES } from '@/lib/auth/invitar';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { VistaUsuarios, type UsuarioRow } from './vista';
import type { ResultadoForma } from './forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/usuarios';

async function getUsuarios(tenantId: string): Promise<UsuarioRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('app_user')
    .select('id, nombre, email, rol, telefono')
    .eq('tenant_id', tenantId)
    .order('rol');
  if (error) throw new Error(`getUsuarios: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id as string,
    nombre: (u.nombre as string) || null,
    // `app_user.email` existe desde la 0001 (not null unique) y lo escribe
    // `provisionarUsuario` — el comentario viejo de esta página decía que el
    // correo solo vivía en auth.users, y era falso. Se enseña porque un
    // invitado sin nombre sería un renglón imposible de distinguir.
    email: u.email as string,
    rol: u.rol as string,
    telefono: (u.telefono as string) || null,
  }));
}

/**
 * Usuarios & Roles (PASO 22) + invitar (D6, auditoría 4) — el equipo real de
 * esta flota, y por fin la puerta para que el dueño dé de alta a su propio
 * contralor sin pasar por Likida.
 *
 * ── DOS PUERTAS, como en /dashboard/clientes ──────────────────────────────
 *  · VER es área `administracion` (`puedeVerRuta`): superadmin y flota_admin.
 *  · INVITAR es `puedeAdministrar`: el mismo criterio de la RLS
 *    de las llaves (0093) — repartir acceso es CONTROL de la cuenta.
 *
 * LAS DOS SE VUELVEN A COMPROBAR DENTRO DEL SERVER ACTION: el rol del render
 * es el del momento en que se pintó, y una server action es un endpoint POST
 * alcanzable sin pasar por aquí. El `tenantId` va por CLOSURE desde la sesión
 * re-resuelta — NADA del formulario decide a qué flota entra el invitado.
 */
export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, userId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge equipo vacío: `null` y la vista dice que no se pudo
  // leer — una base caída no es "no hay cuentas".
  let usuarios: UsuarioRow[] | null;
  try {
    usuarios = await getUsuarios(tenantId);
  } catch {
    usuarios = null;
  }

  async function invitarUsuario(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver el equipo de la flota.' };
    if (!puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota invita usuarios al panel.' };
    }

    try {
      // La validación del navegador (required, type=email) avisa temprano;
      // ÉSTA es la que manda — rechaza `superadmin` aunque el select no lo
      // ofrezca (un POST directo puede pedir cualquier rol) y ataja el
      // teléfono corto ANTES de crear nada. Es la misma que prueba
      // `invitar.test.ts`.
      const v = validarInvitacion({
        email: String(fd.get('email') ?? ''),
        nombre: String(fd.get('nombre') ?? ''),
        rol: String(fd.get('rol') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
      });

      // El tenant es EL DE LA SESIÓN, por closure — jamás del formulario.
      await provisionarUsuario(s.tenantId, v.email, v.nombre, v.rol, v.telefono);

      revalidatePath(RUTA);
      // La verdad del flujo: `avisoInvitacion` (correo/avisos.ts) existe como
      // plantilla pero NADIE la emite todavía, así que prometer "le llegó una
      // invitación" sería mentira. Entra tecleando su correo en el login.
      const liga = process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai';
      return {
        ok: true,
        mensaje: `${v.email} ya puede entrar con su correo (enlace mágico). No le llega invitación ` +
          `por correo todavía — pásale tú la liga del panel: ${liga}`,
      };
    } catch (e) {
      // `provisionarUsuario` lanza Error genérico, no DatoInvalido, y
      // `mensajeParaPantalla` lo generizaría a "falla del sistema". Los dos
      // errores que SÍ son de captura (correo ya registrado, WhatsApp
      // repetido) se traducen por patrón a DatoInvalido para salir VERBATIM;
      // el resto sigue el camino normal (log + genérico honesto).
      return { ok: false, error: mensajeParaPantalla(descifrarErrorProvision(e) ?? e, 'invitar al usuario') };
    }
  }

  return (
    <VistaUsuarios
      usuarios={usuarios}
      userId={userId}
      puedeInvitar={puedeAdministrar(rol)}
      // Como PROP y no como import del componente cliente — ver forma.tsx.
      roles={ROLES_INVITABLES}
      invitar={invitarUsuario}
    />
  );
}
