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
import { Aviso, AvisoCompacto, BotonEnlace, CampoSelect, CampoTexto, Icono, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';

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
  const [t, setT] = useState<CamposTexto>(() => textoDeConfig(config));
  const poner = (campo: keyof CamposTexto) => (e: { target: { value: string } }) => setT((p) => ({ ...p, [campo]: e.target.value }));
  const errores = erroresEnLinea(t);
  const nombreAlerta = personas.find((p) => p.id === t.destinatarioAlertaUsuario)?.nombre ?? null;
  const apiBloqueado = !conector.hay;
  const frase = errores.reintentosMax || errores.frecuenciaMin
    ? 'Corrige los reintentos y la frecuencia para ver cómo quedaría el aviso.'
    : frasePrevia(Number(t.reintentosMax), Number(t.frecuenciaMin), nombreDestinatario(t.destinatarioAlertaCorreo, nombreAlerta));
  const campo = (id: keyof CamposTexto, rotulo: string, props: { inputMode?: 'numeric'; placeholder?: string; tipo?: 'email' } = {}) => (
    <CampoTexto id={`cs-${id}`} etiqueta={rotulo} name={id} value={t[id]} onChange={poner(id)} autoComplete="off" spellCheck={false}
      error={errores[id]} inputMode={props.inputMode} placeholder={props.placeholder} tipo={props.tipo} />
  );
  const persona = (id: keyof CamposTexto, rotulo: string) => (
    <CampoSelect id={`cs-${id}`} etiqueta={rotulo} name={id} value={t[id]} onChange={poner(id)}>
      <option value="">Nadie en particular</option>
      {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </CampoSelect>
  );
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}

      <Tarjeta titulo="Cómo sale la plantilla">
        <div className="rv-cp__pila">
          <CampoSelect id="cs-modo" etiqueta="Modo de salida" name="modo" value={t.modo} onChange={poner('modo')}
            ayuda={apiBloqueado ? 'El modo API se activa cuando haya una conexión probada con el sistema del cliente. Mientras tanto, la plantilla se descarga y se sube a mano.' : undefined}>
            <option value="descarga">Descarga (la subes tú al sistema del cliente)</option>
            <option value="api" disabled={apiBloqueado}>API (el agente la sube solo){apiBloqueado ? ' — todavía no disponible' : ''}</option>
          </CampoSelect>
          {apiBloqueado && <AvisoCompacto tono="warn" resumen="La subida automática al sistema del cliente NO está disponible todavía: depende de la API que el cliente entregue." mas="Hasta entonces todo envío es descarga y subida a mano, y la existencia del requerimiento en su sistema no se puede verificar («desconocido»)." />}
          <div className="rv-cp__cuad">
            <CampoSelect id="cs-plantilla" etiqueta="Plantilla por defecto" name="plantillaPorDefecto" value={t.plantillaPorDefecto} onChange={poner('plantillaPorDefecto')}>
              <option value="normal">Normal</option>
              <option value="nueva">Nueva</option>
            </CampoSelect>
            <CampoSelect id="cs-distancia" etiqueta="Formato de la distancia" name="distanciaFormato" value={t.distanciaFormato} onChange={poner('distanciaFormato')}>
              <option value="texto_km">Texto con «km»</option>
              <option value="numero">Solo el número</option>
            </CampoSelect>
          </div>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Reintentos cuando el requerimiento no existe">
        <div className="rv-cp__pila">
          <div className="rv-cp__cuad">
            {campo('reintentosMax', 'Reintentos (veces)', { inputMode: 'numeric' })}
            {campo('frecuenciaMin', 'Frecuencia (minutos entre reintentos)', { inputMode: 'numeric' })}
            {campo('ventanaInicio', 'Ventana: desde (HH:MM, hora de la flota)', { placeholder: '08:00' })}
            {campo('ventanaFin', 'Ventana: hasta (HH:MM, hora de la flota)', { placeholder: '20:00' })}
          </div>
          <CampoSelect id="cs-desconocido" etiqueta="Si el sistema del cliente no puede decir si el requerimiento existe" name="siTmsDesconocido" value={t.siTmsDesconocido} onChange={poner('siTmsDesconocido')}>
            <option value="retener">Retener y avisar</option>
            <option value="enviar">Enviar de todos modos</option>
          </CampoSelect>
          <p data-testid="vista-previa" className="rv-cp__nota">{frase}</p>
        </div>
      </Tarjeta>

      <Tarjeta titulo="A quién se avisa">
        <div className="rv-cp__pila">
          <div className="rv-cp__cuad">
            {persona('destinatarioAlertaUsuario', 'Alertas: persona')}
            {campo('destinatarioAlertaCorreo', 'Alertas: correo', { tipo: 'email' })}
            {persona('destinatarioRevisionUsuario', 'Revisión de rechazos: persona')}
            {campo('destinatarioRevisionCorreo', 'Revisión de rechazos: correo', { tipo: 'email' })}
          </div>
          <p className="rv-cp__nota">Si no eliges a nadie, el aviso llega al jefe de tráfico por WhatsApp.</p>
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
  return (
    <MarcoPagina titulo="Configuración de la salida" apoyo="Cómo sale la plantilla hacia el sistema del cliente y qué hace el agente cuando algo falta." acciones={<BotonEnlace tamano="sm" href={`/dashboard/agentes/carta-porte${sufijo}`} icono={<Icono icono={ArrowLeft} tam={14} />}>Agente de Carta Porte</BotonEnlace>}>
      {esArranque && <Aviso tono="warn">{ROTULO_ARRANQUE}. Ajústalos cuando el cliente los defina.</Aviso>}

      <FormaAccion accion={acciones.guardar} className="rv-cp__pila">
        <Formulario config={config} personas={personas} conector={conector} ver={ver} />
        <BotonEnvio etiqueta="Guardar configuración" pendiente="Guardando…" />
      </FormaAccion>
      {conector.puedeProbar && (
        <FormaAccion accion={acciones.probar} className="rv-cp__pila">
          {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
          {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
          {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
          {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
          <BotonEnvio variante="secundario" etiqueta="Probar conexión" pendiente="Probando…" />
        </FormaAccion>
      )}
      {primerMes && accionPrimerMes && <SeccionPrimerMes primerMes={primerMes} ver={ver} accion={accionPrimerMes} />}
      {accionesCcp && ccp === null && (
        <Aviso tono="warn">No se pudieron leer los CCP timbrados recibidos. Recarga la pantalla; si sigue igual, avisa a soporte.</Aviso>
      )}
      {accionesCcp && ccp && <SeccionCcp activa={ccp.activa} filas={ccp.filas} ver={ver} acciones={accionesCcp} />}
    </MarcoPagina>
  );
}
