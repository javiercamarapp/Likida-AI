'use client';

import { useActionState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LOS FORMULARIOS QUE DAN DE ALTA — y el aviso que dice por qué NO se pudo.
//
// Las cuatro operaciones de `administracion.ts` rechazan a propósito, y sus
// mensajes están escritos para enseñárselos a quien llenó el formulario: "ese
// teléfono ya está registrado en OTRA flota", "el RFC no pasa el dígito
// verificador". Un formulario que se los trague reintroduce EXACTAMENTE el modo
// de falla que esas funciones existen para impedir: el alta se ve hecha y no lo
// está, y eso no se descubre hasta que el dinero aparece en los libros de otra
// flota.
//
// POR QUÉ `useActionState` Y NO EL `redirect(?ok=)` DEL DESPACHO. Porque aquí
// el rechazo es el caso NORMAL, no la excepción. Un redirect vuelve a montar la
// página y con ella el formulario vacío: corregir un dígito del RFC obligaría a
// recapturar el alta entera, y quien la recaptura por tercera vez empieza a
// teclear cualquier cosa con tal de que pase. Sin navegación, los inputs no
// controlados conservan lo que la persona ya escribió y solo corrige el campo
// que se le señaló.
//
// El botón se deshabilita mientras corre. No es cosmético: `crearFlota` no es
// idempotente, y el doble clic en una red lenta da de alta la flota dos veces.
// ═══════════════════════════════════════════════════════════════════════════

/** `null` = todavía no se ha enviado nada. Nunca las dos llaves a la vez. */
export type ResultadoAccion =
  | { ok: string; error?: undefined }
  | { error: string; ok?: undefined }
  | null;

/** La firma que tienen que tener los server actions de estas pantallas. */
export type AccionDeForma = (
  previo: ResultadoAccion,
  datos: FormData,
) => Promise<ResultadoAccion>;

const CONTROL = {
  background: 'var(--canvas)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
} as const;

export function FormaConAviso({
  accion,
  boton,
  children,
  columnas = 'md:grid-cols-3',
}: {
  accion: AccionDeForma;
  boton: string;
  children: React.ReactNode;
  /** Clases de columnas del grid de campos. Una lista larga usa `md:grid-cols-1`. */
  columnas?: string;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);

  return (
    <form action={enviar} className="flex flex-col gap-3">
      <div className={`grid grid-cols-1 ${columnas} gap-3`}>{children}</div>
      <Aviso estado={estado} />
      <div>
        <button
          type="submit"
          disabled={pendiente}
          className="text-sm font-medium rounded-lg px-4 py-2 w-full md:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}
        >
          {pendiente ? 'Guardando…' : boton}
        </button>
      </div>
    </form>
  );
}

/**
 * El contenedor se pinta SIEMPRE, aunque esté vacío. Un `aria-live` que aparece
 * junto con su texto no se anuncia: el lector de pantalla necesita que la región
 * ya exista para notar que cambió. Como el aviso llega sin cambiar de página,
 * sin esto un usuario ciego no se entera de que el alta fue rechazada.
 */
export function Aviso({ estado }: { estado: ResultadoAccion }) {
  return (
    <div aria-live="polite">
      {estado && (
        <div
          className="flex items-start gap-2.5 text-sm rounded-lg px-3 py-2.5"
          style={{
            background: estado.error ? 'var(--badbg)' : 'var(--okbg)',
            color: estado.error ? 'var(--bad)' : 'var(--ok)',
          }}
        >
          {/* Nunca color solo: el icono y el texto dicen lo mismo que el matiz. */}
          {estado.error ? (
            <AlertTriangle width={16} height={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          ) : (
            <Check width={16} height={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          )}
          <span>{estado.error ?? estado.ok}</span>
        </div>
      )}
    </div>
  );
}

export function Campo({
  nombre,
  etiqueta,
  tipo = 'text',
  placeholder,
  requerido,
  valorInicial,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  placeholder?: string;
  requerido?: boolean;
  valorInicial?: string;
  ayuda?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={nombre} className="text-xs" style={{ color: 'var(--muted)' }}>
        {etiqueta}
        {requerido && <span aria-hidden> *</span>}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        placeholder={placeholder}
        defaultValue={valorInicial}
        step={tipo === 'number' ? '0.01' : undefined}
        min={tipo === 'number' ? '0' : undefined}
        className="text-sm rounded-lg px-2.5 py-2"
        style={CONTROL}
      />
      {ayuda && (
        <span className="text-xs" style={{ color: 'var(--faint)' }}>
          {ayuda}
        </span>
      )}
    </div>
  );
}

export function Selector({
  nombre,
  etiqueta,
  opciones,
  valorInicial,
  requerido,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  opciones: Array<{ valor: string; texto: string }>;
  valorInicial?: string;
  requerido?: boolean;
  ayuda?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={nombre} className="text-xs" style={{ color: 'var(--muted)' }}>
        {etiqueta}
        {requerido && <span aria-hidden> *</span>}
      </label>
      <select
        id={nombre}
        name={nombre}
        required={requerido}
        defaultValue={valorInicial ?? ''}
        className="text-sm rounded-lg px-2.5 py-2"
        style={CONTROL}
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      {ayuda && (
        <span className="text-xs" style={{ color: 'var(--faint)' }}>
          {ayuda}
        </span>
      )}
    </div>
  );
}

export { CONTROL as ESTILO_CONTROL };
