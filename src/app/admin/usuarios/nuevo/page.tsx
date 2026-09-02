import { requireSuperadmin } from '@/lib/auth/guard';
import { provisionarUsuario, type RolAppUser } from '@/lib/auth/provisionar';
import { descifrarErrorProvision } from '@/lib/auth/invitar';
import { ROTULOS_ROL } from '@/lib/auth/roles';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { UserPlus } from 'lucide-react';
import { BarraPagina } from '../../../dashboard/resumen-visual';
import { FormaConAviso, type ResultadoAccion } from '../../ui/forma';

export const dynamic = 'force-dynamic';

// H18/ADM-7 (auditoría 24): los rótulos salen de `lib/auth/roles.ts`. Aquí
// decían cosas que ninguna otra pantalla decía —«Encargado: asigna viajes,
// exporta, sin facturación» cuando el encargado NO ve un peso, «Contador:
// solo lectura» cuando el contador captura clientes y tarifas—, y una
// descripción falsa en el alta es cómo se reparte el rol equivocado.
const ROLES: Array<{ valor: RolAppUser; etiqueta: string }> = [
  { valor: 'flota_admin', etiqueta: `${ROTULOS_ROL.flota_admin.nombre} — ${ROTULOS_ROL.flota_admin.detalle}` },
  { valor: 'encargado', etiqueta: `${ROTULOS_ROL.encargado.nombre} — ${ROTULOS_ROL.encargado.detalle}` },
  { valor: 'contador', etiqueta: `${ROTULOS_ROL.contador.nombre} — ${ROTULOS_ROL.contador.detalle}` },
];
const ROLES_VALIDOS = new Set<string>(ROLES.map((r) => r.valor));

/**
 * Reemplaza el script `scripts/tmp-provisionar-*.ts` que hasta hoy había que
 * escribir y correr a mano cada vez — usa la misma `provisionarUsuario` que
 * ya está probada (provisionar.test.ts). El botón "+ Nuevo Agente" de la
 * referencia no tenía equivalente real en Likida (no hay agentes que un
 * superadmin cree); esto sí es una tarea real y recurrente.
 *
 * Anatomía de página (14-ago): BarraPagina + la forma en una tarjeta blanca
 * sobre el lienzo tenue (--g1).
 *
 * ── ADM-7 (auditoría 24): EL RESULTADO SE VE ──────────────────────────────
 * El éxito redirigía a `/admin?creado=1`, que /admin no lee, y los errores a
 * `?error=1`/`?error=2`, que este componente no recibía: se daba de alta al
 * equipo de un cliente A CIEGAS. Peor: `provisionarUsuario` corría sin
 * `try`, así que un correo ya registrado tiraba la página de error de Next y
 * se perdía todo lo capturado. Ahora es `useActionState` + `FormaConAviso`
 * —el patrón de /admin/flotas—, los inputs conservan lo escrito y el mensaje
 * de captura sale VERBATIM (`descifrarErrorProvision`).
 *
 * A diferencia de /dashboard/usuarios, aquí el «ese correo ya tiene cuenta»
 * SÍ se dice con todas sus letras: esta puerta es de Likida, no de un
 * cliente, y no hay un tercero a quien ocultárselo (SEG-7).
 */
export default async function NuevoUsuario() {
  await requireSuperadmin();
  const { flotas } = await getResumenNegocio();

  async function crear(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
    'use server';
    await requireSuperadmin();
    const tenantId = String(formData.get('tenantId') ?? '');
    const email = String(formData.get('email') ?? '').trim();
    const nombre = String(formData.get('nombre') ?? '').trim() || undefined;
    const rol = String(formData.get('rol') ?? '');
    if (!tenantId || !email || !rol) return { error: 'Faltan la flota, el correo o el rol.' };
    // AUDITORÍA 13, MEDIO: el `<select>` solo ofrece 3 roles (sin superadmin),
    // pero el POST directo podía pedir cualquiera. El superadmin se crea por
    // SQL directo. El chofer (`operador`) ya ni siquiera es un rol válido del
    // dominio (retirado el 7-ago-2026) — `rol` nunca puede llegar así aquí.
    //
    // ADM-12 (auditoría 24): se pasa de negar `superadmin` a EXIGIR uno de
    // los tres del catálogo. Con la lista negra, `rol=vendedor` entraba con
    // `tenant_id` — y un vendedor (0105) es personal de LIKIDA, que por
    // contrato va con tenant nulo (`provisionar.ts:18-19`).
    if (!ROLES_VALIDOS.has(rol)) {
      return { error: 'Elige uno de los tres roles de la lista. Superadmin y vendedor no se dan de alta desde aquí.' };
    }
    const telefono = String(formData.get('telefono') ?? '').trim() || undefined;
    try {
      await provisionarUsuario(tenantId, email, nombre, rol as RolAppUser, telefono);
    } catch (e) {
      // Los dos errores de captura (correo ya registrado, WhatsApp repetido)
      // se traducen por patrón para salir verbatim; el resto sigue el camino
      // normal (log + mensaje genérico honesto).
      return { error: mensajeParaPantalla(descifrarErrorProvision(e) ?? e, 'dar de alta al usuario') };
    }
    return { ok: `${email} quedó dado de alta. Entra tecleando su correo en el panel (enlace mágico).` };
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<UserPlus width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Nuevo usuario"
        />

        <div className="px-5 py-5 flex-1">
          <div className="card p-5 max-w-md">
            <FormaConAviso accion={crear} boton="Crear usuario" columnas="md:grid-cols-1">
              <div>
                <label className="text-sm font-medium block mb-1.5">Flota</label>
                <select name="tenantId" required className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }}>
                  {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Correo</label>
                <input name="email" type="email" required placeholder="persona@flota.com"
                  className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Nombre (opcional)</label>
                <input name="nombre" type="text" className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }} />
              </div>
              <div>
                {/* D5 (auditoría 4): la columna existía (0059), el matcher de
                    oficina la leía, y ningún alta la llenaba — la persona no
                    podía escribirle al bot sin un UPDATE a mano. */}
                <label className="text-sm font-medium block mb-1.5">WhatsApp (opcional)</label>
                <input name="telefono" type="text" placeholder="10 dígitos"
                  className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }} />
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Con él, el bot reconoce a esta persona cuando escribe (avisos contestables, despacho por chat).
                </p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Rol</label>
                <select name="rol" required defaultValue="flota_admin" className="w-full text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--canvas)' }}>
                  {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
                </select>
              </div>
            </FormaConAviso>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Crea la cuenta de Auth y la fila en app_user (mismo camino que el script manual). El primer login (magic link) confirma la cuenta.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
