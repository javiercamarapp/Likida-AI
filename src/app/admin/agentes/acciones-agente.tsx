'use client';

import { useActionState, useId, useState } from 'react';
import { Power, Settings2 } from 'lucide-react';
import {
  AvisoResultado, Boton, CampoSelect, CampoTexto, CampoTextarea, Drawer, Icono, Modal, StatusChip,
  type ResultadoAccion,
} from '@/app/ui-v2/componentes';

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
          ? 'Su próxima corrida deja de salir como saltada y vuelve a actuar sobre las flotas. Queda en la bitácora con tu motivo.'
          : 'Corta su próxima corrida en TODAS las flotas. Queda en la bitácora con tu motivo y se puede encender de nuevo desde aquí.'}
        pie={<>
          <Boton variante="ghost" onClick={() => setAbierto(false)}>Cancelar</Boton>
          <Boton type="submit" form={idForma} variante={apagado ? 'primary' : 'danger'} loading={pendiente}>{apagado ? 'Encender agente' : 'Apagar agente'}</Boton>
        </>}
      >
        <form id={idForma} action={enviar} className="rv-agente-forma">
          <input type="hidden" name="id" value={palanca} />
          <input type="hidden" name="operacion" value={operacion} />
          <CampoTextarea etiqueta="Motivo" name="motivo" required obligatorio rows={2} placeholder={apagado ? 'Por qué se enciende' : 'Por qué se apaga'} />
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
  const [abiertoEn, setAbiertoEn] = useState<{ base: ResultadoAccion } | null>(null);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const idForma = useId();
  const ok = estado !== null && typeof estado === 'object' && 'ok' in estado && Boolean(estado.ok);
  // Se cierra solo cuando llega un resultado ok NUEVO (distinto del que había al abrir): derivado, sin setState dentro de un efecto.
  const abierto = abiertoEn !== null && !(ok && estado !== abiertoEn.base);
  const setAbierto = (v: boolean) => setAbiertoEn(v ? { base: estado } : null);

  return (
    <>
      <Boton tamano="sm" variante="ghost" icono={<Icono icono={Settings2} />} onClick={() => setAbierto(true)} aria-label={`Configurar ${nombre}`}>Configurar</Boton>
      <Drawer
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        cierraConFondo={false}
        titulo={`Configurar ${nombre}`}
        descripcion="Solo se guarda lo que cambies. Cada cambio queda en la bitácora con el antes, el después y tu motivo."
        pie={<>
          <Boton variante="ghost" onClick={() => setAbierto(false)}>Cancelar</Boton>
          <Boton type="submit" form={idForma} variante="primary" loading={pendiente}>Guardar cambios</Boton>
        </>}
      >
        <form id={idForma} action={enviar} className="rv-agente-forma">
          <input type="hidden" name="id" value={id} />
          <CampoSelect etiqueta="Estado" name="estado" defaultValue="" ayuda={`Hoy: ${actual.estado}.`}>
            <option value="">Sin cambio</option>
            {estados.map((e) => <option key={e.valor} value={e.valor}>{e.rotulo}</option>)}
          </CampoSelect>
          <CampoSelect etiqueta="Runner" name="runnerHabilitado" defaultValue="" ayuda={`Hoy: ${actual.runnerHabilitado ? 'habilitado' : 'no habilitado'}. Sin presupuesto el runner no lo despacha.`}>
            <option value="">Sin cambio</option>
            <option value="si">Habilitar</option>
            <option value="no">Deshabilitar</option>
          </CampoSelect>
          <CampoTexto
            etiqueta="Presupuesto por día (USD)" name="presupuestoDiaUsd" tipo="text" inputMode="decimal" autoComplete="off"
            placeholder="Sin cambio"
            ayuda={`Hoy: ${actual.presupuestoDiaUsd === null ? 'sin tope declarado' : `${actual.presupuestoDiaUsd} USD`}. Escribe sin_tope para quitarlo.`}
          />
          <CampoTexto
            etiqueta="Rol de modelo" name="modeloRol" autoComplete="off" placeholder="Sin cambio"
            ayuda={`Hoy: ${actual.modeloRol ?? 'sin declarar'}. Escribe sin_declarar para quitarlo.`}
          />
          <CampoTextarea etiqueta="Motivo" name="motivo" required obligatorio rows={2} placeholder="Por qué se hace este cambio" />
          <AvisoResultado estado={estado} />
        </form>
      </Drawer>
    </>
  );
}
