'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Building2, UserPlus, Shuffle, TriangleAlert, CheckCircle2 } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// Las tres formas de /admin/vendedores — mismo patrón que
// `dashboard/usuarios/forma.tsx`: `useActionState` + `useFormStatus`, el
// error de captura sale VERBATIM (los `DatoInvalido` se escribieron para
// leerse aquí), y los catálogos llegan como PROPS para no importar nada que
// arrastre `supabaseAdmin` al bundle.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton({ icono, texto, textoPendiente }: { icono: React.ReactNode; texto: string; textoPendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {icono}
      {pending ? textoPendiente : texto}
    </button>
  );
}

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

/** Alta manual de un prospecto. Solo la empresa es obligatoria: el censo
 *  trae filas con puro nombre y vacante, y el resto se completa vendiendo. */
export function FormaProspecto({ accion, vendedores }: {
  accion: AccionForma;
  vendedores: Array<{ id: string; nombre: string }>;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="pr-empresa" className={ETIQUETA}>Empresa</label>
          <input id="pr-empresa" name="empresa" type="text" required maxLength={160}
            placeholder="Transportes del Norte SA" className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="pr-vacante" className={ETIQUETA}>Vacante (la señal)</label>
          <input id="pr-vacante" name="vacante" type="text" maxLength={160}
            placeholder="Analista de liquidaciones" className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            El puesto que la empresa publicó: es el dolor nombrado por ellos mismos.
          </p>
        </div>
        <div>
          <label htmlFor="pr-contacto" className={ETIQUETA}>Contacto (opcional)</label>
          <input id="pr-contacto" name="contacto" type="text" maxLength={120}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="pr-telefono" className={ETIQUETA}>Teléfono (opcional)</label>
          <input id="pr-telefono" name="telefono" type="text" maxLength={40} inputMode="tel"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="pr-correo" className={ETIQUETA}>Correo (opcional)</label>
          <input id="pr-correo" name="correo" type="email" maxLength={160}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="pr-ciudad" className={ETIQUETA}>Ciudad (opcional)</label>
          <input id="pr-ciudad" name="ciudad" type="text" maxLength={120}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="pr-vendedor" className={ETIQUETA}>Vendedor (opcional)</label>
          <select id="pr-vendedor" name="vendedor" defaultValue=""
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Sin asignar — lo toma el asignador</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pr-notas" className={ETIQUETA}>Notas (opcional)</label>
          <input id="pr-notas" name="notas" type="text" maxLength={2000}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton icono={<Building2 width={14} height={14} strokeWidth={1.75} />} texto="Agregar prospecto" textoPendiente="Agregando…" />
    </form>
  );
}

/** Alta de un vendedor (cuenta de LIKIDA, tenant null). Sin teléfono a
 *  propósito: el vendedor no habla con el bot de ninguna flota. */
export function FormaInvitarVendedor({ accion }: { accion: AccionForma }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="vd-email" className={ETIQUETA}>Correo</label>
          <input id="vd-email" name="email" type="email" required maxLength={160}
            placeholder="amigo@correo.com" className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Entra a /vendedor tecleando este correo en el login — le llega un
            enlace mágico, sin contraseña.
          </p>
        </div>
        <div>
          <label htmlFor="vd-nombre" className={ETIQUETA}>Nombre (opcional)</label>
          <input id="vd-nombre" name="nombre" type="text" maxLength={120}
            placeholder="Como quieres verlo en el tablero" className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
      </div>
      <Aviso estado={estado} />
      <Boton icono={<UserPlus width={14} height={14} strokeWidth={1.75} />} texto="Invitar vendedor" textoPendiente="Invitando…" />
    </form>
  );
}

/** El botón del agente asignador. El resultado dice cuántos repartió y a
 *  quiénes — o por qué no repartió nada, que también es un resultado. */
export function BotonRepartir({ accion }: { accion: AccionForma }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-2">
      <Boton icono={<Shuffle width={14} height={14} strokeWidth={1.75} />} texto="Repartir pendientes" textoPendiente="Repartiendo…" />
      <Aviso estado={estado} />
    </form>
  );
}
