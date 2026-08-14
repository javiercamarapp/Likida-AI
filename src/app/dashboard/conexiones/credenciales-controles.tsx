'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Vault, TriangleAlert } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPTURA DE CREDENCIALES (C2, auditoría 4) — la mitad CLIENTE.
//
// El catálogo llega como PROP serializable (id, nombre y la FORMA de cada
// campo), nunca importando `registro.ts` con valor: aunque el catálogo es
// puro, sus fichas (`probar()`, fuentes, ayuda de venta) no tienen nada que
// hacer en el bundle del navegador — al cliente solo viaja lo que la forma
// pinta. Misma decisión que `AREAS_DE_LLAVE` en llaves-api.
//
// El secreto hace UN viaje: de este input a la server action, y de ahí al
// cofre. No se refleja en estado de React ni vuelve en la respuesta.
// ═══════════════════════════════════════════════════════════════════════════

/** La FORMA de un campo, sin el valor — espejo serializable de
 *  `CampoCredencial` (tipos.ts). */
export interface CampoCaptura {
  clave: string;
  rotulo: string;
  forma: 'texto' | 'url' | 'secreto' | 'correo';
  requerida: boolean;
  ayuda: string;
  ejemplo?: string;
}

export interface ConectorCaptura {
  id: string;
  nombre: string;
  campos: CampoCaptura[];
}

/** Un grupo del select: ERP / Peajes. Los GPS no vienen — tienen su propio
 *  almacén (`rastreo_credencial`) y su propio flujo. */
export interface GrupoCaptura {
  categoria: string;
  conectores: ConectorCaptura[];
}

export type ResultadoCredencial =
  | { ok: true; mensaje: string }
  | { ok: false; error: string }
  | null;
export type AccionCredencial = (previo: ResultadoCredencial, fd: FormData) => Promise<ResultadoCredencial>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

/** input type por forma: el `password` es lo que evita que el secreto quede a
 *  la vista (y en el autocompletado) mientras se teclea. */
const TIPO_INPUT: Record<CampoCaptura['forma'], string> = {
  texto: 'text', url: 'url', secreto: 'password', correo: 'email',
};

function AvisoError({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {error}
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Vault width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Guardando…' : 'Guardar en el cofre'}
    </button>
  );
}

/**
 * El select de sistema y sus campos dinámicos. Los campos cambian con el
 * conector elegido — por eso esto es cliente y no un form estático.
 */
export function FormaCredenciales({ grupos, guardar }: {
  grupos: GrupoCaptura[];
  guardar: AccionCredencial;
}) {
  const [estado, despachar] = useActionState(guardar, null);
  const [elegido, setElegido] = useState('');
  const conector = grupos.flatMap((g) => g.conectores).find((c) => c.id === elegido) ?? null;

  // Tras guardar, la forma se VACÍA (el `key` de abajo remonta los inputs):
  // el secreto no se queda tecleado en el DOM después de viajar al cofre.
  // Ajuste DURANTE el render y no en un efecto (patrón "adjusting state when
  // props change" de react.dev) — el lint del compilador prohíbe el setState
  // síncrono dentro de un useEffect.
  const [ultimoEstado, setUltimoEstado] = useState<ResultadoCredencial>(null);
  if (estado !== ultimoEstado) {
    setUltimoEstado(estado);
    if (estado?.ok) setElegido('');
  }

  return (
    <div className="space-y-3">
      {/* `key={elegido}`: cambiar de sistema TIRA los valores tecleados. Sin
          esto, el password de SAP sobreviviría en el input al cambiar a Odoo
          y viajaría al conector equivocado. */}
      <form action={despachar} className="space-y-3" key={elegido}>
        <div className="max-w-md">
          <label htmlFor="cred-conector" className={ETIQUETA}>Sistema</label>
          <select id="cred-conector" name="conector" value={elegido} required
            onChange={(e) => setElegido(e.target.value)}
            className={CAMPO} style={{ background: 'var(--surface)' }}>
            <option value="">Elige el sistema…</option>
            {grupos.map((g) => (
              <optgroup key={g.categoria} label={g.categoria}>
                {g.conectores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {conector && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {conector.campos.map((campo) => (
              <div key={campo.clave}>
                <label htmlFor={`cred-${campo.clave}`} className={ETIQUETA}>
                  {campo.rotulo}{campo.requerida ? '' : ' (opcional)'}
                </label>
                <input id={`cred-${campo.clave}`} name={`campo_${campo.clave}`}
                  type={TIPO_INPUT[campo.forma]} required={campo.requerida}
                  placeholder={campo.ejemplo} autoComplete="off"
                  className={CAMPO} style={{ background: 'var(--surface)' }} />
                <p className={AYUDA} style={{ color: 'var(--faint)' }}>{campo.ayuda}</p>
              </div>
            ))}
          </div>
        )}

        {estado && !estado.ok && <AvisoError error={estado.error} />}
        {estado?.ok && (
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{estado.mensaje}</p>
        )}
        {conector && <BotonGuardar />}
      </form>
    </div>
  );
}

/**
 * Desactivar, con confirmación en dos pasos SIN `confirm()` — mismo criterio
 * que `FormaRevocar` en llaves-api: el diálogo nativo bloquea headless y no
 * se puede mirar en un screenshot.
 */
export function FormaDesactivar({ conectorId, nombre, desactivar }: {
  conectorId: string;
  nombre: string;
  desactivar: AccionCredencial;
}) {
  const [estado, despachar] = useActionState(desactivar, null);
  return (
    <details>
      <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
        style={{ color: 'var(--bad)' }}>
        Desactivar
      </summary>
      <div className="pt-2 space-y-2">
        <p className="text-[11.5px] max-w-md" style={{ color: 'var(--muted)' }}>
          El acceso a {nombre} deja de estar disponible para conectar. Lo guardado no se borra
          —queda cifrado para la auditoría—; para volver a usarlo se captura de nuevo.
        </p>
        {estado && !estado.ok && <AvisoError error={estado.error} />}
        <form action={despachar}>
          <input type="hidden" name="conector" value={conectorId} />
          <BotonDesactivar />
        </form>
      </div>
    </details>
  );
}

function BotonDesactivar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 hairline transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ color: 'var(--bad)', background: 'var(--badbg)' }}>
      {pending ? 'Desactivando…' : 'Sí, desactivar este acceso'}
    </button>
  );
}
