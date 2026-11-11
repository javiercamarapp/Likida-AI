'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { ListChecks, MoreHorizontal, Power, Settings2 } from 'lucide-react';
import {
  AvisoResultado, Boton, CampoSelect, CampoTexto, CampoTextarea, Drawer, Icono, MenuItem, MenuList, Modal, Popover,
  type ResultadoAccion,
} from '@/app/ui-v2/componentes';

import { useT } from '@/lib/i18n/proveedor';
import { admin_agentes as admin_agentesEs } from '@/lib/i18n/es/admin_agentes';
// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DE UNA FILA DEL CATÁLOGO: kill switch y configuración, DENTRO del menú «⋯» de la fila (como Rovaq: la tabla muestra
// chip y fecha; las acciones, incluida la destructiva «Apagar», viven en el menú y no como un botón rojo por fila).
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

/** Un diálogo con su `useActionState` propio: se cierra solo cuando llega un resultado ok NUEVO (derivado, sin setState en un efecto). */
function useDialogo(accion: AccionFila) {
  const [abiertoEn, setAbiertoEn] = useState<{ base: ResultadoAccion } | null>(null);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const ok = estado !== null && typeof estado === 'object' && 'ok' in estado && Boolean(estado.ok);
  const abierto = abiertoEn !== null && !(ok && estado !== abiertoEn.base);
  const setAbierto = (v: boolean) => setAbiertoEn(v ? { base: estado } : null);
  return { estado, enviar, pendiente, abierto, setAbierto };
}

/**
 * El menú «⋯» de la fila: Configurar · Insumos · Apagar/Encender. Cada fila tiene sus propios `useActionState` (dos por fila): en un
 * incidente se tocan dos palancas seguidas y un spinner compartido esconde cuál respondió. `apagado === null` = la palanca de esta fila
 * no existe o no se pudo leer: el menú no ofrece apagar (nunca una acción sobre un estado desconocido).
 */
export function AccionesAgente({ id, nombre, palanca, apagado, accionPalanca, accionConfig, estados, actual, etiquetaInsumos }: {
  id: string;
  nombre: string;
  /** El id de la PALANCA (`agente:<id>`), no el del agente. */
  palanca: string;
  /** `true` apagado, `false` encendido, `null` sin palanca que mover. */
  apagado: boolean | null;
  accionPalanca: AccionFila;
  accionConfig: AccionFila;
  estados: ReadonlyArray<{ valor: string; rotulo: string }>;
  actual: ConfigActual;
  etiquetaInsumos: string;
}) {
  const { t } = useT('admin_agentes', admin_agentesEs);
  const [menu, setMenu] = useState(false);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const idFormaPalanca = useId();
  const idFormaConfig = useId();
  const pal = useDialogo(accionPalanca);
  const cfg = useDialogo(accionConfig);
  const encendiendo = apagado === true;
  const operacion = encendiendo ? 'encender' : 'apagar';

  return (
    <div className="rv-agente-acciones">
      <Boton ref={gatillo} tamano="sm" variante="ghost" className="rv-agente-menu-btn" icono={<Icono icono={MoreHorizontal} />}
        aria-label={t('agentes_acciones_agente.acciones_de', { nombre })} aria-controls={menu ? idMenu : undefined} onClick={() => setMenu((m) => !m)}>{null}</Boton>
      <Popover abierto={menu} onCerrar={() => setMenu(false)} ancla={gatillo} etiqueta={t('agentes_acciones_agente.acciones_de', { nombre })} alineacion="fin">
        <div id={idMenu}>
          <MenuList etiqueta={t('agentes_acciones_agente.acciones_de', { nombre })}>
            <MenuItem icono={<Icono icono={Settings2} />} onSelect={() => { setMenu(false); cfg.setAbierto(true); }}>Configurar</MenuItem>
            <MenuItem icono={<Icono icono={ListChecks} />} href={`/admin/agentes/${id}/insumos`}>{etiquetaInsumos}</MenuItem>
            {apagado !== null && (
              <MenuItem icono={<Icono icono={Power} />} peligro={!encendiendo} onSelect={() => { setMenu(false); pal.setAbierto(true); }}>
                {encendiendo ? 'Encender' : 'Apagar'}
              </MenuItem>
            )}
          </MenuList>
        </div>
      </Popover>

      <Modal
        abierto={pal.abierto}
        onCerrar={() => pal.setAbierto(false)}
        alerta
        titulo={`${encendiendo ? 'Encender' : 'Apagar'} ${nombre}`}
        descripcion={encendiendo
          ? t('agentes_acciones_agente.su_proxima_corrida_deja')
          : t('agentes_acciones_agente.corta_su_proxima_corrida')}
        pie={<>
          <Boton variante="ghost" onClick={() => pal.setAbierto(false)}>Cancelar</Boton>
          <Boton type="submit" form={idFormaPalanca} variante={encendiendo ? 'primary' : 'danger'} loading={pal.pendiente}>{encendiendo ? t('agentes_acciones_agente.encender_agente') : t('agentes_acciones_agente.apagar_agente')}</Boton>
        </>}
      >
        <form id={idFormaPalanca} action={pal.enviar} className="rv-agente-forma">
          <input type="hidden" name="id" value={palanca} />
          <input type="hidden" name="operacion" value={operacion} />
          <CampoTextarea etiqueta={t('agentes_acciones_agente.motivo')} name="motivo" required obligatorio rows={2} placeholder={encendiendo ? t('agentes_acciones_agente.por_que_se_enciende') : t('agentes_acciones_agente.por_que_se_apaga')} />
          <AvisoResultado estado={pal.estado} />
        </form>
      </Modal>

      <Drawer
        abierto={cfg.abierto}
        onCerrar={() => cfg.setAbierto(false)}
        cierraConFondo={false}
        titulo={t('agentes_acciones_agente.configurar', { nombre })}
        descripcion={t('agentes_acciones_agente.solo_se_guarda_lo')}
        pie={<>
          <Boton variante="ghost" onClick={() => cfg.setAbierto(false)}>Cancelar</Boton>
          <Boton type="submit" form={idFormaConfig} variante="primary" loading={cfg.pendiente}>{t('agentes_acciones_agente.guardar_cambios')}</Boton>
        </>}
      >
        <form id={idFormaConfig} action={cfg.enviar} className="rv-agente-forma">
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
          <AvisoResultado estado={cfg.estado} />
        </form>
      </Drawer>
    </div>
  );
}
