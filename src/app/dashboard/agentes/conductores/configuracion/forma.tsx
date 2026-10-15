'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { AvisoResultado, type ResultadoUI } from '../../../../admin/ui/aviso-resultado';
import { FILAS_NUEVAS_CONTACTO, NOMBRES_DIA, OPCIONES_PERFIL, avisoZona } from '@/lib/likida/conductor/config_forma';
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

      <Seccion id="cfg-perfil" titulo="¿Qué sigue el agente?">
        <fieldset className="space-y-2" disabled={off}>
          <legend className={ETIQUETA}>Perfil de seguimiento</legend>
          {OPCIONES_PERFIL.map((o) => (
            <label key={o.valor} className="flex items-start gap-2 text-[12.5px]">
              <input type="radio" name="f_perfilSeguimiento" value={o.valor} defaultChecked={config.perfilSeguimiento === o.valor} className="mt-0.5" />
              <span>{o.etiqueta}<span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{o.ayuda}</span></span>
            </label>
          ))}
        </fieldset>
        <Casilla nombre="mostrarEstadosFrontera" etiqueta="Mostrar en el tablero los estados de frontera" marcada={config.mostrarEstadosFrontera} deshabilitada={off}
          ayuda="Solo informativo: no genera avisos al chofer ni escalamiento." />
        <Casilla nombre="aplicarSalidaDelTms" etiqueta="Dar por hecha la salida cuando tu sistema de despacho la reporta" marcada={config.aplicarSalidaDelTms} deshabilitada={off} />
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Estos tiempos son una primera propuesta; ajústalos con tus supervisores.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Numero nombre="gpsObsoletoMin" etiqueta="El GPS se da por viejo después de (min)" valor={valores.gpsObsoletoMin} deshabilitada={off} ayuda="De 5 a 720." />
          <Numero nombre="detenidoMin" etiqueta="La unidad se da por detenida después de (min)" valor={valores.detenidoMin} deshabilitada={off} ayuda="De 5 a 720." />
          <Numero nombre="segundoAvisoMin" etiqueta="Segundo aviso al chofer después de (min)" valor={valores.segundoAvisoMin} deshabilitada={off} ayuda="De 5 a 720." />
          <Numero nombre="escalarSenalMin" etiqueta="Avisar al jefe por falta de señal después de (min)" valor={valores.escalarSenalMin} deshabilitada={off} ayuda="De 5 a 720." />
          <Numero nombre="silencioRespuestaMin" etiqueta="Chofer sin contestar después de (min)" valor={valores.silencioRespuestaMin} deshabilitada={off} ayuda="De 5 a 720." />
        </div>
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

      <Seccion id="cfg-ventana" titulo="Ventana horaria y días">
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Zona horaria de la flota: <strong>{config.zonaHoraria}</strong> (solo lectura).</p>
        {avisoZona(config.zonaHoraria) && <p role="alert" className="text-[12px]" style={{ color: 'var(--bad)' }}>{avisoZona(config.zonaHoraria)}</p>}
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
          <Numero nombre="margenAcercamientoM" etiqueta="Margen de acercamiento a la planta (m)" valor={valores.margenAcercamientoM} deshabilitada={off}
            ayuda="Cuántos metros antes del borde de la geocerca se le manda al chofer la calle de instrucciones. De 0 a 50,000; 5,000 de partida." />
        </div>
      </Seccion>

      <Seccion id="cfg-avisos" titulo="Avisos a la oficina y estadías">
        <Casilla nombre="avisarOficinaLlegada" etiqueta="Avisar a la oficina la hora exacta de cada llegada" marcada={config.avisarOficinaLlegada} deshabilitada={off} />
        <Casilla nombre="avisarOficinaSalida" etiqueta="Avisar a la oficina la hora exacta de cada salida" marcada={config.avisarOficinaSalida} deshabilitada={off} />
        <Casilla nombre="avisarLlegadaSinConfirmar" etiqueta="Avisar al jefe de tráfico cuando un «ya llegué» no se confirma con ubicación" marcada={config.avisarLlegadaSinConfirmar} deshabilitada={off}
          ayuda="Un solo aviso por llegada, después de unos minutos de gracia. Cubre también el viaje sin sitio asignado (nada con qué compararlo). Apagado, solo se ve como excepción en el tablero." />
        <Casilla nombre="detectarHitosGps" etiqueta="Dar por hecha la llegada o la salida cuando el GPS entra o sale del sitio del viaje" marcada={config.detectarHitosGps} deshabilitada={off}
          ayuda="El tractor entra o sale de la geocerca y el hito se registra solo, sin que el chofer escriba (queda como «sistema» y validado por GPS). Solo actúa con sitio asignado al viaje y GPS de la unidad." />
        <Casilla nombre="avisarSenalVida" etiqueta="Preguntar «¿sigues bien?» si el GPS de un tractor en tránsito se calla" marcada={config.avisarSenalVida} deshabilitada={off}
          ayuda="Si la última posición queda vieja o el tractor lleva rato detenido fuera de un sitio: un aviso con botones al chofer, un segundo aviso y después al jefe de tráfico. Apagado: solo se ve en el tablero. Requiere plantilla aprobada fuera de la ventana de 24 h." />
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
    <button type="submit" disabled={pending} className="h-9 px-4 rounded-lg text-[13px] font-medium hairline transition-opacity hover:opacity-85 disabled:opacity-50">
      {pending ? enCurso : texto}
    </button>
  );
}

function FilaVoluntario({ op, accion, puedeEditar }: { op: OperadorPilotoVista; accion: AccionVoluntario; puedeEditar: boolean }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <li className="py-2 space-y-1.5">
      <form action={enviar} className="flex items-center justify-between gap-3 text-[12.5px]" aria-label={`Retirar a ${op.nombre} del piloto`}>
        <span><strong>{op.nombre}</strong> <span style={{ color: 'var(--faint)' }}>{diezDigitos(op.telefono)}</span></span>
        <input type="hidden" name="operadorId" value={op.id} />
        {puedeEditar && <BotonVoluntario texto="Retirar del piloto" enCurso="Retirando…" />}
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
  const [estadoAlta, enviarAlta] = useActionState(accionAlta, null);
  const n = datos.voluntarios.length;
  return (
    <Seccion id="cfg-voluntarios" titulo="Operadores del piloto">
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        El agente solo da seguimiento a los viajes importados de los operadores que aceptaron participar. Márcalos aquí uno por uno; al retirar a uno,
        sus viajes importados que siguen abiertos vuelven a «sin aceptar».
      </p>
      <p className="text-[13px] font-medium" aria-live="polite">{n} de {datos.tope} operadores en el piloto</p>
      {n > 0 ? (
        <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
          {datos.voluntarios.map((v) => <FilaVoluntario key={v.id} op={v} accion={accionBaja} puedeEditar={puedeEditar} />)}
        </ul>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Todavía no hay operadores en el piloto.</p>
      )}
      {puedeEditar ? (
        <div className="space-y-2">
          <form method="get" className="flex items-end gap-2" aria-label="Buscar operador">
            {parametros.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="flex-1">
              <span className={ETIQUETA}>Buscar operador activo (nombre o teléfono)</span>
              <input name="q" defaultValue={datos.busqueda} className={CAMPO} />
            </label>
            <button type="submit" className="h-9 px-4 rounded-lg text-[13px] font-medium hairline">Buscar</button>
          </form>
          <form action={enviarAlta} className="flex items-end gap-2" aria-label="Agregar operador al piloto">
            <label className="flex-1">
              <span className={ETIQUETA}>Operador</span>
              <select name="operadorId" defaultValue="" className={CAMPO} aria-label="Operador a agregar">
                <option value="" disabled>{datos.candidatos.length > 0 ? 'Elige un operador…' : 'Sin operadores disponibles con ese criterio'}</option>
                {datos.candidatos.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {diezDigitos(c.telefono)}</option>)}
              </select>
            </label>
            <BotonVoluntario texto="Agregar al piloto" enCurso="Agregando…" />
          </form>
          <AvisoResultado estado={estadoAlta} />
        </div>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota cambia quién está en el piloto.</p>
      )}
    </Seccion>
  );
}
