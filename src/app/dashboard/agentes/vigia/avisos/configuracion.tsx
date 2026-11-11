'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import '../vigia.css';
import { Aviso as AvisoV2, AvisoResultado, Boton, BotonEnlace, Campo, CampoSelect, CampoTexto, Casilla, Icono, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

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
export const textoColores = (tx: TAgentes = TR_ES.t) => (tx('rest.esperando_el_archivo_con_colores'));
export const TEXTO_COLORES = textoColores();
export const textoAlias = (tx: TAgentes = TR_ES.t) => (tx('rest.aqui_se_veran_los_nombres_del')
  + tx('rest.la_tabla_de_equivalencias_aun_no'));
export const TEXTO_ALIAS = textoAlias();
export const textoPrivacidad = (tx: TAgentes = TR_ES.t) => (tx('rest.al_cliente_siempre_le_llegan_la')
  + tx('rest.la_licencia_su_vigencia_y_el')
  + tx('rest.los_habilita_aqui_y_el_cambio'));
export const TEXTO_PRIVACIDAD = textoPrivacidad();

function Aviso({ children }: { children: React.ReactNode }) {
  return <AvisoV2 tono="error">{children}</AvisoV2>;
}

function Guardar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return <Boton type="submit" loading={pending} icono={<Icono icono={Save} tam={14} />}>{tx('conductores.forma.guardar_configuracion')}</Boton>;
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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  const base = `/dashboard/agentes/vigia/avisos${sufijo}`;
  const lim = opciones.limites;
  const sd = !puedeEditar;
  const sdEnvio = sd || !(puedeEditarEnvio ?? puedeEditarPrivacidad);
  return (
    <MarcoPagina titulo={tx('rest.configuracion_del_aviso_de_viaje')} apoyo={tx('rest.cuando_se_arman_y_se_envian')}
      acciones={<BotonEnlace tamano="sm" href={base}>{tx('rest.volver_a_los_avisos')}</BotonEnlace>}>
      {sinMigrar ? <Aviso>{tx('rest.la_base_de_datos_todavia_no')}</Aviso> : null}
      {errorLectura ? <Aviso>{errorLectura}</Aviso> : null}
      {!puedeEditar && config ? (
        <p className="rv-vg__nota">{tx('rest.solo_el_dueno_o_el_encargado')}</p>
      ) : null}

      {config ? (
        <form action={despachar} className="rv-vg__pila" aria-label={tx('rest.configuracion_del_aviso_de_viaje')}>
          {ventanaIlegible ? (
            <Aviso>{tx('rest.el_horario_de_envio_guardado_no')}</Aviso>
          ) : null}

          <Seccion id="cfg-envio" titulo={tx('rest.envio')}>
            <Casilla name="habilitado" value="1" defaultChecked={config.habilitado} disabled={sdEnvio} etiqueta={tx('rest.aviso_de_viaje_encendido')} />
            {sdEnvio && !sd ? (
              <>
                {config.habilitado ? <input type="hidden" name="habilitado" value="1" /> : null}
                <input type="hidden" name="modo" value={config.modo} />
                <input type="hidden" name="canal" value={config.canalDefault} />
                <p className="rv-vg__nota">{tx('rest.solo_la_duena_de_la_flota')}</p>
              </>
            ) : null}
            <p className="rv-vg__nota">{tx('rest.apagado_no_se_arma_ni_se')}</p>
            <div className="rv-vg__cuad">
              <CampoSelect id="cfg-modo" etiqueta={tx('rest.modo')} name={sdEnvio ? undefined : 'modo'} defaultValue={config.modo} disabled={sdEnvio}>
                <option value="confirmar">{tx('rest.confirmar_cada_aviso_recomendado')}</option>
                <option value="autonomo">{tx('rest.autonomo_solo_clientes_con_avisos_confirmados')}</option>
              </CampoSelect>
              <CampoSelect id="cfg-canal" etiqueta={tx('rest.canal_por_defecto')} name={sdEnvio ? undefined : 'canal'} defaultValue={config.canalDefault} disabled={sdEnvio}>
                <option value="ejecutivo_copia">{tx('rest.copia_para_el_ejecutivo_tu_lo')}</option>
                <option value="cliente_1a1">{tx('rest.whatsapp_directo_al_cliente')}</option>
              </CampoSelect>
            </div>
            <div className="rv-vg__cuad">
              <Campo id="cfg-desde" etiqueta={tx('rest.enviar_desde_hora')}><input name="ventana_desde" type="time" defaultValue={config.ventana?.desde ?? ''} disabled={sd} className="rv-ctl" /></Campo>
              <Campo id="cfg-hasta" etiqueta={tx('rest.enviar_hasta_hora')}><input name="ventana_hasta" type="time" defaultValue={config.ventana?.hasta ?? ''} disabled={sd} className="rv-ctl" /></Campo>
            </div>
            <p className="rv-vg__nota">{tx('rest.fuera_de_ese_horario_el_aviso')}</p>
          </Seccion>

          <Seccion id="cfg-listo" titulo={tx('rest.cuando_un_servicio_esta_listo')}>
            <p className="rv-vg__nota" data-testid="ayuda-listo">{tx('rest.regla_provisional_caja_unidad_carta_porte')}</p>
            <div className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">{tx('rest.estatus_de_ccp_que_cuentan_como')}</p>
              <Casillas nombre="ccp" opciones={opciones.ccp} marcadas={config.ccpListos} deshabilitado={sd} />
            </div>
            <Casilla name="exigir_transito" value="1" defaultChecked={config.exigirTransito} disabled={sd} etiqueta={tx('rest.ademas_que_el_transito_no_este')} />
            <div className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">{tx('rest.secciones_del_programa_que_generan_aviso')}</p>
              <Casillas nombre="seccion" opciones={opciones.secciones} marcadas={config.secciones} deshabilitado={sd} />
              <p className="rv-vg__nota">{tx('rest.las_cancelaciones_nunca_generan_este_aviso')}</p>
            </div>
            <CampoTexto id="cfg-horas" etiqueta={tx('rest.horas_antes_de_la_cita_vacio')} name="horas_antes" tipo="number" inputMode="numeric" step={1}
              min={lim.horasAntes.min} max={lim.horasAntes.max} defaultValue={config.horasAntesCita ?? ''} disabled={sd} />
            <div className="rv-vg__pila--s">
              <p className="rv-vg__rotulo">{tx('rest.mapa_de_colores')}</p>
              <p className="rv-vg__bloque rv-vg__nota" aria-disabled="true" data-testid="colores">{textoColores(tx)}</p>
            </div>
          </Seccion>

          <Seccion id="cfg-cambios" titulo={tx('rest.cambios_y_reenvios')}>
            <div className="rv-vg__cuad">
              <CampoTexto id="cfg-debounce" etiqueta={tx('rest.minutos_de_calma_antes_de_reenviar', { min: lim.debounce.min, max: lim.debounce.max })} name="debounce_min" tipo="number" inputMode="numeric" step={1} required
                min={lim.debounce.min} max={lim.debounce.max} defaultValue={config.debounceMin} disabled={sd} />
              <CampoTexto id="cfg-reenvios" etiqueta={tx('rest.maximo_de_reenvios_por_servicio_a', { min: lim.reenvios.min, max: lim.reenvios.max })} name="max_reenvios" tipo="number" inputMode="numeric" step={1} required
                min={lim.reenvios.min} max={lim.reenvios.max} defaultValue={config.maxReenvios} disabled={sd} />
            </div>
          </Seccion>

          <Seccion id="cfg-privacidad" titulo={tx('rest.datos_del_operador_que_recibe_el')}>
            <p className="rv-vg__nota" data-testid="privacidad">{textoPrivacidad(tx)}</p>
            {puedeEditarPrivacidad ? <input type="hidden" name="op_presente" value="1" /> : null}
            <div className="rv-vg__linea">
              {opciones.operador.map((o) => (
                <Casilla key={o.campo} name={o.control} value="1" defaultChecked={config.operador[o.campo]} disabled={!puedeEditarPrivacidad} etiqueta={o.rotulo} />
              ))}
            </div>
            {puedeEditar && !puedeEditarPrivacidad ? (
              <p className="rv-vg__nota" data-testid="solo-duena">{tx('rest.solo_la_duena_de_la_flota_2')}</p>
            ) : null}
          </Seccion>

          <Seccion id="cfg-alias" titulo={tx('rest.clientes_sin_ligar')}>
            <p className="rv-vg__nota" data-testid="alias">{textoAlias(tx)}</p>
          </Seccion>

          {puedeEditar ? <div><Guardar /></div> : null}
          {estado ? <AvisoResultado estado={estado} /> : null}
        </form>
      ) : null}
    </MarcoPagina>
  );
}
