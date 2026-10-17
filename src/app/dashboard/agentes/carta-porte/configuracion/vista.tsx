'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Settings2 } from 'lucide-react';
import type { ConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { BotonEnvio, CAMPO, ETIQUETA, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';
import { ROTULO_ARRANQUE, erroresEnLinea, frasePrevia, nombreDestinatario, textoDeConfig, type CamposTexto } from './formato';

/**
 * LA PANTALLA «CONFIGURACIÓN DE LA SALIDA» (T-A3-32): cómo sale la plantilla hacia el sistema del cliente, cuántas veces se
 * reintenta cuando el requerimiento aún no existe, cada cuánto, a quién se avisa y qué plantilla se usa por defecto.
 * Reintentos, frecuencia y destinatarios NO los definió el cliente: arrancan con valores propuestos, visibles y editables.
 * Nunca muestra ni pide credenciales: esas viven en el cofre del conector.
 */

export interface PersonaVista { id: string; nombre: string }
export interface VerComo { tenant?: string; rol?: string; vista?: string }
export interface AccionesConfiguracion { guardar: AccionDoc; probar: AccionDoc }

const ESTILO = { background: 'var(--surface)' } as const;

function Error_({ id, mensaje }: { id: string; mensaje?: string }) {
  return mensaje ? <p id={id} role="alert" className="text-[11.5px] mt-1" style={{ color: 'var(--bad)' }}>{mensaje}</p> : null;
}

function Formulario({ config, personas, conector, ver }: { config: ConfigSalida; personas: PersonaVista[]; conector: { hay: boolean }; ver: VerComo }) {
  const [t, setT] = useState<CamposTexto>(() => textoDeConfig(config));
  const poner = (campo: keyof CamposTexto) => (e: { target: { value: string } }) => setT((p) => ({ ...p, [campo]: e.target.value }));
  const errores = erroresEnLinea(t);
  const nombreAlerta = personas.find((p) => p.id === t.destinatarioAlertaUsuario)?.nombre ?? null;
  const apiBloqueado = !conector.hay;
  const frase = errores.reintentosMax || errores.frecuenciaMin
    ? 'Corrige los reintentos y la frecuencia para ver cómo quedaría el aviso.'
    : frasePrevia(Number(t.reintentosMax), Number(t.frecuenciaMin), nombreDestinatario(t.destinatarioAlertaCorreo, nombreAlerta));
  const campo = (id: keyof CamposTexto, rotulo: string, props: Record<string, string> = {}) => (
    <div>
      <label htmlFor={`cs-${id}`} className={ETIQUETA}>{rotulo}</label>
      <input id={`cs-${id}`} name={id} value={t[id]} onChange={poner(id)} autoComplete="off" spellCheck={false}
        aria-invalid={errores[id] ? true : undefined} aria-describedby={errores[id] ? `cs-${id}-e` : undefined} className={CAMPO} style={ESTILO} {...props} />
      <Error_ id={`cs-${id}-e`} mensaje={errores[id]} />
    </div>
  );
  const persona = (id: keyof CamposTexto, rotulo: string) => (
    <div>
      <label htmlFor={`cs-${id}`} className={ETIQUETA}>{rotulo}</label>
      <select id={`cs-${id}`} name={id} value={t[id]} onChange={poner(id)} className={CAMPO} style={ESTILO}>
        <option value="">Nadie en particular</option>
        {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
    </div>
  );
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}

      <fieldset className="space-y-3">
        <legend className="text-[13px] font-medium mb-2">Cómo sale la plantilla</legend>
        <div>
          <label htmlFor="cs-modo" className={ETIQUETA}>Modo de salida</label>
          <select id="cs-modo" name="modo" value={t.modo} onChange={poner('modo')} className={CAMPO} style={ESTILO}>
            <option value="descarga">Descarga (la subes tú al sistema del cliente)</option>
            <option value="api" disabled={apiBloqueado}>API (el agente la sube solo){apiBloqueado ? ' — todavía no disponible' : ''}</option>
          </select>
          {apiBloqueado && <p className="text-[11.5px] mt-1" style={{ color: 'var(--muted)' }}>El modo API se activa cuando haya una conexión probada con el sistema del cliente. Mientras tanto, la plantilla se descarga y se sube a mano.</p>}
        </div>
        <div>
          <label htmlFor="cs-plantilla" className={ETIQUETA}>Plantilla por defecto</label>
          <select id="cs-plantilla" name="plantillaPorDefecto" value={t.plantillaPorDefecto} onChange={poner('plantillaPorDefecto')} className={CAMPO} style={ESTILO}>
            <option value="normal">Normal</option>
            <option value="nueva">Nueva</option>
          </select>
        </div>
        <div>
          <label htmlFor="cs-distancia" className={ETIQUETA}>Formato de la distancia</label>
          <select id="cs-distancia" name="distanciaFormato" value={t.distanciaFormato} onChange={poner('distanciaFormato')} className={CAMPO} style={ESTILO}>
            <option value="texto_km">Texto con «km»</option>
            <option value="numero">Solo el número</option>
          </select>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[13px] font-medium mb-2">Reintentos cuando el requerimiento no existe</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {campo('reintentosMax', 'Reintentos (veces)', { inputMode: 'numeric' })}
          {campo('frecuenciaMin', 'Frecuencia (minutos entre reintentos)', { inputMode: 'numeric' })}
          {campo('ventanaInicio', 'Ventana: desde (HH:MM, hora de la flota)', { placeholder: '08:00' })}
          {campo('ventanaFin', 'Ventana: hasta (HH:MM, hora de la flota)', { placeholder: '20:00' })}
        </div>
        <div>
          <label htmlFor="cs-desconocido" className={ETIQUETA}>Si el sistema del cliente no puede decir si el requerimiento existe</label>
          <select id="cs-desconocido" name="siTmsDesconocido" value={t.siTmsDesconocido} onChange={poner('siTmsDesconocido')} className={CAMPO} style={ESTILO}>
            <option value="retener">Retener y avisar</option>
            <option value="enviar">Enviar de todos modos</option>
          </select>
        </div>
        <p data-testid="vista-previa" className="text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>{frase}</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[13px] font-medium mb-2">A quién se avisa</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {persona('destinatarioAlertaUsuario', 'Alertas: persona')}
          {campo('destinatarioAlertaCorreo', 'Alertas: correo', { type: 'email' })}
          {persona('destinatarioRevisionUsuario', 'Revisión de rechazos: persona')}
          {campo('destinatarioRevisionCorreo', 'Revisión de rechazos: correo', { type: 'email' })}
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Si no eliges a nadie, el aviso llega al jefe de tráfico por WhatsApp.</p>
      </fieldset>
    </>
  );
}

export function VistaConfiguracionSalida({ config, esArranque, personas, conector, sufijo = '', ver = {}, acciones }: {
  config: ConfigSalida; esArranque: boolean; personas: PersonaVista[]; conector: { hay: boolean; puedeProbar: boolean };
  sufijo?: string; ver?: VerComo; acciones: AccionesConfiguracion;
}) {
  return (
    <div className="space-y-6">
      <Link href={`/dashboard/agentes/carta-porte${sufijo}`} className="inline-flex items-center gap-1.5 text-[12.5px] hover:opacity-75" style={{ color: 'var(--muted)' }}>
        <ArrowLeft width={14} height={14} strokeWidth={1.75} />Agente de Carta Porte
      </Link>
      <header className="space-y-1.5">
        <h1 className="text-[20px] font-semibold flex items-center gap-2"><Settings2 width={18} height={18} strokeWidth={1.75} />Configuración de la salida</h1>
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Cómo sale la plantilla hacia el sistema del cliente y qué hace el agente cuando algo falta.</p>
        {esArranque && <p role="note" className="text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>{ROTULO_ARRANQUE}. Ajústalos cuando el cliente los defina.</p>}
      </header>
      <FormaAccion accion={acciones.guardar} className="space-y-6">
        <Formulario config={config} personas={personas} conector={conector} ver={ver} />
        <BotonEnvio etiqueta="Guardar configuración" pendiente="Guardando…" />
      </FormaAccion>
      {conector.puedeProbar && (
        <FormaAccion accion={acciones.probar} className="space-y-3 pt-2">
          {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
          {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
          {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
          <BotonEnvio variante="secundario" etiqueta="Probar conexión" pendiente="Probando…" />
        </FormaAccion>
      )}
    </div>
  );
}
