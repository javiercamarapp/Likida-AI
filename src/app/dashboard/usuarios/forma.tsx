'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { UserPlus, TriangleAlert, CheckCircle2 } from 'lucide-react';
// SOLO TIPOS: el catálogo `ROLES_INVITABLES` viaja como PROP desde la página
// (mismo patrón que `MODOS_TARIFA` en /dashboard/clientes). `invitar.ts` hoy
// no importa `supabaseAdmin`, pero importa `errores.ts` → `logger`, y un
// import de valor ataría este bundle a lo que ese árbol importe mañana.
import type { OpcionRol } from '@/lib/auth/invitar';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <UserPlus width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Invitando…' : 'Invitar'}
    </button>
  );
}

/** El aviso del resultado. El error sale VERBATIM: los `DatoInvalido` están
 *  escritos para leerse aquí y son lo único que dice QUÉ corregir. */
function Aviso({ estado }: { estado: ResultadoForma }) {
  if (!estado) return null;
  return estado.ok ? (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.mensaje}
    </div>
  ) : (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.error}
    </div>
  );
}

/**
 * Invitar a alguien del equipo. Solo ALTA, sin `id` oculto: cambiar rol y dar
 * de baja no existen todavía (`app_user` no tiene columna para desactivar), y
 * un formulario que fingiera editar prometería algo que la base no sabe hacer.
 *
 * El tenant NO viaja en el formulario, ni oculto: el server action lo saca de
 * la sesión re-resuelta. Aquí solo se captura QUIÉN entra, no A DÓNDE.
 */
export function FormaInvitar({ accion, roles }: {
  accion: AccionForma;
  roles: ReadonlyArray<OpcionRol>;
}) {
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="inv-email" className={ETIQUETA}>Correo</label>
          <input id="inv-email" name="email" type="email" required maxLength={160}
            placeholder="contralor@tuflota.mx"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Es su llave de entrada: en el panel teclea este correo y le llega un
            enlace mágico — no hay contraseña que inventarle.
          </p>
        </div>

        <div>
          <label htmlFor="inv-nombre" className={ETIQUETA}>Nombre (opcional)</label>
          <input id="inv-nombre" name="nombre" type="text" maxLength={120}
            placeholder="Como quieres verlo en la lista"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="inv-rol" className={ETIQUETA}>Rol</label>
          {/* `contador` primero y por default: es el caso por el que existe
              esta pantalla (D6). Arrancar en `flota_admin` repartiría control
              total de la cuenta por pura inercia del que no cambia el select. */}
          <select id="inv-rol" name="rol" required defaultValue="contador"
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            {roles.map((r) => (
              <option key={r.valor} value={r.valor}>{r.rotulo}</option>
            ))}
          </select>
          {/* La ayuda dice la VERDAD de visibilidad.ts, no marketing: qué ve
              y qué NO ve cada rol es exactamente lo que el dueño necesita
              saber antes de repartir accesos. */}
          <div className={AYUDA} style={{ color: 'var(--faint)' }}>
            {roles.map((r) => (
              <p key={r.valor} className="m-0 mt-0.5">
                <strong>{r.rotulo}:</strong> {r.detalle}
              </p>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="inv-telefono" className={ETIQUETA}>WhatsApp (opcional)</label>
          <input id="inv-telefono" name="telefono" type="text" maxLength={20}
            placeholder="10 dígitos" inputMode="tel"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Para que el bot la reconozca cuando escriba por WhatsApp (avisos
            contestables, despacho por chat). Sin número, el bot no la reconoce.
          </p>
        </div>
      </div>

      <Aviso estado={estado} />
      <Boton />
    </form>
  );
}
