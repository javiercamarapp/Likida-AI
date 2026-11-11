'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import './conductores.css';
import { Boton, Campo, CampoSelect, CampoTexto, Disclosure, Icono } from '@/app/ui-v2/componentes';

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
const AYUDA: Record<ModoAccion, string> = {
  capturar: 'El chofer no avisó y tú lo confirmaste por otro medio. Queda marcado como captura de oficina.',
  validar: 'Confirmas que el aviso del chofer es correcto (p. ej. lo verificaste con el cliente).',
  atender: 'Ya hablaste con el chofer o con el patio: el agente deja de insistir por este viaje.',
};

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
  const [estado, enviar] = useActionState(accion, null);
  return (
    <Disclosure titulo={TITULO[modo]} variante="linea">
      <form action={enviar} className="rv-cd__form">
        <input type="hidden" name="tipo" value={modo} />
        {modo === 'atender' ? <input type="hidden" name="viajeId" value={viajeId} /> : <input type="hidden" name="hitoId" value={hitoId ?? ''} />}
        <p className="rv-cd__micro">{AYUDA[modo]}</p>
        {modo === 'capturar' && (
          <Campo etiqueta="Hora del hito (hora de México)">
            <input type="datetime-local" name="hora" required className="rv-ctl" />
          </Campo>
        )}
        <CampoTexto etiqueta="Motivo (queda en la bitácora con tu nombre)" name="motivo" required minLength={5} maxLength={200} placeholder="p. ej. avisó por radio" />
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
  const [estado, enviar] = useActionState(accion, null);
  const opciones = (
    <>
      <option value="">(sin cambio)</option>
      <option value="__quitar">Quitar el sitio</option>
      {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
    </>
  );
  return (
    <Disclosure titulo="Asignar sitios" variante="linea">
      <form action={enviar} className="rv-cd__form">
        <input type="hidden" name="viajeId" value={viajeId} />
        <p className="rv-cd__micro">Contra estos sitios se compara cada «ya llegué». Sin sitio, la llegada queda «sin dato» (nunca «no coincide»).</p>
        {hayMas && (
          <p role="status" className="rv-cd__micro" data-tono="warn">
            Hay más sitios activos de los que caben en esta lista (solo salen los primeros {sitios.length} por nombre). Si no aparece el que buscas, ligarlo
            desde aquí no es posible todavía: avisa a soporte o asígnalo con las equivalencias de «Textos sin sitio» en el catálogo.
          </p>
        )}
        <div className="rv-cd__cuad">
          <CampoSelect etiqueta="Sitio de carga" name="origen" defaultValue="">{opciones}</CampoSelect>
          <CampoSelect etiqueta="Sitio de descarga" name="destino" defaultValue="">{opciones}</CampoSelect>
        </div>
        <div className="rv-cd__linea"><Enviar texto="Guardar sitios" /><Resultado r={estado} /></div>
      </form>
    </Disclosure>
  );
}
