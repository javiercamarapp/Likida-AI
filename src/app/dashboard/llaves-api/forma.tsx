'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, Check, Copy, ShieldAlert } from 'lucide-react';
import { Boton, BotonConfirmar, CampoSelect, CampoTexto, AvisoResultado, Icono, Tooltip, clasesBoton } from '@/app/ui-v2/componentes';
// SOLO TIPOS de `llave-api-escritura.ts`: ese módulo importa `supabaseAdmin`,
// que no puede acabar en el bundle del navegador. El catálogo de áreas viaja
// como PROP desde la página, igual que `MODOS_TARIFA` en /dashboard/clientes.
import type { OpcionArea } from '@/lib/auth/llave-api-escritura';
import './llaves-api.css';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { rico } from '@/lib/i18n/rico';

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
  const { t } = useT('resto', restoEs);
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
        <Icono icono={ShieldAlert} />{t('llaves.guardala_ahora_no_se_puede_volver')}</div>
      <div className="rv-lla__clave">
        {/* `break-all` y no truncate: si el copiado falla, que al menos se
            pueda leer y transcribir completa. */}
        <code className="cifra-mono">{enClaro}</code>
        <Tooltip texto={t('llaves.copiar_la_llave')}>
          <Boton variante="ghost" tamano="sm" className="rv-btn--icono" aria-label={t('llaves.copiar_la_llave')} onClick={copiar} icono={<Icono icono={copiado ? Check : Copy} />}>{null}</Boton>
        </Tooltip>
      </div>
      <p className="rv-lla__nota">{rico(t('llaves.se_manda_en_cada_peticion_como'), { e0: (c) => <code className="cifra-mono">{c}</code> })}</p>
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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);

  return (
    <div className="rv-lla__forma">
      {estado?.ok && estado.secreto && <SecretoUnaVez enClaro={estado.secreto.enClaro} />}

      <form action={despachar} className="rv-lla__forma">
        <div className="rv-lla__rejilla">
          <CampoTexto etiqueta={t('llaves.para_que_sistema_es')} id="llave-nombre" name="nombre" required maxLength={80}
            placeholder={t('llaves.tms_propio_tablero_de_tableau')} ayuda={t('llaves.el_nombre_es_lo_que_te')} />

          <CampoSelect etiqueta={t('llaves.area_que_puede_leer')} id="llave-area" name="area" defaultValue={areas[0]?.valor}
            ayuda={t('llaves.cada_area_alcanza_tambien_las_de', { areas: areas.map((a) => `${a.rotulo}: ${a.detalle}`).join(' ') })}>
            {areas.map((a) => (
              <option key={a.valor} value={a.valor}>{a.rotulo}</option>
            ))}
          </CampoSelect>

          <CampoSelect etiqueta={t('llaves.hasta_cuando_vale')} id="llave-vigencia" name="vigencia" defaultValue={vigenciaDefault}
            ayuda={t('llaves.pasada_esa_fecha_la_llave_deja')}>
            {vigencias.map((v) => (
              <option key={v.valor} value={v.valor}>{v.rotulo}</option>
            ))}
          </CampoSelect>
        </div>

        {estado && !estado.ok && <AvisoError error={estado.error} />}
        <div><BotonEmitir etiqueta={t('llaves.emitir_llave')} ocupado={t('llaves.emitiendo')} /></div>
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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="rv-lla__revocar">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta={t('llaves.revocar')} tono="peligro" etiquetaConfirmar={t('llaves.si_revocar_esta_llave')}
        titulo={`Revocar la llave «${nombre}»`}
        descripcion={t('llaves.el_sistema_que_use_esta_llave')}
        className={clasesBoton('danger', 'sm')}
      />
      {estado && !estado.ok && <AvisoError error={estado.error} />}
    </form>
  );
}
