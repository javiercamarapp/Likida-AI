'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import '../conductores.css';
import {
  AvisoResultado, BarraFiltros, Boton, CampoSelect, CampoTexto, Casilla as CasillaV2, Disclosure, FiltroBusqueda, Fieldset, Icono, Radio,
  type ResultadoUI,
} from '@/app/ui-v2/componentes';
import { FILAS_NUEVAS_CONTACTO, NOMBRES_DIA, OPCIONES_PERFIL, avisoZona } from '@/lib/likida/conductor/config_forma';
import type { ConfigConductor } from '@/lib/likida/conductor/config';
import type { ContactoTrafico } from '@/lib/likida/conductor/escalamiento';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { rico } from '../../i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN DE FLOTA DEL AGENTE 5 (formulario). Sin JavaScript extra: las casillas y los campos son
// de HTML; el contacto nuevo son filas en blanco al final. El resultado se enseña con el aviso ÚNICO del
// panel (`AvisoResultado`): el error junto a los campos, donde se corrige.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoConfig = ResultadoUI;
export type AccionConfig = (previo: ResultadoConfig, fd: FormData) => Promise<ResultadoConfig>;

function Casilla({ nombre, etiqueta, ayuda, marcada, deshabilitada }: { nombre: string; etiqueta: string; ayuda?: string; marcada: boolean; deshabilitada: boolean }) {
  return <CasillaV2 name={`f_${nombre}`} value="si" defaultChecked={marcada} disabled={deshabilitada} etiqueta={etiqueta} ayuda={ayuda} />;
}

function Numero({ nombre, etiqueta, valor, ayuda, deshabilitada, placeholder }: { nombre: string; etiqueta: string; valor: string; ayuda?: string; deshabilitada: boolean; placeholder?: string }) {
  return <CampoTexto etiqueta={etiqueta} name={`f_${nombre}`} defaultValue={valor} inputMode="numeric" disabled={deshabilitada} placeholder={placeholder} ayuda={ayuda} />;
}

/** Una sección de la configuración: plegable, con una línea de resumen de su estado cuando hay uno. */
function Seccion({ id, titulo, resumen, abierto, children }: { id: string; titulo: string; resumen?: string; abierto?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={titulo}>
      <Disclosure titulo={titulo} resumen={resumen} abierto={abierto}>
        <div className="rv-cd__seccion-conf">{children}</div>
      </Disclosure>
    </section>
  );
}

function Guardar() {
  const { t } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} tam={14} />}>
      {pending ? 'Guardando…' : t('conductores.forma.guardar_configuracion')}
    </Boton>
  );
}

export function FormaConfigConductor({ accion, config, valores, contactos, patios, puedeEditar, puedeForzarPreflight = false }: {
  accion: AccionConfig;
  config: ConfigConductor;
  /** Los textos de los campos (ver `valoresDeForma`). */
  valores: Record<string, string>;
  contactos: ContactoTrafico[];
  patios: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  /** T-A5-25: solo para el soporte de Likida (QA). */
  puedeForzarPreflight?: boolean;
}) {
  const { t } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  const off = !puedeEditar;
  const filas = contactos.length + FILAS_NUEVAS_CONTACTO;
  return (
    <form action={enviar} className="rv-cd__pila" aria-label={t('conductores.forma.configuracion_del_agente_conductor')}>
      <Seccion id="cfg-estado" titulo={t('conductores.forma.estado_del_agente')} abierto resumen={config.activo ? t('conductores.forma.activo') : t('conductores.forma.apagado')}>
        <Casilla nombre="activo" etiqueta={t('conductores.forma.agente_encendido_para_esta_flota')} marcada={config.activo} deshabilitada={off}
          ayuda={t('conductores.forma.apagado_el_agente_no_pide')} />
        <Casilla nombre="confirmarAlChofer" etiqueta={t('conductores.forma.confirmarle_al_chofer_cada_hito')} marcada={config.confirmarAlChofer} deshabilitada={off} />
        <Casilla nombre="usarLlm" etiqueta={t('conductores.forma.entender_con_un_modelo_lo')} marcada={config.usarLlm} deshabilitada={off}
          ayuda={t('conductores.forma.solo_cuando_el_mensaje_parece')} />
      </Seccion>

      <Seccion id="cfg-perfil" titulo={t('conductores.forma.que_sigue_el_agente')}>
        <fieldset className="rv-fieldset" disabled={off}>
          <legend className="rv-fieldset__leyenda">{t('conductores.forma.perfil_de_seguimiento')}</legend>
          {OPCIONES_PERFIL.map((o) => (
            <Radio key={o.valor} name="f_perfilSeguimiento" value={o.valor} defaultChecked={config.perfilSeguimiento === o.valor} etiqueta={o.etiqueta} ayuda={o.ayuda} />
          ))}
        </fieldset>
        <Casilla nombre="mostrarEstadosFrontera" etiqueta={t('conductores.forma.mostrar_en_el_tablero_los')} marcada={config.mostrarEstadosFrontera} deshabilitada={off}
          ayuda={t('conductores.forma.solo_informativo_no_genera_avisos')} />
        <Casilla nombre="aplicarSalidaDelTms" etiqueta={t('conductores.forma.dar_por_hecha_la_salida')} marcada={config.aplicarSalidaDelTms} deshabilitada={off} />
        <p className="rv-cd__nota">{t('conductores.forma.estos_tiempos_son_una_primera')}</p>
        <div className="rv-cd__cuad">
          <Numero nombre="gpsObsoletoMin" etiqueta={t('conductores.forma.el_gps_se_da_por')} valor={valores.gpsObsoletoMin} deshabilitada={off} ayuda={t('conductores.forma.de_5_a_720')} />
          <Numero nombre="detenidoMin" etiqueta={t('conductores.forma.la_unidad_se_da_por')} valor={valores.detenidoMin} deshabilitada={off} ayuda={t('conductores.forma.de_5_a_720')} />
          <Numero nombre="segundoAvisoMin" etiqueta={t('conductores.forma.segundo_aviso_al_chofer_despues')} valor={valores.segundoAvisoMin} deshabilitada={off} ayuda={t('conductores.forma.de_5_a_720')} />
          <Numero nombre="escalarSenalMin" etiqueta={t('conductores.forma.avisar_al_jefe_por_falta')} valor={valores.escalarSenalMin} deshabilitada={off} ayuda={t('conductores.forma.de_5_a_720')} />
          <Numero nombre="silencioRespuestaMin" etiqueta={t('conductores.forma.chofer_sin_contestar_despues_de')} valor={valores.silencioRespuestaMin} deshabilitada={off} ayuda={t('conductores.forma.de_5_a_720')} />
        </div>
      </Seccion>

      <Seccion id="cfg-escalera" titulo={t('conductores.forma.estrategia_de_recordatorios')}>
        <div className="rv-cd__cuad">
          <CampoTexto etiqueta={t('conductores.forma.escalera_al_chofer_minutos_desde')} name="f_solicitudesMin" defaultValue={valores.solicitudesMin} disabled={off}
            placeholder="0, 15, 30, 45" ayuda={t('conductores.forma.el_primero_es_la_solicitud')} />
          <Numero nombre="escalarTrasMin" etiqueta={t('conductores.forma.avisar_al_patio_a_los')} valor={valores.escalarTrasMin} deshabilitada={off} ayuda={t('conductores.forma.debe_ser_despues_del_ultimo')} />
          <Numero nombre="segundoNivelMin" etiqueta={t('conductores.forma.subir_al_jefe_general_despues')} valor={valores.segundoNivelMin} deshabilitada={off} />
          <Numero nombre="topeDiarioChofer" etiqueta={t('conductores.forma.tope_diario_de_mensajes_por')} valor={valores.topeDiarioChofer} deshabilitada={off} />
          <Numero nombre="posponerMin" etiqueta={t('conductores.forma.voy_con_retraso_aplaza_min')} valor={valores.posponerMin} deshabilitada={off} />
          <Numero nombre="ventanaCorreccionMin" etiqueta={t('conductores.forma.el_chofer_puede_corregir_su')} valor={valores.ventanaCorreccionMin} deshabilitada={off} />
        </div>
      </Seccion>

      <Seccion id="cfg-ventana" titulo={t('conductores.forma.ventana_horaria_y_dias')} resumen={`${valores.horaInicio}:00–${valores.horaFin}:00`}>
        <p className="rv-cd__nota">{rico(t('conductores.forma.zona_horaria_de_la_flota'), { strong: <strong>{config.zonaHoraria}</strong> })}</p>
        {avisoZona(config.zonaHoraria) && <p role="alert" className="rv-cd__nota" data-tono="bad">{avisoZona(config.zonaHoraria)}</p>}
        <div className="rv-cd__cuad">
          <Numero nombre="horaInicio" etiqueta={t('conductores.forma.desde_las_0_a_23')} valor={valores.horaInicio} deshabilitada={off} />
          <Numero nombre="horaFin" etiqueta={t('conductores.forma.hasta_las_1_a_24')} valor={valores.horaFin} deshabilitada={off} />
        </div>
        <Fieldset leyenda={t('conductores.forma.dias_permitidos')}>
          <div className="rv-cd__dias">
            {NOMBRES_DIA.map((n, i) => (
              <CasillaV2 key={n} name={`f_dia_${i + 1}`} value="si" defaultChecked={config.diasSemana.includes(i + 1)} disabled={off} etiqueta={n} />
            ))}
          </div>
        </Fieldset>
        <p className="rv-cd__micro">{t('conductores.forma.fuera_de_la_ventana_el')}</p>
      </Seccion>

      <Seccion id="cfg-plazos" titulo={t('conductores.forma.plazos_cuando_el_viaje_no')}>
        <div className="rv-cd__cuad">
          <Numero nombre="anticipoCitaMin" etiqueta={t('conductores.forma.pedir_la_llegada_a_carga')} valor={valores.anticipoCitaMin} deshabilitada={off} />
          <Numero nombre="esperaSinCitaMin" etiqueta={t('conductores.forma.sin_cita_esperar_tras_aceptar')} valor={valores.esperaSinCitaMin} deshabilitada={off} />
          <Numero nombre="esperaCargaMin" etiqueta={t('conductores.forma.carga_esperar_antes_de_pedir')} valor={valores.esperaCargaMin} deshabilitada={off} />
          <Numero nombre="trayectoSinEtaMin" etiqueta={t('conductores.forma.trayecto_sin_eta_min')} valor={valores.trayectoSinEtaMin} deshabilitada={off} />
          <Numero nombre="esperaDescargaMin" etiqueta={t('conductores.forma.descarga_esperar_antes_de_pedir')} valor={valores.esperaDescargaMin} deshabilitada={off} />
          <Numero nombre="regresoMin" etiqueta={t('conductores.forma.regreso_esperar_tras_la_salida')} valor={valores.regresoMin} deshabilitada={off} />
        </div>
      </Seccion>

      <Seccion id="cfg-ubicacion" titulo={t('conductores.forma.validacion_contra_la_ubicacion_y')}>
        <Casilla nombre="validarUbicacion" etiqueta={t('conductores.forma.comparar_cada_llegada_contra_el')} marcada={config.validarUbicacion} deshabilitada={off}
          ayuda={t('conductores.forma.sin_dato_suficiente_dice_sin')} />
        <Casilla nombre="pedirUbicacion" etiqueta={t('conductores.forma.pedirle_al_chofer_su_ubicacion')} marcada={config.pedirUbicacion} deshabilitada={off} />
        <Casilla nombre="pedirFotoEvidencia" etiqueta={t('conductores.forma.invitar_al_chofer_a_mandar')} marcada={config.pedirFotoEvidencia} deshabilitada={off} />
        <Casilla nombre="fotoRegistraHito" etiqueta={t('conductores.forma.la_foto_cuenta_como_aviso')} marcada={config.fotoRegistraHito} deshabilitada={off}
          ayuda={t('conductores.forma.con_la_hora_del_mensaje')} />
        <div className="rv-cd__cuad">
          <Numero nombre="toleranciaUbicacionM" etiqueta={t('conductores.forma.tolerancia_sobre_el_radio_m')} valor={valores.toleranciaUbicacionM} deshabilitada={off} ayuda={t('conductores.forma.supuesto_ajustalo_con_tus_datos')} />
          <Numero nombre="ventanaUbicacionMin" etiqueta={t('conductores.forma.ventana_para_comparar_la_posicion')} valor={valores.ventanaUbicacionMin} deshabilitada={off} />
          <Numero nombre="margenAcercamientoM" etiqueta={t('conductores.forma.margen_de_acercamiento_a_la')} valor={valores.margenAcercamientoM} deshabilitada={off}
            ayuda={t('conductores.forma.cuantos_metros_antes_del_borde')} />
        </div>
      </Seccion>

      <Seccion id="cfg-avisos" titulo={t('conductores.forma.avisos_a_la_oficina_y')}>
        <Casilla nombre="avisarOficinaLlegada" etiqueta={t('conductores.forma.avisar_a_la_oficina_la')} marcada={config.avisarOficinaLlegada} deshabilitada={off} />
        <Casilla nombre="avisarOficinaSalida" etiqueta={t('conductores.forma.avisar_a_la_oficina_la_2')} marcada={config.avisarOficinaSalida} deshabilitada={off} />
        <Casilla nombre="avisarLlegadaSinConfirmar" etiqueta={t('conductores.forma.avisar_al_jefe_de_trafico')} marcada={config.avisarLlegadaSinConfirmar} deshabilitada={off}
          ayuda={t('conductores.forma.un_solo_aviso_por_llegada')} />
        <Casilla nombre="detectarHitosGps" etiqueta={t('conductores.forma.dar_por_hecha_la_llegada')} marcada={config.detectarHitosGps} deshabilitada={off}
          ayuda={t('conductores.forma.el_tractor_entra_o_sale')} />
        <Casilla nombre="avisarSenalVida" etiqueta={t('conductores.forma.preguntar_sigues_bien_si_el')} marcada={config.avisarSenalVida} deshabilitada={off}
          ayuda={t('conductores.forma.si_la_ultima_posicion_queda')} />
        {puedeForzarPreflight && (
          <CasillaV2 name="forzarPreflight" value="si" disabled={off} etiqueta={t('conductores.forma.encender_la_senal_de_vida')} />
        )}
        <div className="rv-cd__cuad">
          <Numero nombre="estadiaAlertaCargaMin" etiqueta={t('conductores.forma.alerta_de_estadia_en_carga')} valor={valores.estadiaAlertaCargaMin} deshabilitada={off} placeholder={t('conductores.forma.vacio_sin_alerta')} ayuda={t('conductores.forma.de_15_a_4_320')} />
          <Numero nombre="estadiaAlertaDescargaMin" etiqueta={t('conductores.forma.alerta_de_estadia_en_descarga')} valor={valores.estadiaAlertaDescargaMin} deshabilitada={off} placeholder={t('conductores.forma.vacio_sin_alerta')} />
        </div>
      </Seccion>

      <Seccion id="cfg-contactos" titulo={t('conductores.forma.a_quien_se_escala')}>
        <p className="rv-cd__nota">
          {rico(t('conductores.forma.es_el_patio_responsable_si'), { strong: <strong>{t('conductores.forma.nivel_1')}</strong>, strong2: <strong>{t('conductores.forma.nivel_2')}</strong> })}
        </p>
        <input type="hidden" name="c_filas" value={filas} />
        <div className="rv-cd__pila">
          {[...new Array<number>(filas).keys()].map((i) => {
            const c = contactos[i];
            return (
              <div key={`${i}-${c?.telefono ?? 'nuevo'}`} className="rv-cd__cuad">
                <CampoSelect etiqueta={t('conductores.forma.nivel_del_contacto', { v0: i + 1 })} etiquetaOculta name={`c_nivel_${i}`} defaultValue={String(c?.nivel ?? 1)} disabled={off}>
                  <option value="1">{t('conductores.forma.nivel_1_patio')}</option><option value="2">{t('conductores.forma.nivel_2_jefe_general')}</option>
                </CampoSelect>
                <CampoTexto etiqueta={t('conductores.forma.nombre_del_contacto', { v0: i + 1 })} etiquetaOculta name={`c_nombre_${i}`} defaultValue={c?.nombre ?? ''} disabled={off} maxLength={80} placeholder={t('conductores.forma.nombre')} />
                <CampoTexto etiqueta={t('conductores.forma.telefono_del_contacto', { v0: i + 1 })} etiquetaOculta name={`c_tel_${i}`} defaultValue={c ? c.telefono.replace(/^52/, '') : ''} disabled={off} inputMode="tel" placeholder={t('conductores.forma.10_digitos')} />
                <CampoSelect etiqueta={t('conductores.forma.patio_del_contacto', { v0: i + 1 })} etiquetaOculta name={`c_patio_${i}`} defaultValue={c?.terminalId ?? ''} disabled={off}>
                  <option value="">{t('conductores.forma.toda_la_flota')}</option>
                  {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </CampoSelect>
              </div>
            );
          })}
        </div>
      </Seccion>

      {puedeEditar ? (
        <div className="rv-cd__pila--s">
          <div><Guardar /></div>
          <AvisoResultado estado={estado} />
        </div>
      ) : (
        <p className="rv-cd__nota" data-tono="faint">{t('conductores.forma.solo_el_dueno_de_la')}</p>
      )}
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// «OPERADORES DEL PILOTO» (0800): quién está en el seguimiento del Agente 5. Cada alta y cada baja es una acción de servidor
// aparte (otro formulario, no el de la configuración). El tope se aplica en el servidor; aquí solo se enseña el contador.
// ═══════════════════════════════════════════════════════════════════════════

export interface OperadorPilotoVista { id: string; nombre: string; telefono: string }
export interface DatosVoluntarios {
  tope: number;
  voluntarios: OperadorPilotoVista[];
  /** Activos, con teléfono válido, que aún no están en el piloto (ya filtrados por la búsqueda). */
  candidatos: OperadorPilotoVista[];
  busqueda: string;
}
export type AccionVoluntario = (previo: ResultadoConfig, fd: FormData) => Promise<ResultadoConfig>;

const diezDigitos = (tel: string): string => tel.replace(/\D/g, '').replace(/^521?(?=\d{10}$)/, '');

function BotonVoluntario({ texto, enCurso }: { texto: string; enCurso: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" loading={pending}>{pending ? enCurso : texto}</Boton>
  );
}

function FilaVoluntario({ op, accion, puedeEditar }: { op: OperadorPilotoVista; accion: AccionVoluntario; puedeEditar: boolean }) {
  const { t } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <li className="rv-cd__item">
      <form action={enviar} className="rv-cd__linea" aria-label={t('conductores.forma.retirar_a_del_piloto', { nombre: op.nombre })}>
        <span><strong>{op.nombre}</strong> <span className="rv-cd__faint">{diezDigitos(op.telefono)}</span></span>
        <input type="hidden" name="operadorId" value={op.id} />
        {puedeEditar && <BotonVoluntario texto={t('conductores.forma.retirar_del_piloto')} enCurso="Retirando…" />}
      </form>
      <AvisoResultado estado={estado} />
    </li>
  );
}

export function SeccionVoluntarios({ datos, puedeEditar, accionAlta, accionBaja, parametros }: {
  datos: DatosVoluntarios;
  puedeEditar: boolean;
  accionAlta: AccionVoluntario;
  accionBaja: AccionVoluntario;
  /** Los parámetros de la URL que la búsqueda debe conservar (flota elegida, etc.), sin `q`. */
  parametros: Array<[string, string]>;
}) {
  const { t } = useT('agentes', agentesEs);
  const [estadoAlta, enviarAlta] = useActionState(accionAlta, null);
  const n = datos.voluntarios.length;
  return (
    <Seccion id="cfg-voluntarios" titulo={t('conductores.forma.operadores_del_piloto')} abierto resumen={`${n} de ${datos.tope}`}>
      <p className="rv-cd__nota">
        {t('conductores.forma.el_agente_solo_da_seguimiento')}
      </p>
      <p className="rv-cd__medio" aria-live="polite">{t('conductores.forma.de_operadores_en_el_piloto', { n, tope: datos.tope })}</p>
      {n > 0 ? (
        <ul className="rv-cd__lista">
          {datos.voluntarios.map((v) => <FilaVoluntario key={v.id} op={v} accion={accionBaja} puedeEditar={puedeEditar} />)}
        </ul>
      ) : (
        <p className="rv-cd__nota" data-tono="faint">{t('conductores.forma.todavia_no_hay_operadores_en')}</p>
      )}
      {puedeEditar ? (
        <div className="rv-cd__pila">
          <BarraFiltros buscar accion="?" enLinea etiqueta={t('conductores.forma.buscar_operador')} ocultos={parametros.map(([k, v]) => [k, v] as const)}
            nActivos={datos.busqueda ? 1 : 0} limpiarHref={`?${new URLSearchParams(parametros).toString()}`}>
            <FiltroBusqueda nombre="q" valor={datos.busqueda} placeholder={t('conductores.forma.nombre_o_telefono')} etiqueta={t('conductores.forma.buscar_operador_activo_nombre_o')} />
          </BarraFiltros>
          <form action={enviarAlta} className="rv-cd__linea" aria-label={t('conductores.forma.agregar_operador_al_piloto')}>
            <CampoSelect etiqueta={t('conductores.forma.operador')} name="operadorId" defaultValue="" aria-label={t('conductores.forma.operador_a_agregar')}>
              <option value="" disabled>{datos.candidatos.length > 0 ? t('conductores.forma.elige_un_operador') : t('conductores.forma.sin_operadores_disponibles_con_ese')}</option>
              {datos.candidatos.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {diezDigitos(c.telefono)}</option>)}
            </CampoSelect>
            <BotonVoluntario texto={t('conductores.forma.agregar_al_piloto')} enCurso="Agregando…" />
          </form>
          <AvisoResultado estado={estadoAlta} />
        </div>
      ) : (
        <p className="rv-cd__nota" data-tono="faint">{t('conductores.forma.solo_el_dueno_de_la_2')}</p>
      )}
    </Seccion>
  );
}
