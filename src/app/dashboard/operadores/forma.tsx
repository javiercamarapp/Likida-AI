'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, UserPlus } from 'lucide-react';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

/** Lo que ya tiene el operador — precarga el formulario de edición. Los
 *  cuatro campos de licencia + RFC son los que faltaban (auditoría 2, A2):
 *  antes de esta pantalla, un dato mal tecleado en el alta se quedaba así
 *  para siempre. */
export interface OperadorCrudo {
  nombre: string;
  /** El WhatsApp con el que el bot lo reconoce. `''` = sin capturar, y
   *  entonces ese chofer NO puede reportar un gasto (FE-4). */
  telefono: string;
  numeroEmpleado: string;
  licencia: string;
  licenciaTipo: string;
  /** ISO `AAAA-MM-DD`, o `''` = no capturada. */
  licenciaVence: string;
  rfc: string;
  /** ¿Sigue trabajando en la flota? (auditoría 20, H2). */
  activo: boolean;
  /** El patio al que pertenece (W2), o `''` = sin patio. */
  terminalId?: string;
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

/** El aviso del resultado — el UNICO del panel (`admin/ui/aviso-resultado`). El
 *  error sale VERBATIM: los `DatoInvalido` de `actualizarOperador` están escritos
 *  para leerse aquí y son lo único que dice QUÉ corregir. */
const Aviso = AvisoResultado;

/** Un patio, como llega del servidor: solo id y nombre. */
export interface PatioOpcion { id: string; nombre: string }

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
export function FormaOperador({ accion, operadorId, inicial, idPrefijo, patios = [], patioFijo = false }: {
  accion: AccionForma;
  operadorId: string;
  inicial: OperadorCrudo;
  /** Prefijo para los `id` del DOM: esta forma se repite por renglón y dos
   *  `<label for="licencia">` en la misma página apuntan al primero. */
  idPrefijo: string;
  /** Los patios de la flota (W2). Vacío = la flota no ha creado ninguno y el
   *  selector no se pinta. */
  patios?: PatioOpcion[];
  /** Un jefe con patio no puede mover al operador a otro patio: el selector se
   *  enseña bloqueado (el servidor lo vuelve a exigir). */
  patioFijo?: boolean;
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

        {/* ── EL TELÉFONO DE WHATSAPP (auditoría 24, FE-4) ─────────────────
            Faltaba, y era el hueco más caro de esta pantalla: el teléfono es
            la IDENTIDAD del chofer frente al bot, y un dígito mal tecleado en
            el alta lo dejaba sin poder reportar un solo gasto — sin forma de
            corregirlo salvo dando de baja al chofer y creándolo de nuevo, que
            parte su historial en dos.

            Se avisa de las dos consecuencias porque ninguna se ve desde aquí:
            el número viejo deja de funcionar en el acto, y el nuevo tiene que
            estar libre en la flota (`comprobarTelefonoLibre`). */}
        <div>
          <label htmlFor={campo('telefono')} className={ETIQUETA}>WhatsApp del operador</label>
          <input id={campo('telefono')} name="telefono" type="tel" required maxLength={25}
            defaultValue={inicial.telefono} placeholder="55 1234 5678"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Es con lo que el bot lo reconoce. Si lo cambias, el número anterior deja de funcionar de
            inmediato y el chofer tiene que escribir desde el nuevo.
          </p>
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

        {patios.length > 0 && (
          <div>
            <label htmlFor={campo('terminalId')} className={ETIQUETA}>Patio</label>
            <select id={campo('terminalId')} name="terminalId" defaultValue={inicial.terminalId ?? ''} disabled={patioFijo}
              className={CAMPO} style={{ background: 'var(--surface)' }}>
              <option value="">Sin patio</option>
              {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {patioFijo && <input type="hidden" name="terminalId" value={inicial.terminalId ?? ''} />}
            <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
              {patioFijo ? 'Solo quien administra la flota mueve a un operador de patio.' : 'Con el patio, su jefe de tráfico lo ve y lo corrige.'}
            </p>
          </div>
        )}

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

      {/* ── LA BAJA DEL CHOFER (auditoría 20, H2; W2) ─────────────────────────
          Antes era un checkbox «Operador activo» que se desmarcaba y se guardaba:
          un gesto que corta el acceso de una PERSONA al canal de la flota sin
          decir cuántos efectos tiene. Ahora es un botón con su diálogo, que los
          dice: el bot deja de atenderlo como operador de la flota, sale de los
          buscadores de Despacho y su teléfono queda libre para otra flota. Su
          historial de viajes y liquidaciones se conserva completo — no se borra
          nada. Reactivar no necesita diálogo: devuelve, no corta. */}
      <Aviso estado={estado} />
      <div className="flex flex-wrap items-center gap-2">
        <Boton />
        {inicial.activo ? (
          <BotonConfirmar
            etiqueta="Dar de baja" tono="peligro" nombreConfirmar="accion" valorConfirmar="baja"
            titulo={`Dar de baja a ${inicial.nombre}`}
            descripcion="Deja de recibir mensajes del bot como operador de tu flota, sale de los buscadores de Despacho y su teléfono queda libre para darlo de alta en otra flota. Su historial de viajes y liquidaciones se conserva completo: no se borra nada."
            etiquetaConfirmar="Sí, dar de baja"
            className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors hover:bg-[var(--badbg)]"
            style={{ color: 'var(--bad)', border: '1px solid var(--line)' }}
          />
        ) : (
          <button type="submit" name="accion" value="reactivar"
            className="hairline h-9 px-4 rounded-lg text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]">
            Reactivar operador
          </button>
        )}
      </div>
    </form>
  );
}


/**
 * El alta de UN operador, en su propia pantalla (W2). La guía de arranque mandaba
 * a dar de alta al primer operador a esta pantalla y aquí solo se editaba: el
 * alta rápida vivía escondida en Despacho. Mismo `crearOperador` que Despacho y
 * que el importador: un teléfono que uno acepta, los otros también.
 */
export function FormaAltaOperador({ accion, patios = [], terminalFijo = null }: {
  accion: AccionForma;
  patios?: PatioOpcion[];
  /** Un jefe con patio da de alta SOLO en el suyo (nombre del patio). */
  terminalFijo?: string | null;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="alta-op-nombre" className={ETIQUETA}>Nombre</label>
          <input id="alta-op-nombre" name="nombre" type="text" required minLength={3} maxLength={120}
            autoComplete="off" className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>
        <div>
          <label htmlFor="alta-op-telefono" className={ETIQUETA}>WhatsApp del operador</label>
          <input id="alta-op-telefono" name="telefono" type="tel" required maxLength={25} autoComplete="off"
            placeholder="55 1234 5678" className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Es con lo que el bot lo reconoce: desde este número tiene que escribirle a Likida.
          </p>
        </div>
        <div>
          <label htmlFor="alta-op-empleado" className={ETIQUETA}>Nº de empleado (opcional)</label>
          <input id="alta-op-empleado" name="numeroEmpleado" type="text" maxLength={40}
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
        {(patios.length > 0 || terminalFijo) && (
          <div>
            <label htmlFor="alta-op-patio" className={ETIQUETA}>Patio</label>
            {terminalFijo ? (
              <p id="alta-op-patio" className="flex h-9 items-center text-[13px]" style={{ color: 'var(--muted)' }}>{terminalFijo}</p>
            ) : (
              <select id="alta-op-patio" name="terminalId" defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
                <option value="">Sin patio</option>
                {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      <Aviso estado={estado} />
      <BotonAlta />
    </form>
  );
}

function BotonAlta() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <UserPlus width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Dando de alta…' : 'Dar de alta'}
    </button>
  );
}
