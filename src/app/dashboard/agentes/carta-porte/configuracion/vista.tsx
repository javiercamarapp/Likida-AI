'use client';

import { useState } from 'react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { ArrowLeft } from 'lucide-react';
import type { ConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { BotonEnvio, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';
import { SeccionCcp, type AccionesCcp } from './seccion_ccp';
import { SeccionPrimerMes } from './seccion_primer_mes';
import type { PrimerMesFila } from '@/lib/likida/carta_porte_docs/repo';
import type { CcpRecibidoVista } from '@/lib/likida/carta_porte_docs/ccp_respuesta_repo';
import { ROTULO_ARRANQUE, erroresEnLinea, frasePrevia, nombreDestinatario, textoDeConfig, type CamposTexto } from './formato';
import '../carta-porte.css';
import { Aviso, AvisoCompacto, BotonEnlace, CampoSelect, CampoTexto, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { MarcoConfigAgente } from '@/app/dashboard/agentes/marco-config';

/**
 * LA PANTALLA «CONFIGURACIÓN DE LA SALIDA» (T-A3-32): cómo sale la plantilla hacia el sistema del cliente, cuántas veces se
 * reintenta cuando el requerimiento aún no existe, cada cuánto, a quién se avisa y qué plantilla se usa por defecto.
 * Reintentos, frecuencia y destinatarios NO los definió el cliente: arrancan con valores propuestos, visibles y editables.
 * Nunca muestra ni pide credenciales: esas viven en el cofre del conector.
 */

export interface PersonaVista { id: string; nombre: string }
export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }
export interface AccionesConfiguracion { guardar: AccionDoc; probar: AccionDoc }

function Formulario({ config, personas, conector, ver }: { config: ConfigSalida; personas: PersonaVista[]; conector: { hay: boolean }; ver: VerComo }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [t, setT] = useState<CamposTexto>(() => textoDeConfig(config));
  const poner = (campo: keyof CamposTexto) => (e: { target: { value: string } }) => setT((p) => ({ ...p, [campo]: e.target.value }));
  const errores = erroresEnLinea(t);
  const nombreAlerta = personas.find((p) => p.id === t.destinatarioAlertaUsuario)?.nombre ?? null;
  const apiBloqueado = !conector.hay;
  const frase = errores.reintentosMax || errores.frecuenciaMin
    ? tx('rest.corrige_los_reintentos_y_la_frecuencia')
    : frasePrevia(Number(t.reintentosMax), Number(t.frecuenciaMin), nombreDestinatario(t.destinatarioAlertaCorreo, nombreAlerta, tx));
  const campo = (id: keyof CamposTexto, rotulo: string, props: { inputMode?: 'numeric'; placeholder?: string; tipo?: 'email' } = {}) => (
    <CampoTexto id={`cs-${id}`} etiqueta={rotulo} name={id} value={t[id]} onChange={poner(id)} autoComplete="off" spellCheck={false}
      error={errores[id]} inputMode={props.inputMode} placeholder={props.placeholder} tipo={props.tipo} />
  );
  const persona = (id: keyof CamposTexto, rotulo: string) => (
    <CampoSelect id={`cs-${id}`} etiqueta={rotulo} name={id} value={t[id]} onChange={poner(id)}>
      <option value="">{tx('rest.nadie_en_particular')}</option>
      {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </CampoSelect>
  );
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}

      <Tarjeta titulo={tx('rest.como_sale_la_plantilla')}>
        <div className="rv-cp__pila">
          <CampoSelect id="cs-modo" etiqueta={tx('rest.modo_de_salida')} name="modo" value={t.modo} onChange={poner('modo')}
            ayuda={apiBloqueado ? tx('rest.el_modo_api_se_activa_cuando') : undefined}>
            <option value="descarga">{tx('rest.descarga_la_subes_tu_al_sistema')}</option>
            <option value="api" disabled={apiBloqueado}>{tx('rest.api_el_agente_la_sube_solo')}{apiBloqueado ? tx('rest.todavia_no_disponible') : ''}</option>
          </CampoSelect>
          {apiBloqueado && <AvisoCompacto tono="warn" resumen={tx('rest.la_subida_automatica_al_sistema_del')} mas={tx('rest.hasta_entonces_todo_envio_es_descarga')} />}
          <div className="rv-cp__cuad">
            <CampoSelect id="cs-plantilla" etiqueta={tx('rest.plantilla_por_defecto')} name="plantillaPorDefecto" value={t.plantillaPorDefecto} onChange={poner('plantillaPorDefecto')}>
              <option value="normal">{tx('rest.normal')}</option>
              <option value="nueva">{tx('rest.nueva')}</option>
            </CampoSelect>
            <CampoSelect id="cs-distancia" etiqueta={tx('rest.formato_de_la_distancia')} name="distanciaFormato" value={t.distanciaFormato} onChange={poner('distanciaFormato')}>
              <option value="texto_km">{tx('rest.texto_con_km')}</option>
              <option value="numero">{tx('rest.solo_el_numero')}</option>
            </CampoSelect>
          </div>
        </div>
      </Tarjeta>

      <Tarjeta titulo={tx('rest.reintentos_cuando_el_requerimiento_no_existe')}>
        <div className="rv-cp__pila">
          <div className="rv-cp__cuad">
            {campo('reintentosMax', 'Reintentos (veces)', { inputMode: 'numeric' })}
            {campo('frecuenciaMin', 'Frecuencia (minutos entre reintentos)', { inputMode: 'numeric' })}
            {campo('ventanaInicio', tx('rest.ventana_desde_hh_mm_hora_de'), { placeholder: '08:00' })}
            {campo('ventanaFin', tx('rest.ventana_hasta_hh_mm_hora_de'), { placeholder: '20:00' })}
          </div>
          <CampoSelect id="cs-desconocido" etiqueta={tx('rest.si_el_sistema_del_cliente_no')} name="siTmsDesconocido" value={t.siTmsDesconocido} onChange={poner('siTmsDesconocido')}>
            <option value="retener">{tx('rest.retener_y_avisar')}</option>
            <option value="enviar">{tx('rest.enviar_de_todos_modos')}</option>
          </CampoSelect>
          <p data-testid="vista-previa" className="rv-cp__nota">{frase}</p>
        </div>
      </Tarjeta>

      <Tarjeta titulo={tx('rest.a_quien_se_avisa')}>
        <div className="rv-cp__pila">
          <div className="rv-cp__cuad">
            {persona('destinatarioAlertaUsuario', 'Alertas: persona')}
            {campo('destinatarioAlertaCorreo', 'Alertas: correo', { tipo: 'email' })}
            {persona('destinatarioRevisionUsuario', tx('rest.revision_de_rechazos_persona'))}
            {campo('destinatarioRevisionCorreo', tx('rest.revision_de_rechazos_correo'), { tipo: 'email' })}
          </div>
          <p className="rv-cp__nota">{tx('rest.si_no_eliges_a_nadie_el')}</p>
        </div>
      </Tarjeta>
    </>
  );
}

export function VistaConfiguracionSalida({ config, esArranque, personas, conector, sufijo = '', ver = {}, acciones, ccp, accionesCcp, primerMes, accionPrimerMes }: {
  config: ConfigSalida; esArranque: boolean; personas: PersonaVista[]; conector: { hay: boolean; puedeProbar: boolean };
  sufijo?: string; ver?: VerComo; acciones: AccionesConfiguracion;
  /** A37-A3-01: los CCP timbrados recibidos (omitido = la sección no se pinta; `null` = no se pudo leer). */
  ccp?: { activa: boolean | 'sin_migracion'; filas: CcpRecibidoVista[] | 'sin_migracion' } | null;
  accionesCcp?: AccionesCcp;
  /** OLA1-A3: el modo primer mes (omitido = la sección no se pinta; `no_disponible` = falta la 0938). */
  primerMes?: PrimerMesFila | 'no_disponible';
  accionPrimerMes?: AccionDoc;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  return (
    <MarcoConfigAgente titulo={tx('rest.configuracion_de_la_salida')} apoyo={tx('rest.como_sale_la_plantilla_hacia_el')} acciones={<BotonEnlace tamano="sm" href={`/dashboard/agentes/carta-porte${sufijo}`} icono={<Icono icono={ArrowLeft} tam={14} />}>{tx('rest.agente_de_carta_porte')}</BotonEnlace>}>
      {esArranque && <Aviso tono="warn">{ROTULO_ARRANQUE}{tx('rest.ajustalos_cuando_el_cliente_los_defina')}</Aviso>}

      <FormaAccion accion={acciones.guardar} className="rv-cp__pila">
        <Formulario config={config} personas={personas} conector={conector} ver={ver} />
        <BotonEnvio etiqueta={tx('conductores.forma.guardar_configuracion')} pendiente={tx('cobranza.formagasto.guardando')} />
      </FormaAccion>
      {conector.puedeProbar && (
        <FormaAccion accion={acciones.probar} className="rv-cp__pila">
          {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
          {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
          {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
          {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
          <BotonEnvio variante="secundario" etiqueta={tx('rest.probar_conexion')} pendiente={tx('rest.probando')} />
        </FormaAccion>
      )}
      {primerMes && accionPrimerMes && <SeccionPrimerMes primerMes={primerMes} ver={ver} accion={accionPrimerMes} />}
      {accionesCcp && ccp === null && (
        <Aviso tono="warn">{tx('rest.no_se_pudieron_leer_los_ccp')}</Aviso>
      )}
      {accionesCcp && ccp && <SeccionCcp activa={ccp.activa} filas={ccp.filas} ver={ver} acciones={accionesCcp} />}
    </MarcoConfigAgente>
  );
}
