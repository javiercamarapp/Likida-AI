'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import '../vigia.css';
import { Aviso as AvisoV2, AvisoResultado, Boton, BotonEnlace, Campo, CampoSelect, CampoTexto, Casilla, Icono, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL AVISO DE VIAJE (Agente 4, T-A4-23). Requisitos E4, E5 y E6.
//
//  · E5: por defecto NINGÚN aviso sale sin una persona; el modo autónomo es una decisión de la flota y aun así se gana por
//    cliente (T-A4-20). Aquí solo se enciende/apaga y se elige el modo.
//  · E4: «listo» = caja + unidad + carta porte en el conjunto que la flota elija (lista editable). El mapa de colores NO se
//    inventa: queda deshabilitado con «Esperando el archivo con colores» hasta que exista la leyenda real (B1).
//  · E6: licencia, vigencia y teléfono del operador son datos personales de un tercero: apagados por defecto y solo la
//    dueña de la flota (`flota_admin`) los habilita. Cada cambio queda en la bitácora (quién, cuándo, antes y después).
//
// Esta vista es solo de presentación: no valida nada que importe (el servidor vuelve a validar todo, ver `page.tsx`) y los
// catálogos y los límites le llegan por props desde el servidor, de modo que no hay una segunda copia que se desincronice.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoConfig = null | { ok: true; mensaje: string } | { ok: false; error: string };
export type AccionConfig = (previo: ResultadoConfig, fd: FormData) => Promise<ResultadoConfig>;

export interface ConfigPantalla {
  habilitado: boolean;
  modo: 'confirmar' | 'autonomo';
  canalDefault: 'ejecutivo_copia' | 'cliente_1a1';
  ccpListos: string[];
  exigirTransito: boolean;
  secciones: string[];
  horasAntesCita: number | null;
  /** `null` = sin restricción de horario. */
  ventana: { desde: string; hasta: string } | null;
  maxReenvios: number;
  debounceMin: number;
  /** Datos del operador que el cliente puede recibir (además de nombre, unidad, placas y caja). */
  operador: { licencia: boolean; vigencia: boolean; telefono: boolean };
}

export interface OpcionConfig { valor: string; rotulo: string }
export interface LimitesConfig {
  horasAntes: { min: number; max: number };
  debounce: { min: number; max: number };
  reenvios: { min: number; max: number };
}
export interface OpcionesConfigPantalla {
  ccp: OpcionConfig[];
  secciones: OpcionConfig[];
  /** Campos personales del operador, con el nombre del control que los envía. */
  operador: Array<{ campo: 'licencia' | 'vigencia' | 'telefono'; control: string; rotulo: string }>;
  limites: LimitesConfig;
}

/** Texto del mapa de colores mientras no exista la leyenda real (B1, E4). */
export const TEXTO_COLORES = 'Esperando el archivo con colores';
export const TEXTO_ALIAS =
  'Aquí se verán los nombres del programa que todavía no están ligados a un cliente (hoy ese aviso queda «sin destinatario»). '
  + 'La tabla de equivalencias aún no tiene pantalla de captura.';
export const TEXTO_PRIVACIDAD =
  'Al cliente siempre le llegan la caja, sus placas y estado, la unidad, sus placas y el nombre del operador. '
  + 'La licencia, su vigencia y el teléfono del operador son datos personales de un tercero: solo salen si la dueña de la flota '
  + 'los habilita aquí, y el cambio queda registrado con su nombre y la fecha.';

function Aviso({ children }: { children: React.ReactNode }) {
  return <AvisoV2 tono="error">{children}</AvisoV2>;
}

function Guardar() {
  const { pending } = useFormStatus();
  return <Boton type="submit" loading={pending} icono={<Icono icono={Save} tam={14} />}>Guardar configuración</Boton>;
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="rv-vg__campos" id={id}>
      <legend className="rv-sr">{titulo}</legend>
      <Tarjeta titulo={titulo}><div className="rv-vg__pila">{children}</div></Tarjeta>
    </fieldset>
  );
}

function Casillas({ nombre, opciones, marcadas, deshabilitado }: { nombre: string; opciones: OpcionConfig[]; marcadas: string[]; deshabilitado: boolean }) {
  return (
    <div className="rv-vg__linea">
      {opciones.map((o) => (
        <Casilla key={o.valor} name={nombre} value={o.valor} defaultChecked={marcadas.includes(o.valor)} disabled={deshabilitado} etiqueta={o.rotulo} />
      ))}
    </div>
  );
}

export function VistaConfiguracionAviso({
  sufijo, config, opciones, puedeEditar, puedeEditarPrivacidad, puedeEditarEnvio, ventanaIlegible, errorLectura, sinMigrar, accion,
}: {
  sufijo: string;
  /** `null` cuando no se pudo leer (error o migración pendiente). */
  config: ConfigPantalla | null;
  opciones: OpcionesConfigPantalla;
  /** Dueño y encargado cambian la configuración; quien solo mira la ve sin controles. */
  puedeEditar: boolean;
  /** Solo la dueña de la flota (`flota_admin`) cambia qué datos del operador salen al cliente. */
  puedeEditarPrivacidad: boolean;
  /** A37-S15-05: encender/apagar el aviso y elegir modo y canal es de la dueña (`flota_admin`), como en la configuración
   *  del Vigía. Sin este permiso los tres controles se muestran sin poder cambiarlos y viajan ocultos con su valor actual
   *  (un control `disabled` no se envía: sin esto, guardar apagaría el aviso). Por defecto = `puedeEditarPrivacidad`. */
  puedeEditarEnvio?: boolean;
  /** La ventana de envío guardada no se puede leer: mientras tanto el aviso NO sale. */
  ventanaIlegible: boolean;
  errorLectura: string | null;
  sinMigrar: boolean;
  accion: AccionConfig;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const base = `/dashboard/agentes/vigia/avisos${sufijo}`;
  const lim = opciones.limites;
  const sd = !puedeEditar;
  const sdEnvio = sd || !(puedeEditarEnvio ?? puedeEditarPrivacidad);
  return (
    <MarcoPagina titulo="Configuración del aviso de viaje" apoyo="Cuándo se arman y se envían los avisos, qué cuenta como servicio listo y qué datos del operador reciben tus clientes."
      acciones={<BotonEnlace tamano="sm" href={base}>Volver a los avisos</BotonEnlace>}>
      {sinMigrar ? <Aviso>La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.</Aviso> : null}
      {errorLectura ? <Aviso>{errorLectura}</Aviso> : null}
      {!puedeEditar && config ? (
        <p className="rv-vg__nota">Solo el dueño o el encargado de la flota cambia esta configuración. Tú puedes verla.</p>
      ) : null}

      {config ? (
        <form action={despachar} className="rv-vg__pila" aria-label="Configuración del aviso de viaje">
          {ventanaIlegible ? (
            <Aviso>El horario de envío guardado no se puede leer, así que por seguridad ningún aviso sale. Escribe la hora de inicio y de fin, o déjalas vacías para enviar a cualquier hora, y guarda.</Aviso>
          ) : null}

          <Seccion id="cfg-envio" titulo="Envío">
            <Casilla name="habilitado" value="1" defaultChecked={config.habilitado} disabled={sdEnvio} etiqueta="Aviso de viaje encendido" />
            {sdEnvio && !sd ? (
              <>
                {config.habilitado ? <input type="hidden" name="habilitado" value="1" /> : null}
                <input type="hidden" name="modo" value={config.modo} />
                <input type="hidden" name="canal" value={config.canalDefault} />
                <p className="rv-vg__nota">Solo la dueña de la flota enciende o apaga el aviso y cambia el modo y el canal. Tú ajustas el resto.</p>
              </>
            ) : null}
            <p className="rv-vg__nota">Apagado: no se arma ni se envía ningún aviso. Cada aviso nuevo espera tu confirmación mientras el modo sea «confirmar».</p>
            <div className="rv-vg__cuad">
              <CampoSelect id="cfg-modo" etiqueta="Modo" name={sdEnvio ? undefined : 'modo'} defaultValue={config.modo} disabled={sdEnvio}>
                <option value="confirmar">Confirmar cada aviso (recomendado)</option>
                <option value="autonomo">Autónomo (solo clientes con avisos confirmados sin cambios)</option>
              </CampoSelect>
              <CampoSelect id="cfg-canal" etiqueta="Canal por defecto" name={sdEnvio ? undefined : 'canal'} defaultValue={config.canalDefault} disabled={sdEnvio}>
                <option value="ejecutivo_copia">Copia para el ejecutivo (tú lo mandas)</option>
                <option value="cliente_1a1">WhatsApp directo al cliente</option>
              </CampoSelect>
            </div>
            <div className="rv-vg__cuad">
              <Campo id="cfg-desde" etiqueta="Enviar desde (hora)"><input name="ventana_desde" type="time" defaultValue={config.ventana?.desde ?? ''} disabled={sd} className="rv-ctl" /></Campo>
              <Campo id="cfg-hasta" etiqueta="Enviar hasta (hora)"><input name="ventana_hasta" type="time" defaultValue={config.ventana?.hasta ?? ''} disabled={sd} className="rv-ctl" /></Campo>
            </div>
            <p className="rv-vg__nota">Fuera de ese horario el aviso espera. Vacío = a cualquier hora. Si el fin es menor que el inicio, el horario cruza la medianoche.</p>
          </Seccion>

          <Seccion id="cfg-listo" titulo="Cuándo un servicio está «listo»">
            <p className="rv-vg__nota" data-testid="ayuda-listo">
              Regla provisional: caja + unidad + carta porte (CCP) en alguno de los estatus que marques. Cambiará cuando tengamos la leyenda de colores.
            </p>
            <div className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">Estatus de CCP que cuentan como listo</p>
              <Casillas nombre="ccp" opciones={opciones.ccp} marcadas={config.ccpListos} deshabilitado={sd} />
            </div>
            <Casilla name="exigir_transito" value="1" defaultChecked={config.exigirTransito} disabled={sd} etiqueta="Además, que el tránsito no esté bloqueado (p. ej. pendiente de cruce)" />
            <div className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">Secciones del programa que generan aviso</p>
              <Casillas nombre="seccion" opciones={opciones.secciones} marcadas={config.secciones} deshabilitado={sd} />
              <p className="rv-vg__nota">Las cancelaciones nunca generan este aviso.</p>
            </div>
            <CampoTexto id="cfg-horas" etiqueta="Horas antes de la cita (vacío = en cuanto esté listo)" name="horas_antes" tipo="number" inputMode="numeric" step={1}
              min={lim.horasAntes.min} max={lim.horasAntes.max} defaultValue={config.horasAntesCita ?? ''} disabled={sd} />
            <div className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">Mapa de colores</p>
              <p className="rv-vg__bloque rv-vg__nota" aria-disabled="true" data-testid="colores">{TEXTO_COLORES}</p>
            </div>
          </Seccion>

          <Seccion id="cfg-cambios" titulo="Cambios y reenvíos">
            <div className="rv-vg__cuad">
              <CampoTexto id="cfg-debounce" etiqueta={`Minutos de calma antes de reenviar (${lim.debounce.min} a ${lim.debounce.max})`} name="debounce_min" tipo="number" inputMode="numeric" step={1} required
                min={lim.debounce.min} max={lim.debounce.max} defaultValue={config.debounceMin} disabled={sd} />
              <CampoTexto id="cfg-reenvios" etiqueta={`Máximo de reenvíos por servicio (${lim.reenvios.min} a ${lim.reenvios.max})`} name="max_reenvios" tipo="number" inputMode="numeric" step={1} required
                min={lim.reenvios.min} max={lim.reenvios.max} defaultValue={config.maxReenvios} disabled={sd} />
            </div>
          </Seccion>

          <Seccion id="cfg-privacidad" titulo="Datos del operador que recibe el cliente">
            <p className="rv-vg__nota" data-testid="privacidad">{TEXTO_PRIVACIDAD}</p>
            {puedeEditarPrivacidad ? <input type="hidden" name="op_presente" value="1" /> : null}
            <div className="rv-vg__linea">
              {opciones.operador.map((o) => (
                <Casilla key={o.campo} name={o.control} value="1" defaultChecked={config.operador[o.campo]} disabled={!puedeEditarPrivacidad} etiqueta={o.rotulo} />
              ))}
            </div>
            {puedeEditar && !puedeEditarPrivacidad ? (
              <p className="rv-vg__nota" data-testid="solo-duena">Solo la dueña de la flota puede cambiar estos tres datos.</p>
            ) : null}
          </Seccion>

          <Seccion id="cfg-alias" titulo="Clientes sin ligar">
            <p className="rv-vg__nota" data-testid="alias">{TEXTO_ALIAS}</p>
          </Seccion>

          {puedeEditar ? <div><Guardar /></div> : null}
          {estado ? <AvisoResultado estado={estado} /> : null}
        </form>
      ) : null}
    </MarcoPagina>
  );
}
