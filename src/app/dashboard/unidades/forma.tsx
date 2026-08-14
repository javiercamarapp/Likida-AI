'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';
// SOLO TIPOS de `operacion.ts` — misma restricción real que clientes/forma.tsx:
// ese módulo importa `supabaseAdmin`, cuyo encabezado prohíbe acabar en código
// de cliente. Un import de VALOR arrastraría la llave de servicio al bundle
// del navegador; los `import type` se borran al compilar.
import type { UnidadCruda } from '@/lib/likida/operacion';

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
 *  `DatoInvalido` de `validarUnidad` están escritos para leerse aquí. */
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
 * Alta y edición de una unidad, EL MISMO formulario (patrón de clientes).
 *
 * `id` vacío = alta. El `id` oculto dice QUÉ fila, nunca DE QUIÉN: el server
 * action re-resuelve el tenant de la sesión y `editarUnidad` ancla el UPDATE
 * con `.eq('tenant_id', ...)` Y comprueba filas afectadas — el id de una
 * unidad de otra flota sale como error, no como "guardado".
 *
 * CERO CAMPOS DE DINERO a propósito: esta página es del área `operacion` y
 * `dinero_por_area.test.ts` vigila que ahí no se pinte un peso.
 */
export function FormaUnidad({ accion, id = '', inicial, idPrefijo }: {
  accion: AccionForma;
  id?: string;
  inicial: UnidadCruda;
  /** Prefijo para los `id` del DOM: esta forma se repite por unidad y dos
   *  `<label for="placas">` en la misma página apuntan al primero. */
  idPrefijo: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="space-y-3">
      <input type="hidden" name="id" value={id} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={campo('eco')} className={ETIQUETA}>Número económico</label>
          <input id={campo('eco')} name="numeroEconomico" type="text" required maxLength={40}
            defaultValue={inicial.numeroEconomico} placeholder="47, T-102…"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
          <p className={AYUDA} style={{ color: 'var(--faint)' }}>
            Como la flota la llama en la radio y en el papel. No se puede repetir.
          </p>
        </div>

        <div>
          <label htmlFor={campo('placas')} className={ETIQUETA}>Placas</label>
          <input id={campo('placas')} name="placas" type="text" maxLength={20}
            defaultValue={inicial.placas} placeholder="Opcional"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('marca')} className={ETIQUETA}>Marca</label>
          <input id={campo('marca')} name="marca" type="text" maxLength={60}
            defaultValue={inicial.marca} placeholder="Kenworth"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('modelo')} className={ETIQUETA}>Modelo</label>
          <input id={campo('modelo')} name="modelo" type="text" maxLength={60}
            defaultValue={inicial.modelo} placeholder="T680"
            className={CAMPO} style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor={campo('anio')} className={ETIQUETA}>Año</label>
          <input id={campo('anio')} name="anio" type="number" min={1950} step={1}
            defaultValue={inicial.anio} placeholder="Déjalo vacío si no lo sabes"
            className={`${CAMPO} cifra-mono`} style={{ background: 'var(--surface)' }} />
        </div>
      </div>

      {/* ── LAS TRES VIGENCIAS DE LEY ─────────────────────────────────────
          En su propio bloque porque son de otra naturaleza: lo de arriba
          identifica al camión, esto decide si HOY puede salir a carretera.
          Vacío = sin capturar, y la unidad sale como "sin papeles" — nunca
          como vigente, que sería inventar que está en regla. */}
      <fieldset className="pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
        <legend className="etiqueta-mono text-[10px] uppercase mb-2.5" style={{ color: 'var(--faint)' }}>
          Vigencias · opcionales
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor={campo('poliza')} className={ETIQUETA}>Póliza vence</label>
            <input id={campo('poliza')} name="polizaVence" type="date"
              defaultValue={inicial.polizaVence}
              className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label htmlFor={campo('sict')} className={ETIQUETA}>Permiso SICT vence</label>
            <input id={campo('sict')} name="permisoSictVence" type="date"
              defaultValue={inicial.permisoSictVence}
              className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label htmlFor={campo('verif')} className={ETIQUETA}>Verificación vence</label>
            <input id={campo('verif')} name="verificacionVence" type="date"
              defaultValue={inicial.verificacionVence}
              className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
        </div>
        <p className={AYUDA} style={{ color: 'var(--faint)' }}>
          Con las fechas capturadas, Likida avisa cuál papel vence primero — antes de que lo haga un inspector.
        </p>
      </fieldset>

      <Aviso estado={estado} />
      <Boton etiqueta={id ? 'Guardar cambios' : 'Dar de alta'} />
    </form>
  );
}
