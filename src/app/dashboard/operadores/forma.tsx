'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

/** Lo que ya tiene el operador — precarga el formulario de edición. Los
 *  cuatro campos de licencia + RFC son los que faltaban (auditoría 2, A2):
 *  antes de esta pantalla, un dato mal tecleado en el alta se quedaba así
 *  para siempre. */
export interface OperadorCrudo {
  nombre: string;
  numeroEmpleado: string;
  licencia: string;
  licenciaTipo: string;
  /** ISO `AAAA-MM-DD`, o `''` = no capturada. */
  licenciaVence: string;
  rfc: string;
  /** ¿Sigue trabajando en la flota? (auditoría 20, H2). */
  activo: boolean;
}

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Guardando…' : 'Guardar'}
    </button>
  );
}

/** El aviso del resultado. El error sale VERBATIM: los `DatoInvalido` de
 *  `actualizarOperador` están escritos para leerse aquí y son lo único que
 *  dice QUÉ corregir. */
function Aviso({ estado }: { estado: ResultadoForma }) {
  if (!estado) return null;
  return estado.ok ? (
    <div className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
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

/** Un bloque que se abre. `<details>` nativo y no `useState`: sin JavaScript
 *  sigue abriendo, y una pantalla con muchos operadores no arrastra un estado
 *  de React vivo por renglón para no enseñar nada (mismo patrón que
 *  `dashboard/clientes/forma.tsx`). */
export function Plegable({ resumen, children }: { resumen: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
        style={{ color: 'var(--marca)' }}>
        {resumen}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/**
 * Corregir la licencia, su vigencia y el RFC de un operador ya dado de alta —
 * la pantalla que faltaba (auditoría 2): `operadores/vista.tsx` solo leía, y
 * un chofer con la licencia mal tecleada o sin RFC se quedaba así para
 * siempre. SOLO EDITA: el alta rápida sigue viviendo en Despacho.
 *
 * El `operadorId` viaja en un campo oculto sin que eso sea un agujero: el
 * server action re-resuelve el tenant de la SESIÓN, no del formulario, y
 * `actualizarOperador` ancla el UPDATE con `.eq('tenant_id', ...)` y comprueba
 * cuántas filas tocó — el id de un operador de otra flota sale como error, no
 * como "guardado".
 */
export function FormaOperador({ accion, operadorId, inicial, idPrefijo }: {
  accion: AccionForma;
  operadorId: string;
  inicial: OperadorCrudo;
  /** Prefijo para los `id` del DOM: esta forma se repite por renglón y dos
   *  `<label for="licencia">` en la misma página apuntan al primero. */
  idPrefijo: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="operadorId" value={operadorId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={campo('nombre')} className={ETIQUETA}>Nombre</label>
          <input id={campo('nombre')} name="nombre" type="text" required minLength={3} maxLength={120}
            defaultValue={inicial.nombre}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('numeroEmpleado')} className={ETIQUETA}>Nº de empleado (opcional)</label>
          <input id={campo('numeroEmpleado')} name="numeroEmpleado" type="text" maxLength={40}
            defaultValue={inicial.numeroEmpleado}
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('rfc')} className={ETIQUETA}>RFC del operador (opcional)</label>
          <input id={campo('rfc')} name="rfc" type="text" maxLength={13}
            defaultValue={inicial.rfc} placeholder="GODE561231GR8"
            className={`${CAMPO} cifra-mono uppercase`} style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Sin él, un viático timbrado a su nombre se queda en revisar (RLISR 57) aunque el reglamento lo conceda.
          </p>
        </div>

        <div>
          <label htmlFor={campo('licencia')} className={ETIQUETA}>Licencia (opcional)</label>
          <input id={campo('licencia')} name="licencia" type="text" maxLength={40}
            defaultValue={inicial.licencia}
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('licenciaTipo')} className={ETIQUETA}>Tipo (opcional)</label>
          <input id={campo('licenciaTipo')} name="licenciaTipo" type="text" maxLength={10}
            defaultValue={inicial.licenciaTipo} placeholder="B, C, E…"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('licenciaVence')} className={ETIQUETA}>Vence (opcional)</label>
          <input id={campo('licenciaVence')} name="licenciaVence" type="date"
            defaultValue={inicial.licenciaVence}
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Vacío = sin registrar, no vencida.
          </p>
        </div>
      </div>

      {/* ── LA BAJA DEL CHOFER (auditoría 20, H2) ─────────────────────────────
          Mismo checkbox que `/dashboard/clientes` usa para "Cliente activo" —
          es el patrón que este panel ya resolvió, y una segunda invención
          (un botón rojo, un modal) enseñaría dos gestos para la misma idea.

          Se explica QUÉ pasa al desmarcarlo porque las tres consecuencias son
          invisibles desde aquí: el bot deja de contestarle, desaparece de los
          combos de despacho, y su teléfono queda libre para otra flota. */}
      <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
        <input type="checkbox" name="activo" defaultChecked={inicial.activo} />
        Operador activo
      </label>
      <p className="text-[11px] -mt-1.5" style={{ color: 'var(--faint)' }}>
        Desmárcalo cuando el chofer deje de trabajar contigo: el bot de WhatsApp deja de atenderlo como
        operador de tu flota, sale de los buscadores de Despacho y su teléfono queda libre para darlo de
        alta en otra flota. Su historial de viajes y liquidaciones se conserva completo — no se borra nada.
      </p>

      <Aviso estado={estado} />
      <Boton />
    </form>
  );
}
