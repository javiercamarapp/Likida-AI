'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, Check, Copy, ShieldAlert } from 'lucide-react';
import { Boton, BotonConfirmar, CampoSelect, CampoTexto, AvisoResultado, Icono, clasesBoton } from '@/app/ui-v2/componentes';
// SOLO TIPOS de `llave-api-escritura.ts`: ese módulo importa `supabaseAdmin`,
// que no puede acabar en el bundle del navegador. El catálogo de áreas viaja
// como PROP desde la página, igual que `MODOS_TARIFA` en /dashboard/clientes.
import type { OpcionArea } from '@/lib/auth/llave-api-escritura';
import './llaves-api.css';

/** El resultado del alta trae el SECRETO — es el único momento en que existe
 *  fuera de la base (y en la base solo vive su hash). */
export type ResultadoForma =
  | { ok: true; mensaje: string; secreto?: { enClaro: string; prefijo: string } }
  | { ok: false; error: string }
  | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function BotonEmitir({ etiqueta, ocupado }: { etiqueta: string; ocupado: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={KeyRound} />}>
      {pending ? ocupado : etiqueta}
    </Boton>
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
    <div className="rv-lla__secreto">
      <div className="rv-lla__alerta">
        <Icono icono={ShieldAlert} />
        Guárdala ahora. No se puede volver a ver: solo guardamos su huella.
      </div>
      <div className="rv-lla__clave">
        {/* `break-all` y no truncate: si el copiado falla, que al menos se
            pueda leer y transcribir completa. */}
        <code className="cifra-mono">{enClaro}</code>
        <button type="button" aria-label="Copiar la llave" onClick={copiar} className="rv-icono-boton">
          <Icono icono={copiado ? Check : Copy} />
        </button>
      </div>
      <p className="rv-lla__nota">
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
    <div className="rv-lla__forma">
      {estado?.ok && estado.secreto && <SecretoUnaVez enClaro={estado.secreto.enClaro} />}

      <form action={despachar} className="rv-lla__forma">
        <div className="rv-lla__rejilla">
          <CampoTexto etiqueta="Para qué sistema es" id="llave-nombre" name="nombre" required maxLength={80}
            placeholder="TMS propio, tablero de Tableau…" ayuda="El nombre es lo que te va a dejar saber cuál revocar." />

          <CampoSelect etiqueta="Área que puede leer" id="llave-area" name="area" defaultValue={areas[0]?.valor}
            ayuda={`${areas.map((a) => `${a.rotulo}: ${a.detalle}`).join(' ')} Cada área alcanza también las de abajo — dale a cada sistema la más angosta que le sirva.`}>
            {areas.map((a) => (
              <option key={a.valor} value={a.valor}>{a.rotulo}</option>
            ))}
          </CampoSelect>

          <CampoSelect etiqueta="Hasta cuándo vale" id="llave-vigencia" name="vigencia" defaultValue={vigenciaDefault}
            ayuda="Pasada esa fecha la llave deja de servir sola, sin que nadie tenga que acordarse de revocarla — que es lo que salva a una llave olvidada en el repositorio de tu proveedor. «Sin caducidad» solo para lo que de verdad nadie va a rotar.">
            {vigencias.map((v) => (
              <option key={v.valor} value={v.valor}>{v.rotulo}</option>
            ))}
          </CampoSelect>
        </div>

        {estado && !estado.ok && <AvisoError error={estado.error} />}
        <div><BotonEmitir etiqueta="Emitir llave" ocupado="Emitiendo…" /></div>
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
    <form action={despachar} className="rv-lla__revocar">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta="Revocar" tono="peligro" etiquetaConfirmar="Sí, revocar esta llave"
        titulo={`Revocar la llave «${nombre}»`}
        descripcion="El sistema que use esta llave deja de poder leer en ese instante, y no hay deshacer: si hace falta otra vez, se emite una llave nueva."
        className={clasesBoton('danger', 'sm')}
      />
      {estado && !estado.ok && <AvisoError error={estado.error} />}
    </form>
  );
}
