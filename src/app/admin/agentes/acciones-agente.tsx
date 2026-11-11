'use client';

import { useActionState, useId, useState } from 'react';
import { Power, Settings2 } from 'lucide-react';
import {
  AvisoResultado, Boton, CampoSelect, CampoTexto, CampoTextarea, Drawer, Icono, Modal, StatusChip,
  type ResultadoAccion,
} from '@/app/ui-v2/componentes';

import { useT } from '@/lib/i18n/proveedor';
import { admin_agentes as admin_agentesEs } from '@/lib/i18n/es/admin_agentes';
// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DE UNA FILA DEL CATÁLOGO: kill switch y configuración.
//
// El kill switch es un BOTÓN con diálogo de alerta y MOTIVO obligatorio — no un Switch: apagar o encender un agente suelta o corta
// una operación sobre clientes reales y debe dejar nota. Apagar y encender son simétricos (motivo + bitácora), igual que en el
// Copiloto. Cada fila tiene sus propios `useActionState`: en un incidente se tocan dos palancas seguidas y un spinner compartido
// esconde cuál respondió. NO decide permisos: los server actions re-gatean superadmin adentro.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionFila = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

export interface ConfigActual {
  estado: string;
  runnerHabilitado: boolean;
  presupuestoDiaUsd: number | null;
  modeloRol: string | null;
}

export function KillSwitchAgente({ palanca, nombre, apagado, accion }: {
  /** El id de la PALANCA (`agente:<id>`), no el del agente. */
  palanca: string;
  nombre: string;
  /** `true` apagado, `false` encendido. */
  apagado: boolean;
  accion: AccionFila;
}) {
  const { t } = useT('admin_agentes', admin_agentesEs);
  const [abiertoEn, setAbiertoEn] = useState<{ base: ResultadoAccion } | null>(null);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const idForma = useId();
  const operacion = apagado ? 'encender' : 'apagar';
  const ok = estado !== null && typeof estado === 'object' && 'ok' in estado && Boolean(estado.ok);
  // Se cierra solo cuando llega un resultado ok NUEVO (distinto del que había al abrir): derivado, sin setState dentro de un efecto.
  const abierto = abiertoEn !== null && !(ok && estado !== abiertoEn.base);
  const setAbierto = (v: boolean) => setAbiertoEn(v ? { base: estado } : null);

  return (
    <div className="rv-agente-fila-accion">
      <StatusChip tono={apagado ? 'bad' : 'ok'}>{apagado ? 'Apagado' : 'Encendido'}</StatusChip>
      <Boton tamano="sm" variante={apagado ? 'secondary' : 'danger'} icono={<Icono icono={Power} />} onClick={() => setAbierto(true)} aria-label={`${apagado ? 'Encender' : 'Apagar'} ${nombre}`}>
        {apagado ? 'Encender' : 'Apagar'}
      </Boton>
      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        alerta
        titulo={`${apagado ? 'Encender' : 'Apagar'} ${nombre}`}
        descripcion={apagado
          ? t('agentes_acciones_agente.su_proxima_corrida_deja')
          : t('agentes_acciones_agente.corta_su_proxima_corrida')}
        pie={<>
          <Boton variante="ghost" onClick={() => setAbierto(false)}>Cancelar</Boton>
          <Boton type="submit" form={idForma} variante={apagado ? 'primary' : 'danger'} loading={pendiente}>{apagado ? t('agentes_acciones_agente.encender_agente') : t('agentes_acciones_agente.apagar_agente')}</Boton>
        </>}
      >
        <form id={idForma} action={enviar} className="rv-agente-forma">
          <input type="hidden" name="id" value={palanca} />
          <input type="hidden" name="operacion" value={operacion} />
          <CampoTextarea etiqueta={t('agentes_acciones_agente.motivo')} name="motivo" required obligatorio rows={2} placeholder={apagado ? t('agentes_acciones_agente.por_que_se_enciende') : t('agentes_acciones_agente.por_que_se_apaga')} />
          <AvisoResultado estado={estado} />
        </form>
      </Modal>
    </div>
  );
}

export function ConfigurarAgente({ id, nombre, actual, accion, estados }: {
  id: string;
  nombre: string;
  actual: ConfigActual;
  accion: AccionFila;
  estados: ReadonlyArray<{ valor: string; rotulo: string }>;
}) {
  const { t } = useT('admin_agentes', admin_agentesEs);
  const [abiertoEn, setAbiertoEn] = useState<{ base: ResultadoAccion } | null>(null);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const idForma = useId();
  const ok = estado !== null && typeof estado === 'object' && 'ok' in estado && Boolean(estado.ok);
  // Se cierra solo cuando llega un resultado ok NUEVO (distinto del que había al abrir): derivado, sin setState dentro de un efecto.
  const abierto = abiertoEn !== null && !(ok && estado !== abiertoEn.base);
  const setAbierto = (v: boolean) => setAbiertoEn(v ? { base: estado } : null);

  return (
    <>
      <Boton tamano="sm" variante="ghost" icono={<Icono icono={Settings2} />} onClick={() => setAbierto(true)} aria-label={t('agentes_acciones_agente.configurar', { nombre })}>Configurar</Boton>
      <Drawer
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        cierraConFondo={false}
        titulo={t('agentes_acciones_agente.configurar', { nombre })}
        descripcion={t('agentes_acciones_agente.solo_se_guarda_lo')}
        pie={<>
          <Boton variante="ghost" onClick={() => setAbierto(false)}>Cancelar</Boton>
          <Boton type="submit" form={idForma} variante="primary" loading={pendiente}>{t('agentes_acciones_agente.guardar_cambios')}</Boton>
        </>}
      >
        <form id={idForma} action={enviar} className="rv-agente-forma">
          <input type="hidden" name="id" value={id} />
          <CampoSelect etiqueta={t('agentes_acciones_agente.estado')} name="estado" defaultValue="" ayuda={t('agentes_acciones_agente.hoy', { estado: actual.estado })}>
            <option value="">{t('agentes_acciones_agente.sin_cambio')}</option>
            {estados.map((e) => <option key={e.valor} value={e.valor}>{e.rotulo}</option>)}
          </CampoSelect>
          <CampoSelect etiqueta={t('agentes_acciones_agente.runner')} name="runnerHabilitado" defaultValue="" ayuda={t('agentes_acciones_agente.hoy_sin_presupuesto_el', { runnerHabilitado: actual.runnerHabilitado ? 'habilitado' : 'no habilitado' })}>
            <option value="">{t('agentes_acciones_agente.sin_cambio')}</option>
            <option value="si">Habilitar</option>
            <option value="no">Deshabilitar</option>
          </CampoSelect>
          <CampoTexto
            etiqueta={t('agentes_acciones_agente.presupuesto_por_dia_usd')} name="presupuestoDiaUsd" tipo="text" inputMode="decimal" autoComplete="off"
            placeholder={t('agentes_acciones_agente.sin_cambio')}
            ayuda={t('agentes_acciones_agente.hoy_escribe_sin_tope', { presupuestoDiaUsd: actual.presupuestoDiaUsd === null ? 'sin tope declarado' : `${actual.presupuestoDiaUsd} USD` })}
          />
          <CampoTexto
            etiqueta={t('agentes_acciones_agente.rol_de_modelo')} name="modeloRol" autoComplete="off" placeholder={t('agentes_acciones_agente.sin_cambio')}
            ayuda={t('agentes_acciones_agente.hoy_escribe_sin_declarar', { modeloRol: actual.modeloRol ?? 'sin declarar' })}
          />
          <CampoTextarea etiqueta={t('agentes_acciones_agente.motivo')} name="motivo" required obligatorio rows={2} placeholder={t('agentes_acciones_agente.por_que_se_hace')} />
          <AvisoResultado estado={estado} />
        </form>
      </Drawer>
    </>
  );
}
