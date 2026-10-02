'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { AvisoResultado, type ResultadoUI } from '../../../../admin/ui/aviso-resultado';
import { FILAS_NUEVAS_CONTACTO, NOMBRES_DIA } from '@/lib/likida/conductor/config_forma';
import type { ConfigConductor } from '@/lib/likida/conductor/config';
import type { ContactoTrafico } from '@/lib/likida/conductor/escalamiento';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN DE FLOTA DEL AGENTE 5 (formulario). Sin JavaScript extra: las casillas y los campos son
// de HTML; el contacto nuevo son filas en blanco al final. El resultado se enseña con el aviso ÚNICO del
// panel (`AvisoResultado`): el error junto a los campos, donde se corrige.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoConfig = ResultadoUI;
export type AccionConfig = (previo: ResultadoConfig, fd: FormData) => Promise<ResultadoConfig>;

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';
const AYUDA = 'text-[11px] mt-1';

function Casilla({ nombre, etiqueta, ayuda, marcada, deshabilitada }: { nombre: string; etiqueta: string; ayuda?: string; marcada: boolean; deshabilitada: boolean }) {
  return (
    <label className="flex items-start gap-2 text-[12.5px]">
      <input type="checkbox" name={`f_${nombre}`} value="si" defaultChecked={marcada} disabled={deshabilitada} className="mt-0.5" />
      <span>{etiqueta}{ayuda && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{ayuda}</span>}</span>
    </label>
  );
}

function Numero({ nombre, etiqueta, valor, ayuda, deshabilitada, placeholder }: { nombre: string; etiqueta: string; valor: string; ayuda?: string; deshabilitada: boolean; placeholder?: string }) {
  return (
    <label>
      <span className={ETIQUETA}>{etiqueta}</span>
      <input name={`f_${nombre}`} defaultValue={valor} inputMode="numeric" disabled={deshabilitada} placeholder={placeholder} className={CAMPO} />
      {ayuda && <span className={AYUDA} style={{ color: 'var(--faint)' }}>{ayuda}</span>}
    </label>
  );
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 space-y-3" aria-labelledby={id}>
      <h2 id={id} className="font-display text-[15px] font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />{pending ? 'Guardando…' : 'Guardar configuración'}
    </button>
  );
}

export function FormaConfigConductor({ accion, config, valores, contactos, patios, puedeEditar }: {
  accion: AccionConfig;
  config: ConfigConductor;
  /** Los textos de los campos (ver `valoresDeForma`). */
  valores: Record<string, string>;
  contactos: ContactoTrafico[];
  patios: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
}) {
  const [estado, enviar] = useActionState(accion, null);
  const off = !puedeEditar;
  const filas = contactos.length + FILAS_NUEVAS_CONTACTO;
  return (
    <form action={enviar} className="space-y-4" aria-label="Configuración del agente Conductor">
      <Seccion id="cfg-estado" titulo="Estado del agente">
        <Casilla nombre="activo" etiqueta="Agente encendido para esta flota" marcada={config.activo} deshabilitada={off}
          ayuda="Apagado, el agente no pide ni persigue hitos; lo que el chofer escriba por WhatsApp se sigue registrando." />
        <Casilla nombre="confirmarAlChofer" etiqueta="Confirmarle al chofer cada hito que registra" marcada={config.confirmarAlChofer} deshabilitada={off} />
        <Casilla nombre="usarLlm" etiqueta="Entender con un modelo lo que las reglas no entienden" marcada={config.usarLlm} deshabilitada={off}
          ayuda="Solo cuando el mensaje parece hablar de un hito; nunca puede retirar ni validar un hito." />
      </Seccion>

      <Seccion id="cfg-escalera" titulo="Estrategia de recordatorios">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="sm:col-span-2">
            <span className={ETIQUETA}>Escalera al chofer (minutos desde que toca el hito)</span>
            <input name="f_solicitudesMin" defaultValue={valores.solicitudesMin} disabled={off} className={CAMPO} placeholder="0, 15, 30, 45" />
            <span className={AYUDA} style={{ color: 'var(--faint)' }}>El primero es la solicitud; los demás, recordatorios. Ascendente, de 1 a 6 valores.</span>
          </label>
          <Numero nombre="escalarTrasMin" etiqueta="Avisar al patio a los (min)" valor={valores.escalarTrasMin} deshabilitada={off} ayuda="Debe ser después del último recordatorio." />
          <Numero nombre="segundoNivelMin" etiqueta="Subir al jefe general después de (min)" valor={valores.segundoNivelMin} deshabilitada={off} />
          <Numero nombre="topeDiarioChofer" etiqueta="Tope diario de mensajes por chofer" valor={valores.topeDiarioChofer} deshabilitada={off} />
          <Numero nombre="posponerMin" etiqueta="«Voy con retraso» aplaza (min)" valor={valores.posponerMin} deshabilitada={off} />
          <Numero nombre="ventanaCorreccionMin" etiqueta="El chofer puede corregir su último hito durante (min)" valor={valores.ventanaCorreccionMin} deshabilitada={off} />
        </div>
      </Seccion>

      <Seccion id="cfg-ventana" titulo="Ventana horaria (hora de México)">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Numero nombre="horaInicio" etiqueta="Desde las (0 a 23)" valor={valores.horaInicio} deshabilitada={off} />
          <Numero nombre="horaFin" etiqueta="Hasta las (1 a 24)" valor={valores.horaFin} deshabilitada={off} />
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]" disabled={off}>
          <legend className={ETIQUETA}>Días permitidos</legend>
          {NOMBRES_DIA.map((n, i) => (
            <label key={n} className="flex items-center gap-1.5 capitalize">
              <input type="checkbox" name={`f_dia_${i + 1}`} value="si" defaultChecked={config.diasSemana.includes(i + 1)} />{n}
            </label>
          ))}
        </fieldset>
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Fuera de la ventana el agente no manda nada, tampoco las escalaciones.</p>
      </Seccion>

      <Seccion id="cfg-plazos" titulo="Plazos cuando el viaje no trae cita (supuestos tuyos, no mediciones)">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Numero nombre="anticipoCitaMin" etiqueta="Pedir la llegada a carga antes de la cita (min)" valor={valores.anticipoCitaMin} deshabilitada={off} />
          <Numero nombre="esperaSinCitaMin" etiqueta="Sin cita: esperar tras aceptar (min)" valor={valores.esperaSinCitaMin} deshabilitada={off} />
          <Numero nombre="esperaCargaMin" etiqueta="Carga: esperar antes de pedir la salida (min)" valor={valores.esperaCargaMin} deshabilitada={off} />
          <Numero nombre="trayectoSinEtaMin" etiqueta="Trayecto sin ETA (min)" valor={valores.trayectoSinEtaMin} deshabilitada={off} />
          <Numero nombre="esperaDescargaMin" etiqueta="Descarga: esperar antes de pedir la salida (min)" valor={valores.esperaDescargaMin} deshabilitada={off} />
          <Numero nombre="regresoMin" etiqueta="Regreso: esperar tras la salida (min)" valor={valores.regresoMin} deshabilitada={off} />
        </div>
      </Seccion>

      <Seccion id="cfg-ubicacion" titulo="Validación contra la ubicación y evidencia">
        <Casilla nombre="validarUbicacion" etiqueta="Comparar cada llegada contra el sitio del viaje (pin de WhatsApp o GPS)" marcada={config.validarUbicacion} deshabilitada={off}
          ayuda="Sin dato suficiente dice «sin dato», nunca acusa al chofer." />
        <Casilla nombre="pedirUbicacion" etiqueta="Pedirle al chofer su ubicación cuando falta (solo si el viaje tiene sitio)" marcada={config.pedirUbicacion} deshabilitada={off} />
        <Casilla nombre="pedirFotoEvidencia" etiqueta="Invitar al chofer a mandar la foto del sello o del andén" marcada={config.pedirFotoEvidencia} deshabilitada={off} />
        <Casilla nombre="fotoRegistraHito" etiqueta="La foto cuenta como aviso: un «andén», «sello» o «recibido» sin aviso previo registra el hito" marcada={config.fotoRegistraHito} deshabilitada={off}
          ayuda="Con la hora del mensaje del chofer y la foto como evidencia. Apagado, la foto solo se cuelga de un aviso ya registrado." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Numero nombre="toleranciaUbicacionM" etiqueta="Tolerancia sobre el radio (m)" valor={valores.toleranciaUbicacionM} deshabilitada={off} ayuda="Supuesto; ajústalo con tus datos." />
          <Numero nombre="ventanaUbicacionMin" etiqueta="Ventana para comparar la posición (min)" valor={valores.ventanaUbicacionMin} deshabilitada={off} />
        </div>
      </Seccion>

      <Seccion id="cfg-avisos" titulo="Avisos a la oficina y estadías">
        <Casilla nombre="avisarOficinaLlegada" etiqueta="Avisar a la oficina la hora exacta de cada llegada" marcada={config.avisarOficinaLlegada} deshabilitada={off} />
        <Casilla nombre="avisarOficinaSalida" etiqueta="Avisar a la oficina la hora exacta de cada salida" marcada={config.avisarOficinaSalida} deshabilitada={off} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Numero nombre="estadiaAlertaCargaMin" etiqueta="Alerta de estadía en carga (min)" valor={valores.estadiaAlertaCargaMin} deshabilitada={off} placeholder="vacío = sin alerta" ayuda="De 15 a 4,320. Vacío la apaga." />
          <Numero nombre="estadiaAlertaDescargaMin" etiqueta="Alerta de estadía en descarga (min)" valor={valores.estadiaAlertaDescargaMin} deshabilitada={off} placeholder="vacío = sin alerta" />
        </div>
      </Seccion>

      <Seccion id="cfg-contactos" titulo="A quién se escala">
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          <strong>Nivel 1</strong> es el patio responsable (si eliges un patio, solo atiende viajes de ese patio); <strong>nivel 2</strong> es el jefe general.
          Para quitar un contacto, borra su nombre y su teléfono. Números mexicanos de 10 dígitos.
        </p>
        <input type="hidden" name="c_filas" value={filas} />
        <div className="space-y-2">
          {[...new Array<number>(filas).keys()].map((i) => {
            const c = contactos[i];
            return (
              <div key={`${i}-${c?.telefono ?? 'nuevo'}`} className="grid grid-cols-2 sm:grid-cols-[110px_1fr_160px_1fr] gap-2">
                <select name={`c_nivel_${i}`} defaultValue={String(c?.nivel ?? 1)} disabled={off} aria-label={`Nivel del contacto ${i + 1}`} className={CAMPO}>
                  <option value="1">Nivel 1 (patio)</option><option value="2">Nivel 2 (jefe general)</option>
                </select>
                <input name={`c_nombre_${i}`} defaultValue={c?.nombre ?? ''} disabled={off} maxLength={80} placeholder="Nombre" aria-label={`Nombre del contacto ${i + 1}`} className={CAMPO} />
                <input name={`c_tel_${i}`} defaultValue={c ? c.telefono.replace(/^52/, '') : ''} disabled={off} inputMode="tel" placeholder="10 dígitos" aria-label={`Teléfono del contacto ${i + 1}`} className={CAMPO} />
                <select name={`c_patio_${i}`} defaultValue={c?.terminalId ?? ''} disabled={off} aria-label={`Patio del contacto ${i + 1}`} className={CAMPO}>
                  <option value="">Toda la flota</option>
                  {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </Seccion>

      {puedeEditar ? (
        <div className="space-y-2">
          <Guardar />
          <AvisoResultado estado={estado} />
        </div>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota cambia esta configuración.</p>
      )}
    </form>
  );
}
