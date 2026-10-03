'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, Check, Copy, ShieldAlert } from 'lucide-react';
// SOLO TIPOS de `llave-api-escritura.ts`: ese módulo importa `supabaseAdmin`,
// que no puede acabar en el bundle del navegador. El catálogo de áreas viaja
// como PROP desde la página, igual que `MODOS_TARIFA` en /dashboard/clientes.
import type { OpcionArea } from '@/lib/auth/llave-api-escritura';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';

/** El resultado del alta trae el SECRETO — es el único momento en que existe
 *  fuera de la base (y en la base solo vive su hash). */
export type ResultadoForma =
  | { ok: true; mensaje: string; secreto?: { enClaro: string; prefijo: string } }
  | { ok: false; error: string }
  | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';
const AYUDA = 'text-[11px] mt-1';

function Boton({ etiqueta, ocupado }: { etiqueta: string; ocupado: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <KeyRound width={14} height={14} strokeWidth={1.75} />
      {pending ? ocupado : etiqueta}
    </button>
  );
}

/** El error del servidor, VERBATIM, con el aviso único del panel. */
function AvisoError({ error }: { error: string }) {
  return <AvisoResultado estado={{ ok: false, error }} />;
}

/**
 * EL SECRETO, UNA VEZ. Este bloque es la única pantalla del producto donde la
 * llave completa existe: al recargar, navegar o emitir otra, se fue — en la
 * base solo queda su huella (SHA-256), y no hay endpoint que la devuelva.
 */
export function SecretoUnaVez({ enClaro }: { enClaro: string }) {
  const [copiado, setCopiado] = useState(false);

  function copiar() {
    void navigator.clipboard.writeText(enClaro).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  }

  return (
    <div className="rounded-lg hairline p-3.5 space-y-2" style={{ background: 'var(--warnbg)' }}>
      <div className="flex items-start gap-2 text-[12.5px] font-medium" style={{ color: 'var(--warn)' }}>
        <ShieldAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        Guárdala ahora. No se puede volver a ver: solo guardamos su huella.
      </div>
      <div className="flex items-center gap-2 rounded-lg hairline px-3 py-2" style={{ background: 'var(--surface)' }}>
        {/* `break-all` y no truncate: si el copiado falla, que al menos se
            pueda leer y transcribir completa. */}
        <code className="cifra-mono text-[12px] break-all flex-1">{enClaro}</code>
        <button type="button" aria-label="Copiar la llave" onClick={copiar}
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)]"
          style={{ color: copiado ? 'var(--ok)' : 'var(--muted)' }}>
          {copiado ? <Check width={14} height={14} strokeWidth={2} /> : <Copy width={14} height={14} strokeWidth={2} />}
        </button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        Se manda en cada petición como <code className="cifra-mono">Authorization: Bearer …</code>.
        Si se pierde o se filtra, revócala aquí y emite otra.
      </p>
    </div>
  );
}

/**
 * El alta. Tras emitir, el resultado ENSEÑA el secreto una vez (arriba); el
 * renglón nuevo de la lista solo trae la pista.
 */
export function FormaEmision({ accion, areas, vigencias, vigenciaDefault }: {
  accion: AccionForma;
  areas: ReadonlyArray<OpcionArea>;
  /** SEG-8: cuánto vale la llave. Como PROP, igual que las áreas — este
   *  componente no puede importar del módulo que arrastra `supabaseAdmin`. */
  vigencias: ReadonlyArray<{ valor: string; rotulo: string }>;
  vigenciaDefault: string;
}) {
  const [estado, despachar] = useActionState(accion, null);

  return (
    <div className="space-y-3">
      {estado?.ok && estado.secreto && <SecretoUnaVez enClaro={estado.secreto.enClaro} />}

      <form action={despachar} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="llave-nombre" className={ETIQUETA}>Para qué sistema es</label>
            <input id="llave-nombre" name="nombre" type="text" required maxLength={80}
              placeholder="TMS propio, tablero de Tableau…"
              className={CAMPO} style={{ background: 'var(--surface)' }} />
            <p className={AYUDA} style={{ color: 'var(--faint)' }}>
              El nombre es lo que te va a dejar saber cuál revocar.
            </p>
          </div>

          <div>
            <label htmlFor="llave-area" className={ETIQUETA}>Área que puede leer</label>
            <select id="llave-area" name="area" defaultValue={areas[0]?.valor}
              className={CAMPO} style={{ background: 'var(--surface)' }}>
              {areas.map((a) => (
                <option key={a.valor} value={a.valor}>{a.rotulo}</option>
              ))}
            </select>
            <p className={AYUDA} style={{ color: 'var(--faint)' }}>
              {areas.map((a) => `${a.rotulo}: ${a.detalle}`).join(' ')} Cada área
              alcanza también las de abajo — dale a cada sistema la más angosta que le sirva.
            </p>
          </div>

          <div>
            <label htmlFor="llave-vigencia" className={ETIQUETA}>Hasta cuándo vale</label>
            <select id="llave-vigencia" name="vigencia" defaultValue={vigenciaDefault}
              className={CAMPO} style={{ background: 'var(--surface)' }}>
              {vigencias.map((v) => (
                <option key={v.valor} value={v.valor}>{v.rotulo}</option>
              ))}
            </select>
            <p className={AYUDA} style={{ color: 'var(--faint)' }}>
              Pasada esa fecha la llave deja de servir sola, sin que nadie tenga que
              acordarse de revocarla — que es lo que salva a una llave olvidada en el
              repositorio de tu proveedor. «Sin caducidad» solo para lo que de verdad
              nadie va a rotar.
            </p>
          </div>
        </div>

        {estado && !estado.ok && <AvisoError error={estado.error} />}
        <Boton etiqueta="Emitir llave" ocupado="Emitiendo…" />
      </form>
    </div>
  );
}

/**
 * Revocar, con confirmación en DOS pasos pero SIN `confirm()`: el diálogo
 * nativo bloquea headless y no se puede mirar en un screenshot. Un
 * `<details>` deja el botón real detrás de un clic explícito y funciona sin
 * JavaScript.
 */
export function FormaRevocar({ accion, id, nombre }: {
  accion: AccionForma;
  id: string;
  nombre: string;
}) {
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta="Revocar" tono="peligro" etiquetaConfirmar="Sí, revocar esta llave"
        titulo={`Revocar la llave «${nombre}»`}
        descripcion="El sistema que use esta llave deja de poder leer en ese instante, y no hay deshacer: si hace falta otra vez, se emite una llave nueva."
        className="text-[12px] font-medium select-none inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--bad)' }}
      />
      {estado && !estado.ok && <AvisoError error={estado.error} />}
    </form>
  );
}
