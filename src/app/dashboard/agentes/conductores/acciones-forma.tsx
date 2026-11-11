'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import './conductores.css';
import { Boton, Campo, CampoSelect, CampoTexto, Disclosure, Icono } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL JEFE SOBRE UN HITO (0385) — capturar a mano, validar, marcar atendido.
//
// El motivo es obligatorio y queda en la bitácora con quién y cuándo; la hora de una
// captura es HORA DE MÉXICO. El permiso de verdad lo comprueba el servidor
// (`ejecutarAccionOficina`): ocultar el botón no es un control de acceso, es cortesía.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoOficina = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionOficinaServidor = (previo: ResultadoOficina, fd: FormData) => Promise<ResultadoOficina>;
export type ModoAccion = 'capturar' | 'validar' | 'atender';


const TITULO: Record<ModoAccion, string> = { capturar: 'Capturar a mano', validar: 'Validar', atender: 'Marcar atendido' };
const BOTON: Record<ModoAccion, string> = { capturar: 'Guardar captura', validar: 'Validar hito', atender: 'Marcar atendido' };
const ayuda = (tx: TAgentes = TR_ES.t): Record<ModoAccion, string> => ({
  capturar: tx('rest.el_chofer_no_aviso_y_tu'),
  validar: tx('rest.confirmas_que_el_aviso_del_chofer'),
  atender: tx('rest.ya_hablaste_con_el_chofer_o'),
});

function Enviar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return <Boton type="submit" variante="primary" loading={pending}>{pending ? 'Guardando…' : texto}</Boton>;
}

function Resultado({ r }: { r: ResultadoOficina }) {
  if (!r) return null;
  return r.ok ? (
    <p role="status" className="rv-cd__icono-linea" data-tono="ok">
      <Icono icono={CheckCircle2} tam={14} />{r.mensaje}
    </p>
  ) : (
    <p role="alert" className="rv-cd__icono-linea rv-cd__nota" data-tono="bad">
      <Icono icono={TriangleAlert} tam={14} />{r.error}
    </p>
  );
}

function FormaAccion({ modo, accion, hitoId, viajeId }: { modo: ModoAccion; accion: AccionOficinaServidor; hitoId: string | null; viajeId: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <Disclosure titulo={TITULO[modo]} variante="linea">
      <form action={enviar} className="rv-cd__form">
        <input type="hidden" name="tipo" value={modo} />
        {modo === 'atender' ? <input type="hidden" name="viajeId" value={viajeId} /> : <input type="hidden" name="hitoId" value={hitoId ?? ''} />}
        <p className="rv-cd__micro">{ayuda(tx)[modo]}</p>
        {modo === 'capturar' && (
          <Campo etiqueta={tx('rest.hora_del_hito_hora_de_mexico')}>
            <input type="datetime-local" name="hora" required className="rv-ctl" />
          </Campo>
        )}
        <CampoTexto etiqueta={tx('rest.motivo_queda_en_la_bitacora_con')} name="motivo" required minLength={5} maxLength={200} placeholder={tx('rest.p_ej_aviso_por_radio')} />
        <div className="rv-cd__linea">
          <Enviar texto={BOTON[modo]} />
          <Resultado r={estado} />
        </div>
      </form>
    </Disclosure>
  );
}

/** Las acciones disponibles para un hito (o, con `atender`, para el viaje). Sin modos no pinta nada. */
export function AccionesHito({ accion, modos, hitoId, viajeId }: {
  accion: AccionOficinaServidor; modos: ModoAccion[]; hitoId: string | null; viajeId: string;
}) {
  if (modos.length === 0) return null;
  return (
    <div className="rv-cd__pila--s">
      {modos.map((m) => <FormaAccion key={m} modo={m} accion={accion} hitoId={hitoId} viajeId={viajeId} />)}
    </div>
  );
}

// ── Asignar el sitio de carga y de descarga de un viaje ─────────────────────

export type ResultadoSitios = ResultadoOficina;
export interface OpcionSitio { id: string; nombre: string; tipo: string }

export function FormaAsignarSitios({ accion, viajeId, sitios, hayMas = false }: { accion: AccionOficinaServidor; viajeId: string; sitios: OpcionSitio[]; hayMas?: boolean }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  const opciones = (
    <>
      <option value="">{tx('rest.sin_cambio')}</option>
      <option value="__quitar">{tx('rest.quitar_el_sitio')}</option>
      {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
    </>
  );
  return (
    <Disclosure titulo={tx('rest.asignar_sitios')} variante="linea">
      <form action={enviar} className="rv-cd__form">
        <input type="hidden" name="viajeId" value={viajeId} />
        <p className="rv-cd__micro">{tx('rest.contra_estos_sitios_se_compara_cada')}</p>
        {hayMas && (
          <p role="status" className="rv-cd__micro" data-tono="warn">{tx('rest.hay_mas_sitios_activos_de_los', { length: sitios.length })}</p>
        )}
        <div className="rv-cd__cuad">
          <CampoSelect etiqueta={tx('rest.sitio_de_carga')} name="origen" defaultValue="">{opciones}</CampoSelect>
          <CampoSelect etiqueta={tx('rest.sitio_de_descarga')} name="destino" defaultValue="">{opciones}</CampoSelect>
        </div>
        <div className="rv-cd__linea"><Enviar texto={tx('rest.guardar_sitios')} /><Resultado r={estado} /></div>
      </form>
    </Disclosure>
  );
}
