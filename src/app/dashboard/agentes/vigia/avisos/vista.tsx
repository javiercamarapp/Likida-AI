'use client';

import '../vigia.css';
import { AvisoCompacto, Boton as BotonV2, CampoSelect, CampoFecha, CampoTexto, CampoTextarea, Casilla, Disclosure, Fieldset, FiltroChip, Icono, MarcoPagina, EstadoVacio, StatusChip, Tarjeta, AvisoResultado, type TonoEstado } from '@/app/ui-v2/componentes';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, ClipboardCopy, Send, Trash2, Truck } from 'lucide-react';
import type { GrupoDia, TarjetaAviso } from '@/lib/likida/vigia/aviso/bandeja';
import { AVISO_AUTOMATICO_CONECTADO, TEXTO_AVISO_AUTOMATICO_POR_CONECTAR, VACIO_BANDEJA_POR_CONECTAR } from '@/lib/likida/vigia/aviso/conexion';

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA «AVISOS DE VIAJE» (Agente 4, T-A4-22).
//
// El cliente pide, horas antes del servicio, la caja, las placas, la unidad y el operador (747a3730 ~00:21; ~02:40: aún
// «todavía me los pueden cambiar»). El sistema arma el aviso desde el programa, pero por defecto NINGUNO sale sin que una
// persona lo vea (E5, confirmación humana al inicio). Esta pantalla es ese ojo: qué se va a decir, qué datos tiene y de dónde
// salió cada uno, qué falta, y cuatro botones: Confirmar y enviar / Editar / Copiar y marcar enviado / Descartar.
// Cero pesos. Quien solo mira no ve botones ni teléfonos completos. Nada de texto libre se manda solo.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAviso = null | { ok: true; mensaje: string } | { ok: false; error: string };
export type AccionAviso = (previo: ResultadoAviso, fd: FormData) => Promise<ResultadoAviso>;

/** Regla provisional del «listo» (E4): hasta tener la leyenda de colores, caja + unidad + carta porte lista. */
export const AYUDA_REGLA_PROVISIONAL =
  'Regla provisional: un servicio cuenta como «listo» cuando ya tiene caja + unidad + carta porte (CCP) lista. '
  + 'Cambiará cuando tengamos la leyenda de colores del programa; mientras tanto, revisa cada aviso antes de confirmar.';

export const POLITICA_PRIVACIDAD =
  'Privacidad: al cliente solo le llegan la caja, sus placas y estado, la unidad, sus placas y el nombre del operador. '
  + 'La licencia, su vigencia y el teléfono del operador se pueden guardar aquí, pero NO se envían al cliente mientras la dueña '
  + 'de la flota no los habilite por escrito.';

const VACIO_TODOS = AVISO_AUTOMATICO_CONECTADO
  ? 'Aún no hay avisos de viaje. Cuando el programa del día tenga servicios con caja y unidad, aparecerán aquí para que los revises.'
  : VACIO_BANDEJA_POR_CONECTAR;
const VACIO_PENDIENTES = 'No hay avisos esperando a nadie. Todo lo que se armó ya se envió o se descartó.';

/** AAAA-MM-DD → DD/MM/AAAA, sin pasar por Date. */
function dia(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha || 'Sin fecha';
}

const TONO_ESTADO: Record<string, TonoEstado> = {
  pendiente_confirmacion: 'warn',
  sin_destinatario: 'warn',
  fallido: 'bad',
  enviado: 'ok',
  aprobado: 'muted',
  descartado: 'muted',
  borrador: 'muted',
  reemplazado: 'muted',
};

function Aviso({ children }: { children: React.ReactNode }) {
  return <AvisoCompacto tono="error" resumen={children} />;
}

function Boton({ accion, children, tono }: { accion: string; children: React.ReactNode; tono?: 'peligro' }) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" name="accion" value={accion} loading={pending} tamano="sm" variante={tono === 'peligro' ? 'danger' : 'secondary'}>
      {children}
    </BotonV2>
  );
}

/** «Copiar y marcar enviado»: copia el texto al portapapeles y, en el mismo toque, deja constancia de que ya salió. */
function BotonCopiar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <BotonV2
      type="submit" name="accion" value="copiar" loading={pending} tamano="sm" icono={<Icono icono={ClipboardCopy} tam={14} />}
      onClick={() => {
        try { void navigator.clipboard?.writeText(texto); } catch { /* sin portapapeles: el texto sigue a la vista para copiarlo a mano */ }
      }}
    >
      Copiar y marcar enviado
    </BotonV2>
  );
}

function TarjetaAvisoViaje({ t, accion, puedeDecidir }: { t: TarjetaAviso; accion: AccionAviso; puedeDecidir: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  const p = t.puede;
  return (
    <article className="rv-vg__bloque" aria-labelledby={`aviso-${t.id}`} data-estado={t.estado}>
      <header className="rv-vg__linea">
        <div>
          <h4 id={`aviso-${t.id}`} className="rv-vg__titulo">{t.servicio}</h4>
          <p className="rv-vg__nota">
            {t.cita ? `Cita: ${t.cita} · ` : ''}{t.canalRotulo}
          </p>
        </div>
        <div className="rv-vg__fin rv-vg__der">
          <span data-testid="estado"><StatusChip tono={TONO_ESTADO[t.estado] ?? 'neutral'}>{t.estadoRotulo}</StatusChip></span>
          <p className="rv-vg__nota">
            Versión {t.version}{t.tipo === 'actualizacion' ? ' (actualización)' : t.tipo === 'cancelacion' ? ' (cancelación)' : ''}
            {t.editadoPorPersona ? ' · editado a mano' : ''}
          </p>
        </div>
      </header>

      {t.interno ? (
        <p className="rv-vg__nota">Alerta interna para la oficina: no se manda al cliente.</p>
      ) : null}
      {t.cambio ? <p className="rv-vg__nota" data-testid="cambio"><strong>Qué cambió:</strong> {t.cambio}</p> : null}

      {t.errorLlano ? <Aviso>{t.errorLlano}</Aviso> : null}
      {t.causas.length > 0 ? (
        <ul className="rv-vg__bullets" aria-label="Por qué no hay destinatario" data-tono="bad">
          {t.causas.map((c) => <li key={c}>{c}</li>)}
        </ul>
      ) : null}

      <div className="rv-vg__cuad">
        <div className="rv-vg__pila--s">
          <p className="rv-vg__rotulo">Qué datos tiene</p>
          {t.tiene.length > 0 ? (
            <ul className="rv-vg__ul" aria-label="Datos que tiene">
              {t.tiene.map((d) => (
                <li key={d.campo}>
                  <span className="rv-vg__medio">{d.rotulo}:</span> {d.valor} <span className="rv-vg__muted">({d.fuente})</span>
                </li>
              ))}
            </ul>
          ) : <p className="rv-vg__nota">Todavía no tiene ningún dato.</p>}
        </div>
        <div className="rv-vg__pila--s">
          <p className="rv-vg__rotulo">Qué falta</p>
          {t.faltan.length > 0 ? (
            <ul className="rv-vg__bullets" aria-label="Datos que faltan" data-tono="bad">
              {t.faltan.map((f) => <li key={f.campo}>{f.texto}</li>)}
            </ul>
          ) : <p className="rv-vg__nota">No falta nada.</p>}
        </div>
      </div>

      <div className="rv-vg__pila--s">
        <p className="rv-vg__rotulo">Lo que se le va a decir al cliente</p>
        <pre className="rv-vg__texto" data-testid="texto">{t.texto}</pre>
      </div>

      {puedeDecidir ? (
        <>
          <form action={despachar} className="rv-vg__linea">
            <input type="hidden" name="id" value={t.id} />
            {p.confirmar ? <Boton accion="confirmar"><Icono icono={Send} tam={14} />Confirmar y enviar</Boton> : null}
            {p.copiar ? <BotonCopiar texto={t.texto} /> : null}
          </form>

          {p.editar ? (
            <Disclosure titulo="Editar" variante="linea">
              <form action={despachar} className="rv-vg__pila">
                <input type="hidden" name="id" value={t.id} />
                <CampoTextarea etiqueta="Texto del aviso (hasta 1 000 letras)" name="texto" required maxLength={1000} rows={6} defaultValue={t.texto} />
                <div><Boton accion="editar"><Icono icono={Check} tam={14} />Guardar el texto</Boton></div>
              </form>
            </Disclosure>
          ) : null}

          {p.capturar ? (
            <Disclosure titulo="Capturar lo que falta" variante="linea">
              <form action={despachar} className="rv-vg__pila">
                <input type="hidden" name="id" value={t.id} />
                <div className="rv-vg__cuad">
                  <CampoTexto etiqueta="Operador" name="operadorNombre" maxLength={120} autoComplete="off" />
                  <CampoTexto etiqueta="Placas de la unidad" name="placasUnidad" maxLength={14} autoComplete="off" />
                  <CampoTexto etiqueta="Placas de la caja" name="placasCaja" maxLength={14} autoComplete="off" />
                  <CampoSelect etiqueta="Estado de la caja" name="estadoCaja" defaultValue="">
                    <option value="">No cambiar</option>
                    <option value="vacia">Vacía</option>
                    <option value="cargada">Cargada</option>
                    <option value="en_patio">En patio</option>
                    <option value="en_transito">En tránsito</option>
                    <option value="desconocido">Desconocido</option>
                  </CampoSelect>
                  <CampoTexto etiqueta="Licencia (no se envía al cliente)" name="licencia" maxLength={40} autoComplete="off" />
                  <CampoFecha etiqueta="Vigencia de la licencia (no se envía)" name="licenciaVence" />
                  <CampoTexto etiqueta="Teléfono del operador (no se envía)" name="telefono" tipo="tel" inputMode="tel" maxLength={16} autoComplete="off" />
                </div>
                <div data-testid="borrar-datos">
                  <Fieldset leyenda="Quitar un dato mal escrito (déjalo vacío arriba y márcalo aquí)">
                    <div className="rv-vg__linea">
                      {([['operadorNombre', 'Operador'], ['placasUnidad', 'Placas unidad'], ['placasCaja', 'Placas caja'], ['estadoCaja', 'Estado caja'], ['licencia', 'Licencia'], ['licenciaVence', 'Vigencia'], ['telefono', 'Teléfono']] as const).map(([v, r]) => (
                        <Casilla key={v} name="borrar" value={v} etiqueta={r} />
                      ))}
                    </div>
                  </Fieldset>
                </div>
                <p className="rv-vg__nota" data-testid="privacidad">{POLITICA_PRIVACIDAD}</p>
                <div><Boton accion="capturar"><Icono icono={Truck} tam={14} />Guardar los datos</Boton></div>
              </form>
            </Disclosure>
          ) : null}

          {p.descartar ? (
            <Disclosure titulo="Descartar" variante="linea">
              <form action={despachar} className="rv-vg__pila">
                <input type="hidden" name="id" value={t.id} />
                <p className="rv-vg__nota">Este aviso no se enviará. Si el servicio cambia, el sistema arma uno nuevo.</p>
                <div><Boton accion="descartar" tono="peligro"><Icono icono={Trash2} tam={14} />Sí, descartar</Boton></div>
              </form>
            </Disclosure>
          ) : null}
        </>
      ) : null}

      {estado ? <AvisoResultado estado={estado} /> : null}
    </article>
  );
}

export function VistaAvisosVigia({ sufijo, grupos, total, hayMas = false, soloPendientes, puedeDecidir, avisoEncendido, errorLectura, sinMigrar, accion }: {
  sufijo: string;
  grupos: GrupoDia[];
  /** Cuántos avisos hay en la lista que se está viendo. */
  total: number;
  /** La lista llegó al tope de la bandeja: puede haber avisos más viejos que no se muestran (A37-S58-07). */
  hayMas?: boolean;
  soloPendientes: boolean;
  /** Solo el dueño y el encargado deciden; el resto mira (sin botones y sin teléfonos completos). */
  puedeDecidir: boolean;
  /** `null` = no se pudo leer la configuración. */
  avisoEncendido: boolean | null;
  /** Mensaje llano si la lista no se pudo leer. */
  errorLectura: string | null;
  /** La migración 0797 aún no está en la base. */
  sinMigrar: boolean;
  accion: AccionAviso;
}) {
  const base = `/dashboard/agentes/vigia/avisos${sufijo}`;
  const conPendientes = `${base}${sufijo ? '&' : '?'}pendientes=1`;
  return (
    <MarcoPagina titulo="Avisos de viaje" apoyo="Los avisos que el Vigía arma para tus clientes, por día, para confirmarlos, editarlos o descartarlos.">
      <nav aria-label="Navegación" className="rv-vg__herr">
        <Link href={`/dashboard/agentes/vigia${sufijo}`} className="rv-vg__enlace">Volver a servicio al cliente</Link>
        <FiltroChip href={soloPendientes ? base : conPendientes} activo={soloPendientes}>Solo pendientes</FiltroChip>
      </nav>

      <p className="rv-vg__nota" data-testid="ayuda">{AYUDA_REGLA_PROVISIONAL}</p>

      {!AVISO_AUTOMATICO_CONECTADO ? (
        <div data-testid="por-conectar"><AvisoCompacto tono="warn" resumen={TEXTO_AVISO_AUTOMATICO_POR_CONECTAR} /></div>
      ) : null}
      {avisoEncendido === false ? (
        <AvisoCompacto tono="warn" resumen="El aviso de viaje está apagado: no se arman ni se envían avisos nuevos hasta que el dueño lo encienda." />
      ) : null}
      {avisoEncendido === null && !sinMigrar && !errorLectura ? (
        <p className="rv-vg__nota">No pude confirmar si el aviso de viaje está encendido.</p>
      ) : null}
      {!puedeDecidir ? (
        <p className="rv-vg__nota">Solo el dueño o el encargado de la flota confirma, edita o descarta avisos. Tú puedes verlos, sin teléfonos completos.</p>
      ) : null}

      {sinMigrar ? <Aviso>La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.</Aviso> : null}
      {errorLectura ? <Aviso>{errorLectura}</Aviso> : null}

      {!sinMigrar && !errorLectura && total === 0 ? (
        <div data-testid="vacio"><EstadoVacio titulo="Sin avisos que revisar" contenido>{soloPendientes ? VACIO_PENDIENTES : VACIO_TODOS}</EstadoVacio></div>
      ) : null}

      {hayMas ? (
        <p className="rv-vg__nota" data-testid="hay-mas">
          Se muestran los {total} avisos más recientes; puede haber más antiguos. {soloPendientes ? 'Resuelve los pendientes para ver el resto.' : 'Usa «Solo pendientes» para ver lo que falta por resolver.'}
        </p>
      ) : null}

      {grupos.map((g) => (
        <Tarjeta key={g.fecha || 'sin-fecha'} titulo={dia(g.fecha)} info="vigia_avisos.dia">
          <div className="rv-vg__pila">
            {g.clientes.map((c) => (
              <div key={c.cliente} className="rv-vg__pila">
                <p className="rv-vg__rotulo">{c.cliente}</p>
                {c.tarjetas.map((t) => <TarjetaAvisoViaje key={t.id} t={t} accion={accion} puedeDecidir={puedeDecidir} />)}
              </div>
            ))}
          </div>
        </Tarjeta>
      ))}
    </MarcoPagina>
  );
}
