import { requireSuperadmin } from '@/lib/auth/guard';
import { provisionarUsuario, type RolAppUser } from '@/lib/auth/provisionar';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const ROLES: Array<{ valor: RolAppUser; etiqueta: string }> = [
  { valor: 'flota_admin', etiqueta: 'Dueño (flota_admin) — control total de su flota' },
  { valor: 'encargado', etiqueta: 'Encargado — asigna viajes, exporta, sin facturación' },
  { valor: 'contador', etiqueta: 'Contador — solo lectura y exportar' },
  { valor: 'operador', etiqueta: 'Chofer (operador) — solo sus propios viajes' },
];

/**
 * Reemplaza el script `scripts/tmp-provisionar-*.ts` que hasta hoy había que
 * escribir y correr a mano cada vez — usa la misma `provisionarUsuario` que
 * ya está probada (provisionar.test.ts). El botón "+ Nuevo Agente" de la
 * referencia no tenía equivalente real en Likida (no hay agentes que un
 * superadmin cree); esto sí es una tarea real y recurrente.
 */
export default async function NuevoUsuario() {
  await requireSuperadmin();
  const { flotas } = await getResumenNegocio();

  async function crear(formData: FormData) {
    'use server';
    await requireSuperadmin();
    const tenantId = String(formData.get('tenantId') ?? '');
    const email = String(formData.get('email') ?? '').trim();
    const nombre = String(formData.get('nombre') ?? '').trim() || undefined;
    const rol = formData.get('rol') as RolAppUser;
    if (!tenantId || !email || !rol) redirect('/admin/usuarios/nuevo?error=1');
    await provisionarUsuario(tenantId, email, nombre, rol);
    redirect('/admin?creado=1');
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center px-5">
        <span className="text-sm font-medium">Nuevo usuario</span>
      </header>
      <main className="max-w-md">
        <form action={crear} className="glass-panel p-6 space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Flota</label>
            <select name="tenantId" required className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Correo</label>
            <input name="email" type="email" required placeholder="persona@flota.com"
              className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Nombre (opcional)</label>
            <input name="nombre" type="text" className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Rol</label>
            <select name="rol" required defaultValue="flota_admin" className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full text-sm px-4 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-85"
            style={{ background: 'var(--ink)', color: 'white' }}>
            Crear usuario
          </button>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Crea la cuenta de Auth y la fila en app_user (mismo camino que el script manual). El primer login (magic link) confirma la cuenta.
          </p>
        </form>
      </main>
    </div>
  );
}
