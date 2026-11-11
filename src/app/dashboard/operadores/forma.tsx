'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, UserPlus } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, CampoFecha, Disclosure, Icono, clasesBoton } from '@/app/ui-v2/componentes';
import './operadores.css';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

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

function BotonGuardar() {
  const { t } = useT('operacion', operacionEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />}>
      {pending ? t('op.f.guardando') : t('op.f.guardar')}
    </Boton>
  );
}

/** El aviso del resultado — el UNICO del panel. El error sale VERBATIM: los `DatoInvalido` de `actualizarOperador` están escritos
 *  para leerse aquí y son lo único que dice QUÉ corregir. */
const Aviso = AvisoResultado;

/** Un patio, como llega del servidor: solo id y nombre. */
export interface PatioOpcion { id: string; nombre: string }

/** Un bloque que se abre. `<details>` nativo y no `useState`: sin JavaScript sigue abriendo (mismo patrón que `dashboard/clientes/forma.tsx`). */
export function Plegable({ resumen, children }: { resumen: string; children: React.ReactNode }) {
  return (
    <Disclosure variante="linea" titulo={resumen}>{children}</Disclosure>
  );
}

/**
 * Corregir la licencia, su vigencia y el RFC de un operador ya dado de alta. SOLO EDITA: el alta rápida sigue viviendo en Despacho.
 *
 * El `operadorId` viaja en un campo oculto sin que eso sea un agujero: el server action re-resuelve el tenant de la SESIÓN, no del
 * formulario, y `actualizarOperador` ancla el UPDATE con `.eq('tenant_id', ...)` y comprueba cuántas filas tocó.
 */
export function FormaOperador({ accion, operadorId, inicial, idPrefijo, patios = [], patioFijo = false }: {
  accion: AccionForma;
  operadorId: string;
  inicial: OperadorCrudo;
  /** Prefijo para los `id` del DOM: dos `<label for="licencia">` en la misma página apuntan al primero. */
  idPrefijo: string;
  /** Los patios de la flota (W2). Vacío = la flota no ha creado ninguno y el selector no se pinta. */
  patios?: PatioOpcion[];
  /** Un jefe con patio no puede mover al operador a otro patio: el selector se enseña bloqueado (el servidor lo vuelve a exigir). */
  patioFijo?: boolean;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="operadorId" value={operadorId} />

      <div className="rv-forma__rejilla">
        <CampoTexto id={campo('nombre')} name="nombre" etiqueta={t('op.f.nombre')} obligatorio minLength={3} maxLength={120} defaultValue={inicial.nombre} />

        {/* El teléfono es la IDENTIDAD del chofer frente al bot: un dígito mal tecleado lo deja sin poder reportar un gasto. Se avisa de
            las dos consecuencias porque ninguna se ve desde aquí: el número viejo deja de funcionar en el acto, y el nuevo tiene que
            estar libre en la flota (`comprobarTelefonoLibre`). Un operador sin WhatsApp (desglose por correo, 0932) llega con el
            teléfono vacío: no se le exige uno al corregir otro dato. */}
        <CampoTexto id={campo('telefono')} name="telefono" tipo="tel" etiqueta={t('op.f.whatsapp')} obligatorio={inicial.telefono !== ''}
          maxLength={25} defaultValue={inicial.telefono} placeholder="55 1234 5678"
          ayuda={t('op.f.whatsapp.ayuda')} />

        <CampoTexto id={campo('numeroEmpleado')} name="numeroEmpleado" etiqueta={t('op.f.empleado.opc')} maxLength={40} defaultValue={inicial.numeroEmpleado} />

        <CampoTexto id={campo('rfc')} name="rfc" etiqueta={t('op.f.rfc')} maxLength={13} defaultValue={inicial.rfc}
          placeholder="GODE561231GR8" claseControl="rv-eq__mayus"
          ayuda={t('op.f.rfc.ayuda')} />

        {patios.length > 0 && (
          <>
            <CampoSelect id={campo('terminalId')} name="terminalId" etiqueta={t('op.f.patio')} defaultValue={inicial.terminalId ?? ''} disabled={patioFijo}
              ayuda={patioFijo ? t('op.f.patio.soloadmin') : t('op.f.patio.ayuda')}>
              <option value="">{t('op.f.sinpatio')}</option>
              {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </CampoSelect>
            {patioFijo && <input type="hidden" name="terminalId" value={inicial.terminalId ?? ''} />}
          </>
        )}

        <CampoTexto id={campo('licencia')} name="licencia" etiqueta={t('op.f.licencia')} maxLength={40} defaultValue={inicial.licencia} />
        <CampoTexto id={campo('licenciaTipo')} name="licenciaTipo" etiqueta={t('op.f.tipo')} maxLength={10} defaultValue={inicial.licenciaTipo} placeholder="B, C, E…" />
        <CampoFecha id={campo('licenciaVence')} name="licenciaVence" etiqueta={t('op.f.vence')} defaultValue={inicial.licenciaVence} ayuda={t('op.f.vence.ayuda')} />
      </div>

      {/* LA BAJA DEL CHOFER: un botón con su diálogo, que dice los efectos. Reactivar no necesita diálogo: devuelve, no corta. */}
      <Aviso estado={estado} />
      <div className="rv-forma__fila">
        <BotonGuardar />
        {inicial.activo ? (
          <BotonConfirmar
            etiqueta={t('op.f.baja')} tono="peligro" nombreConfirmar="accion" valorConfirmar="baja"
            titulo={t('op.f.baja.titulo', { nombre: inicial.nombre })}
            descripcion={t('op.f.baja.cuerpo')}
            etiquetaConfirmar={t('op.f.baja.si')}
            className={clasesBoton('danger')}
          />
        ) : (
          <Boton type="submit" name="accion" value="reactivar" variante="secondary">{t('op.f.reactivar')}</Boton>
        )}
      </div>
    </form>
  );
}

/**
 * El alta de UN operador, en su propia pantalla (W2). Mismo `crearOperador` que Despacho y que el importador: un teléfono que uno
 * acepta, los otros también.
 */
export function FormaAltaOperador({ accion, patios = [], terminalFijo = null, sinWhatsApp = false }: {
  accion: AccionForma;
  /** La flota entrega el desglose por correo (0932): el WhatsApp es opcional y se pide el correo. */
  sinWhatsApp?: boolean;
  patios?: PatioOpcion[];
  /** Un jefe con patio da de alta SOLO en el suyo (nombre del patio). */
  terminalFijo?: string | null;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-forma">
      <div className="rv-forma__rejilla">
        <CampoTexto id="alta-op-nombre" name="nombre" etiqueta={t('op.f.nombre')} obligatorio minLength={3} maxLength={120} autoComplete="off" />
        <CampoTexto id="alta-op-telefono" name="telefono" tipo="tel" etiqueta={sinWhatsApp ? t('op.f.wa.opc') : t('op.f.wa')}
          obligatorio={!sinWhatsApp} maxLength={25} autoComplete="off" placeholder="55 1234 5678"
          ayuda={sinWhatsApp
            ? t('op.f.sinwa.ayuda')
            : t('op.f.wa.ayuda')} />
        <CampoTexto id="alta-op-empleado" name="numeroEmpleado" etiqueta={sinWhatsApp ? t('op.f.empleado') : t('op.f.empleado.opc')} maxLength={40} />
        {sinWhatsApp && (
          <CampoTexto id="alta-op-correo" name="correo" tipo="email" etiqueta={t('op.f.correo')} maxLength={254} autoComplete="off" />
        )}
        {terminalFijo ? (
          <div className="rv-campo">
            <span className="rv-campo__etq">{t('op.f.patio')}</span>
            <p id="alta-op-patio" className="rv-eq__fijo">{terminalFijo}</p>
          </div>
        ) : patios.length > 0 ? (
          <CampoSelect id="alta-op-patio" name="terminalId" etiqueta={t('op.f.patio')} defaultValue="">
            <option value="">{t('op.f.sinpatio')}</option>
            {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </CampoSelect>
        ) : null}
      </div>
      <Aviso estado={estado} />
      <BotonAlta />
    </form>
  );
}

function BotonAlta() {
  const { t } = useT('operacion', operacionEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={UserPlus} />} className="rv-eq__alta">
      {pending ? t('op.f.dando') : t('op.f.alta')}
    </Boton>
  );
}
