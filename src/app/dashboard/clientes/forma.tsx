'use client';

import { useActionState } from 'react';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';
// SOLO TIPOS DE `clientes.ts`, y es una restricción real, no un gusto: ese
// módulo importa `supabaseAdmin`, cuyo encabezado dice textualmente "NUNCA
// importar en código de cliente". Un `import` de valor (por ejemplo del
// catálogo `MODOS_TARIFA`) arrastraría la llave de servicio al bundle del
// navegador aunque el componente no la use. Los `import type` se borran al
// compilar; el catálogo viaja como PROP desde la página, que sí es servidor.
import type { ClienteCrudo, TarifaCruda } from '@/lib/likida/clientes';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton({ etiqueta }: { etiqueta: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Guardando…' : etiqueta}
    </button>
  );
}

/** El aviso del resultado del servidor. El de error se enseña VERBATIM: los
 *  `DatoInvalido` del motor están escritos para leerse aquí y son lo único que
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

/**
 * Un bloque que se abre. `<details>` nativo y no `useState` a propósito: sin
 * JavaScript sigue abriendo, y una pantalla con 40 clientes tendría 40 estados
 * de React vivos para no enseñar nada.
 */
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

// ── Cliente ────────────────────────────────────────────────────────────────

/**
 * Alta y edición de un cliente, EL MISMO formulario.
 *
 * `id` vacío = alta. Y el `id` viaja en un campo oculto sin que eso sea un
 * agujero: el server action NO saca de aquí el tenant —lo re-resuelve de la
 * sesión— y el UPDATE va anclado con `.eq('tenant_id', ...)`, así que el id de
 * un cliente de otra flota no encuentra fila y sale como error, no como
 * "guardado". El campo oculto dice QUÉ fila, nunca DE QUIÉN.
 */
export function FormaCliente({ accion, id = '', inicial, idPrefijo }: {
  accion: AccionForma;
  id?: string;
  inicial: ClienteCrudo;
  /** Prefijo para los `id` del DOM: esta forma se repite por renglón y dos
   *  `<label for="nombre">` en la misma página apuntan al primero. */
  idPrefijo: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="id" value={id} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor={campo('nombre')} className={ETIQUETA}>Nombre o razón social</label>
          <input id={campo('nombre')} name="nombre" type="text" required maxLength={120}
            defaultValue={inicial.nombre} placeholder="Cementos del Bajío S.A. de C.V."
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('rfc')} className={ETIQUETA}>RFC</label>
          <input id={campo('rfc')} name="rfc" type="text" maxLength={13}
            defaultValue={inicial.rfc} placeholder="Opcional"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Se le revisa el dígito verificador. Es el RFC con el que le vas a facturar.
          </p>
        </div>

        <div>
          <label htmlFor={campo('dias')} className={ETIQUETA}>Días de crédito</label>
          <input id={campo('dias')} name="diasCredito" type="number" min={0} max={365} step={1}
            defaultValue={inicial.diasCredito} placeholder="Déjalo vacío si no hay crédito pactado"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          {/* La distinción que sostiene la cobranza entera: vacío ≠ 0. */}
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Vacío = sin condiciones pactadas (sus facturas no llevan fecha de vencimiento).
            Un 0 significa contado.
          </p>
        </div>

        <div>
          <label htmlFor={campo('contacto')} className={ETIQUETA}>Contacto</label>
          <input id={campo('contacto')} name="contacto" type="text" maxLength={120}
            defaultValue={inicial.contacto} placeholder="Quién autoriza pagos"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('correo')} className={ETIQUETA}>Correo</label>
          <input id={campo('correo')} name="correo" type="email" maxLength={160}
            defaultValue={inicial.correo} placeholder="cuentasporpagar@empresa.com"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={campo('telefono')} className={ETIQUETA}>Teléfono</label>
          <input id={campo('telefono')} name="telefono" type="text" maxLength={40}
            defaultValue={inicial.telefono} placeholder="477 123 4567 ext. 210"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
        <input type="checkbox" name="activo" defaultChecked={inicial.activo} />
        Cliente activo
      </label>

      <Aviso estado={estado} />
      <Boton etiqueta={id ? 'Guardar cambios' : 'Dar de alta'} />
    </form>
  );
}

// ── Tarifa ─────────────────────────────────────────────────────────────────

export interface OpcionModo {
  valor: string;
  rotulo: string;
  unidad: string;
  detalle: string;
}

/**
 * Alta y edición de una tarifa.
 *
 * El precio es `type="text"` y no `type="number"` a propósito: un contralor
 * pega "28,500.50" desde su Excel y un input numérico lo descarta ENTERO al
 * enviar —queda vacío y el error que ve es "falta el precio"—, cuando el
 * validador del servidor sí sabe leer la coma y el separador de millares.
 */
export function FormaTarifa({
  accion, id = '', inicial, clienteNombre = '', idPrefijo, buscarCliente, totalClientes, modos,
}: {
  accion: AccionForma;
  id?: string;
  inicial: TarifaCruda;
  /** El nombre del cliente que `inicial.clienteId` nombra — llega resuelto
   *  desde la página para que el buscador arranque lleno sin catálogo. */
  clienteNombre?: string;
  idPrefijo: string;
  /** FE-12/FE-2: el catálogo de clientes YA NO viaja como `<option>`. Aquí
   *  había un `<select>` con TODOS los clientes activos, dentro de una forma
   *  que se pintaba POR CADA TARIFA — el catálogo entero repetido N veces.
   *  Ahora es el buscador del servidor (20 a la vez). */
  buscarCliente: BuscarCatalogo;
  /** Cuántos clientes activos hay (count exact); `null` = no se pudo contar. */
  totalClientes: number | null;
  modos: ReadonlyArray<OpcionModo>;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="moneda" value="MXN" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor={campo('cliente')} className={ETIQUETA}>Cliente</label>
          <ComboCatalogo tipo="cliente" name="clienteId" campoId={campo('cliente')}
            buscar={buscarCliente} aria-label="Cliente"
            etiquetaVacia="Tarifa de lista — aplica a cualquier cliente"
            valorInicial={inicial.clienteId || null} textoInicial={clienteNombre}
            total={totalClientes} className={CAMPO} estilo={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Una tarifa con cliente es negociada, y le gana a la de lista. Déjalo vacío para una
            tarifa de lista.
          </p>
        </div>

        <div>
          <label htmlFor={campo('origen')} className={ETIQUETA}>Origen</label>
          <input id={campo('origen')} name="origen" type="text" maxLength={120}
            defaultValue={inicial.origen} placeholder="Vacío = cualquiera"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('destino')} className={ETIQUETA}>Destino</label>
          <input id={campo('destino')} name="destino" type="text" maxLength={120}
            defaultValue={inicial.destino} placeholder="Vacío = cualquiera"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('modo')} className={ETIQUETA}>Cómo se cobra</label>
          <select id={campo('modo')} name="modo" defaultValue={inicial.modo}
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            {modos.map((m) => (
              <option key={m.valor} value={m.valor}>{m.rotulo}</option>
            ))}
          </select>
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            {modos.map((m) => `${m.rotulo}: ${m.detalle}`).join(' ')}
          </p>
        </div>

        <div>
          <label htmlFor={campo('precio')} className={ETIQUETA}>Precio (MXN)</label>
          <input id={campo('precio')} name="precio" type="text" inputMode="decimal" required
            defaultValue={inicial.precio} placeholder="28,500.00"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            En la unidad que elegiste arriba. Solo pesos: Likida todavía no convierte moneda.
          </p>
        </div>

        <div>
          <label htmlFor={campo('desde')} className={ETIQUETA}>Rige desde</label>
          <input id={campo('desde')} name="vigenteDesde" type="date" required
            defaultValue={inicial.vigenteDesde}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('hasta')} className={ETIQUETA}>Rige hasta</label>
          <input id={campo('hasta')} name="vigenteHasta" type="date"
            defaultValue={inicial.vigenteHasta}
            className={CAMPO} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Vacío = sin fecha de término. El último día pactado la tarifa todavía rige.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
        <input type="checkbox" name="activa" defaultChecked={inicial.activa} />
        Tarifa activa
      </label>

      <Aviso estado={estado} />
      <Boton etiqueta={id ? 'Guardar cambios' : 'Agregar tarifa'} />
    </form>
  );
}
