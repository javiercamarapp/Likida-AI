'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Settings2, TriangleAlert } from 'lucide-react';
import { AvisoResultado } from '../../../../admin/ui/aviso-resultado';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL AVISO DE VIAJE (Agente 4, T-A4-23). Requisitos E4, E5 y E6.
//
//  · E5: por defecto NINGÚN aviso sale sin una persona; el modo autónomo es una decisión de la flota y aun así se gana por
//    cliente (T-A4-20). Aquí solo se enciende/apaga y se elige el modo.
//  · E4: «listo» = caja + unidad + carta porte en el conjunto que la flota elija (lista editable). El mapa de colores NO se
//    inventa: queda deshabilitado con «Esperando el archivo con colores» hasta que exista la leyenda real (B1).
//  · E6: licencia, vigencia y teléfono del operador son datos personales de un tercero: apagados por defecto y solo la
//    dueña de la flota (`flota_admin`) los habilita. Cada cambio queda en la bitácora (quién, cuándo, antes y después).
//
// Esta vista es solo de presentación: no valida nada que importe (el servidor vuelve a validar todo, ver `page.tsx`) y los
// catálogos y los límites le llegan por props desde el servidor, de modo que no hay una segunda copia que se desincronice.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoConfig = null | { ok: true; mensaje: string } | { ok: false; error: string };
export type AccionConfig = (previo: ResultadoConfig, fd: FormData) => Promise<ResultadoConfig>;

export interface ConfigPantalla {
  habilitado: boolean;
  modo: 'confirmar' | 'autonomo';
  canalDefault: 'ejecutivo_copia' | 'cliente_1a1';
  ccpListos: string[];
  exigirTransito: boolean;
  secciones: string[];
  horasAntesCita: number | null;
  /** `null` = sin restricción de horario. */
  ventana: { desde: string; hasta: string } | null;
  maxReenvios: number;
  debounceMin: number;
  /** Datos del operador que el cliente puede recibir (además de nombre, unidad, placas y caja). */
  operador: { licencia: boolean; vigencia: boolean; telefono: boolean };
}

export interface OpcionConfig { valor: string; rotulo: string }
export interface LimitesConfig {
  horasAntes: { min: number; max: number };
  debounce: { min: number; max: number };
  reenvios: { min: number; max: number };
}
export interface OpcionesConfigPantalla {
  ccp: OpcionConfig[];
  secciones: OpcionConfig[];
  /** Campos personales del operador, con el nombre del control que los envía. */
  operador: Array<{ campo: 'licencia' | 'vigencia' | 'telefono'; control: string; rotulo: string }>;
  limites: LimitesConfig;
}

/** Texto del mapa de colores mientras no exista la leyenda real (B1, E4). */
export const TEXTO_COLORES = 'Esperando el archivo con colores';
export const TEXTO_ALIAS =
  'Aquí se verán los nombres del programa que todavía no están ligados a un cliente (hoy ese aviso queda «sin destinatario»). '
  + 'La tabla de equivalencias aún no tiene pantalla de captura.';
export const TEXTO_PRIVACIDAD =
  'Al cliente siempre le llegan la caja, sus placas y estado, la unidad, sus placas y el nombre del operador. '
  + 'La licencia, su vigencia y el teléfono del operador son datos personales de un tercero: solo salen si la dueña de la flota '
  + 'los habilita aquí, y el cambio queda registrado con su nombre y la fecha.';

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';
const BOTON = 'hairline rounded-lg px-3 h-9 text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60 hover:bg-[var(--canvas)]';

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{children}
    </p>
  );
}

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={BOTON}>
      <Save width={14} height={14} strokeWidth={1.75} aria-hidden />Guardar configuración
    </button>
  );
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="card p-4 space-y-3 min-w-0" aria-labelledby={id}>
      <legend id={id} className="font-display text-[14px] font-semibold px-1">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Casillas({ nombre, opciones, marcadas, deshabilitado }: { nombre: string; opciones: OpcionConfig[]; marcadas: string[]; deshabilitado: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {opciones.map((o) => (
        <label key={o.valor} className="inline-flex items-center gap-1.5 text-[12.5px]">
          <input type="checkbox" name={nombre} value={o.valor} defaultChecked={marcadas.includes(o.valor)} disabled={deshabilitado} />
          {o.rotulo}
        </label>
      ))}
    </div>
  );
}

export function VistaConfiguracionAviso({
  sufijo, config, opciones, puedeEditar, puedeEditarPrivacidad, puedeEditarEnvio, ventanaIlegible, errorLectura, sinMigrar, accion,
}: {
  sufijo: string;
  /** `null` cuando no se pudo leer (error o migración pendiente). */
  config: ConfigPantalla | null;
  opciones: OpcionesConfigPantalla;
  /** Dueño y encargado cambian la configuración; quien solo mira la ve sin controles. */
  puedeEditar: boolean;
  /** Solo la dueña de la flota (`flota_admin`) cambia qué datos del operador salen al cliente. */
  puedeEditarPrivacidad: boolean;
  /** A37-S15-05: encender/apagar el aviso y elegir modo y canal es de la dueña (`flota_admin`), como en la configuración
   *  del Vigía. Sin este permiso los tres controles se muestran sin poder cambiarlos y viajan ocultos con su valor actual
   *  (un control `disabled` no se envía: sin esto, guardar apagaría el aviso). Por defecto = `puedeEditarPrivacidad`. */
  puedeEditarEnvio?: boolean;
  /** La ventana de envío guardada no se puede leer: mientras tanto el aviso NO sale. */
  ventanaIlegible: boolean;
  errorLectura: string | null;
  sinMigrar: boolean;
  accion: AccionConfig;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const base = `/dashboard/agentes/vigia/avisos${sufijo}`;
  const lim = opciones.limites;
  const sd = !puedeEditar;
  const sdEnvio = sd || !(puedeEditarEnvio ?? puedeEditarPrivacidad);
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <div className="px-5 h-11 flex items-center justify-between gap-3 border-b shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2 text-[13px] font-medium min-w-0">
            <Settings2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} aria-hidden />
            <span className="truncate">Configuración del aviso de viaje</span>
          </div>
        </div>
        <div className="px-5 py-5 flex-1 space-y-4">
          <nav aria-label="Navegación" className="flex flex-wrap gap-2 text-[12.5px]">
            <Link href={base} className="hairline rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]">Volver a los avisos</Link>
          </nav>

          {sinMigrar ? <Aviso>La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.</Aviso> : null}
          {errorLectura ? <Aviso>{errorLectura}</Aviso> : null}
          {!puedeEditar && config ? (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Solo el dueño o el encargado de la flota cambia esta configuración. Tú puedes verla.</p>
          ) : null}

          {config ? (
            <form action={despachar} className="space-y-4" aria-label="Configuración del aviso de viaje">
              {ventanaIlegible ? (
                <Aviso>El horario de envío guardado no se puede leer, así que por seguridad ningún aviso sale. Escribe la hora de inicio y de fin, o déjalas vacías para enviar a cualquier hora, y guarda.</Aviso>
              ) : null}

              <Seccion id="cfg-envio" titulo="Envío">
                <label className="inline-flex items-center gap-2 text-[13px] font-medium">
                  <input type="checkbox" name="habilitado" value="1" defaultChecked={config.habilitado} disabled={sdEnvio} />
                  Aviso de viaje encendido
                </label>
                {sdEnvio && !sd ? (
                  <>
                    {config.habilitado ? <input type="hidden" name="habilitado" value="1" /> : null}
                    <input type="hidden" name="modo" value={config.modo} />
                    <input type="hidden" name="canal" value={config.canalDefault} />
                    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Solo la dueña de la flota enciende o apaga el aviso y cambia el modo y el canal. Tú ajustas el resto.</p>
                  </>
                ) : null}
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Apagado: no se arma ni se envía ningún aviso. Cada aviso nuevo espera tu confirmación mientras el modo sea «confirmar».</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ETIQUETA} htmlFor="cfg-modo">Modo</label>
                    <select id="cfg-modo" name={sdEnvio ? undefined : 'modo'} defaultValue={config.modo} disabled={sdEnvio} className={CAMPO}>
                      <option value="confirmar">Confirmar cada aviso (recomendado)</option>
                      <option value="autonomo">Autónomo (solo clientes con avisos confirmados sin cambios)</option>
                    </select>
                  </div>
                  <div>
                    <label className={ETIQUETA} htmlFor="cfg-canal">Canal por defecto</label>
                    <select id="cfg-canal" name={sdEnvio ? undefined : 'canal'} defaultValue={config.canalDefault} disabled={sdEnvio} className={CAMPO}>
                      <option value="ejecutivo_copia">Copia para el ejecutivo (tú lo mandas)</option>
                      <option value="cliente_1a1">WhatsApp directo al cliente</option>
                    </select>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ETIQUETA} htmlFor="cfg-desde">Enviar desde (hora)</label>
                    <input id="cfg-desde" name="ventana_desde" type="time" defaultValue={config.ventana?.desde ?? ''} disabled={sd} className={CAMPO} />
                  </div>
                  <div>
                    <label className={ETIQUETA} htmlFor="cfg-hasta">Enviar hasta (hora)</label>
                    <input id="cfg-hasta" name="ventana_hasta" type="time" defaultValue={config.ventana?.hasta ?? ''} disabled={sd} className={CAMPO} />
                  </div>
                </div>
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Fuera de ese horario el aviso espera. Vacío = a cualquier hora. Si el fin es menor que el inicio, el horario cruza la medianoche.</p>
              </Seccion>

              <Seccion id="cfg-listo" titulo="Cuándo un servicio está «listo»">
                <p className="text-[12px]" style={{ color: 'var(--muted)' }} data-testid="ayuda-listo">
                  Regla provisional: caja + unidad + carta porte (CCP) en alguno de los estatus que marques. Cambiará cuando tengamos la leyenda de colores.
                </p>
                <div>
                  <p className={ETIQUETA}>Estatus de CCP que cuentan como listo</p>
                  <Casillas nombre="ccp" opciones={opciones.ccp} marcadas={config.ccpListos} deshabilitado={sd} />
                </div>
                <label className="inline-flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" name="exigir_transito" value="1" defaultChecked={config.exigirTransito} disabled={sd} />
                  Además, que el tránsito no esté bloqueado (p. ej. pendiente de cruce)
                </label>
                <div>
                  <p className={ETIQUETA}>Secciones del programa que generan aviso</p>
                  <Casillas nombre="seccion" opciones={opciones.secciones} marcadas={config.secciones} deshabilitado={sd} />
                  <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>Las cancelaciones nunca generan este aviso.</p>
                </div>
                <div className="max-w-xs">
                  <label className={ETIQUETA} htmlFor="cfg-horas">Horas antes de la cita (vacío = en cuanto esté listo)</label>
                  <input
                    id="cfg-horas" name="horas_antes" type="number" inputMode="numeric" step={1}
                    min={lim.horasAntes.min} max={lim.horasAntes.max} defaultValue={config.horasAntesCita ?? ''} disabled={sd} className={CAMPO}
                  />
                </div>
                <div>
                  <p className={ETIQUETA}>Mapa de colores</p>
                  <p className="hairline rounded-lg px-2.5 py-2 text-[12.5px]" style={{ color: 'var(--muted)' }} aria-disabled="true" data-testid="colores">{TEXTO_COLORES}</p>
                </div>
              </Seccion>

              <Seccion id="cfg-cambios" titulo="Cambios y reenvíos">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ETIQUETA} htmlFor="cfg-debounce">Minutos de calma antes de reenviar ({lim.debounce.min} a {lim.debounce.max})</label>
                    <input
                      id="cfg-debounce" name="debounce_min" type="number" inputMode="numeric" step={1} required
                      min={lim.debounce.min} max={lim.debounce.max} defaultValue={config.debounceMin} disabled={sd} className={CAMPO}
                    />
                  </div>
                  <div>
                    <label className={ETIQUETA} htmlFor="cfg-reenvios">Máximo de reenvíos por servicio ({lim.reenvios.min} a {lim.reenvios.max})</label>
                    <input
                      id="cfg-reenvios" name="max_reenvios" type="number" inputMode="numeric" step={1} required
                      min={lim.reenvios.min} max={lim.reenvios.max} defaultValue={config.maxReenvios} disabled={sd} className={CAMPO}
                    />
                  </div>
                </div>
              </Seccion>

              <Seccion id="cfg-privacidad" titulo="Datos del operador que recibe el cliente">
                <p className="text-[12px]" style={{ color: 'var(--muted)' }} data-testid="privacidad">{TEXTO_PRIVACIDAD}</p>
                {puedeEditarPrivacidad ? <input type="hidden" name="op_presente" value="1" /> : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {opciones.operador.map((o) => (
                    <label key={o.campo} className="inline-flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" name={o.control} value="1" defaultChecked={config.operador[o.campo]} disabled={!puedeEditarPrivacidad} />
                      {o.rotulo}
                    </label>
                  ))}
                </div>
                {puedeEditar && !puedeEditarPrivacidad ? (
                  <p className="text-[12px]" style={{ color: 'var(--muted)' }} data-testid="solo-duena">Solo la dueña de la flota puede cambiar estos tres datos.</p>
                ) : null}
              </Seccion>

              <Seccion id="cfg-alias" titulo="Clientes sin ligar">
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }} data-testid="alias">{TEXTO_ALIAS}</p>
              </Seccion>

              {puedeEditar ? <div className="flex items-center gap-3"><Guardar /></div> : null}
              {estado ? <AvisoResultado estado={estado} /> : null}
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
