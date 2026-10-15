'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, ClipboardCopy, Pencil, Send, Trash2, TriangleAlert, Truck } from 'lucide-react';
import { AvisoResultado } from '../../../../admin/ui/aviso-resultado';
import type { GrupoDia, TarjetaAviso } from '@/lib/likida/vigia/aviso/bandeja';

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

const VACIO_TODOS = 'Aún no hay avisos de viaje. Cuando el programa del día tenga servicios con caja y unidad, aparecerán aquí para que los revises.';
const VACIO_PENDIENTES = 'No hay avisos esperando a nadie. Todo lo que se armó ya se envió o se descartó.';

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';
const BOTON = 'hairline rounded-lg px-3 h-9 text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60 hover:bg-[var(--canvas)]';

/** AAAA-MM-DD → DD/MM/AAAA, sin pasar por Date. */
function dia(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha || 'Sin fecha';
}

const COLOR_ESTADO: Record<string, string> = {
  pendiente_confirmacion: 'var(--warn, #b45309)',
  sin_destinatario: 'var(--warn, #b45309)',
  fallido: 'var(--bad)',
  enviado: 'var(--ok, #15803d)',
  aprobado: 'var(--muted)',
  descartado: 'var(--muted)',
  borrador: 'var(--muted)',
  reemplazado: 'var(--muted)',
};

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{children}
    </p>
  );
}

function Boton({ accion, children, tono }: { accion: string; children: React.ReactNode; tono?: 'peligro' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="accion" value={accion} disabled={pending} className={BOTON} style={tono === 'peligro' ? { color: 'var(--bad)' } : undefined}>
      {children}
    </button>
  );
}

/** «Copiar y marcar enviado»: copia el texto al portapapeles y, en el mismo toque, deja constancia de que ya salió. */
function BotonCopiar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" name="accion" value="copiar" disabled={pending} className={BOTON}
      onClick={() => {
        try { void navigator.clipboard?.writeText(texto); } catch { /* sin portapapeles: el texto sigue a la vista para copiarlo a mano */ }
      }}
    >
      <ClipboardCopy width={14} height={14} strokeWidth={1.75} aria-hidden />Copiar y marcar enviado
    </button>
  );
}

function Tarjeta({ t, accion, puedeDecidir }: { t: TarjetaAviso; accion: AccionAviso; puedeDecidir: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  const p = t.puede;
  return (
    <article className="card p-4 space-y-3" aria-labelledby={`aviso-${t.id}`} data-estado={t.estado}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`aviso-${t.id}`} className="font-display text-[14px] font-semibold">{t.servicio}</h4>
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {t.cita ? `Cita: ${t.cita} · ` : ''}{t.canalRotulo}
          </p>
        </div>
        <div className="text-right text-[12px]">
          <span className="font-medium" style={{ color: COLOR_ESTADO[t.estado] }} data-testid="estado">{t.estadoRotulo}</span>
          <p style={{ color: 'var(--muted)' }}>
            Versión {t.version}{t.tipo === 'actualizacion' ? ' (actualización)' : t.tipo === 'cancelacion' ? ' (cancelación)' : ''}
            {t.editadoPorPersona ? ' · editado a mano' : ''}
          </p>
        </div>
      </header>

      {t.interno ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Alerta interna para la oficina: no se manda al cliente.</p>
      ) : null}
      {t.cambio ? <p className="text-[12.5px]" data-testid="cambio"><span className="font-medium">Qué cambió:</span> {t.cambio}</p> : null}

      {t.errorLlano ? <Aviso>{t.errorLlano}</Aviso> : null}
      {t.causas.length > 0 ? (
        <ul className="text-[12.5px] list-disc pl-5 space-y-0.5" aria-label="Por qué no hay destinatario" style={{ color: 'var(--bad)' }}>
          {t.causas.map((c) => <li key={c}>{c}</li>)}
        </ul>
      ) : null}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <h5 className="text-[11px] font-medium mb-1">Qué datos tiene</h5>
          {t.tiene.length > 0 ? (
            <ul className="text-[12.5px] space-y-0.5" aria-label="Datos que tiene">
              {t.tiene.map((d) => (
                <li key={d.campo}>
                  <span className="font-medium">{d.rotulo}:</span> {d.valor} <span style={{ color: 'var(--muted)' }}>({d.fuente})</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Todavía no tiene ningún dato.</p>}
        </div>
        <div>
          <h5 className="text-[11px] font-medium mb-1">Qué falta</h5>
          {t.faltan.length > 0 ? (
            <ul className="text-[12.5px] space-y-0.5 list-disc pl-5" aria-label="Datos que faltan" style={{ color: 'var(--bad)' }}>
              {t.faltan.map((f) => <li key={f.campo}>{f.texto}</li>)}
            </ul>
          ) : <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No falta nada.</p>}
        </div>
      </div>

      <div>
        <h5 className="text-[11px] font-medium mb-1">Lo que se le va a decir al cliente</h5>
        <pre className="hairline rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap font-sans" data-testid="texto">{t.texto}</pre>
      </div>

      {puedeDecidir ? (
        <>
          <form action={despachar} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={t.id} />
            {p.confirmar ? <Boton accion="confirmar"><Send width={14} height={14} strokeWidth={1.75} aria-hidden />Confirmar y enviar</Boton> : null}
            {p.copiar ? <BotonCopiar texto={t.texto} /> : null}
          </form>

          {p.editar ? (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer inline-flex items-center gap-1.5"><Pencil width={14} height={14} strokeWidth={1.75} aria-hidden />Editar</summary>
              <form action={despachar} className="space-y-2 mt-2">
                <input type="hidden" name="id" value={t.id} />
                <label>
                  <span className={ETIQUETA}>Texto del aviso (hasta 1 000 letras)</span>
                  <textarea name="texto" required maxLength={1000} rows={6} defaultValue={t.texto} className="hairline rounded-lg px-2.5 py-2 text-[13px] w-full" />
                </label>
                <Boton accion="editar"><Check width={14} height={14} strokeWidth={1.75} aria-hidden />Guardar el texto</Boton>
              </form>
            </details>
          ) : null}

          {p.capturar ? (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer">Capturar lo que falta</summary>
              <form action={despachar} className="space-y-3 mt-2">
                <input type="hidden" name="id" value={t.id} />
                <div className="grid sm:grid-cols-2 gap-3">
                  <label><span className={ETIQUETA}>Operador</span><input name="operadorNombre" maxLength={120} className={CAMPO} autoComplete="off" /></label>
                  <label><span className={ETIQUETA}>Placas de la unidad</span><input name="placasUnidad" maxLength={14} className={CAMPO} autoComplete="off" /></label>
                  <label><span className={ETIQUETA}>Placas de la caja</span><input name="placasCaja" maxLength={14} className={CAMPO} autoComplete="off" /></label>
                  <label>
                    <span className={ETIQUETA}>Estado de la caja</span>
                    <select name="estadoCaja" className={CAMPO} defaultValue="">
                      <option value="">No cambiar</option>
                      <option value="vacia">Vacía</option>
                      <option value="cargada">Cargada</option>
                      <option value="en_patio">En patio</option>
                      <option value="en_transito">En tránsito</option>
                      <option value="desconocido">Desconocido</option>
                    </select>
                  </label>
                  <label><span className={ETIQUETA}>Licencia (no se envía al cliente)</span><input name="licencia" maxLength={40} className={CAMPO} autoComplete="off" /></label>
                  <label><span className={ETIQUETA}>Vigencia de la licencia (no se envía)</span><input name="licenciaVence" type="date" className={CAMPO} /></label>
                  <label><span className={ETIQUETA}>Teléfono del operador (no se envía)</span><input name="telefono" inputMode="tel" maxLength={16} className={CAMPO} autoComplete="off" /></label>
                </div>
                <p className="text-[11.5px]" style={{ color: 'var(--muted)' }} data-testid="privacidad">{POLITICA_PRIVACIDAD}</p>
                <Boton accion="capturar"><Truck width={14} height={14} strokeWidth={1.75} aria-hidden />Guardar los datos</Boton>
              </form>
            </details>
          ) : null}

          {p.descartar ? (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer inline-flex items-center gap-1.5" style={{ color: 'var(--bad)' }}><Trash2 width={14} height={14} strokeWidth={1.75} aria-hidden />Descartar</summary>
              <form action={despachar} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={t.id} />
                <p>Este aviso no se enviará. Si el servicio cambia, el sistema arma uno nuevo.</p>
                <Boton accion="descartar" tono="peligro"><Trash2 width={14} height={14} strokeWidth={1.75} aria-hidden />Sí, descartar</Boton>
              </form>
            </details>
          ) : null}
        </>
      ) : null}

      {estado ? <AvisoResultado estado={estado} /> : null}
    </article>
  );
}

export function VistaAvisosVigia({ sufijo, grupos, total, soloPendientes, puedeDecidir, avisoEncendido, errorLectura, sinMigrar, accion }: {
  sufijo: string;
  grupos: GrupoDia[];
  /** Cuántos avisos hay en la lista que se está viendo. */
  total: number;
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
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <div className="px-5 h-11 flex items-center justify-between gap-3 border-b shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2 text-[13px] font-medium min-w-0">
            <Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} aria-hidden />
            <span className="truncate">Avisos de viaje</span>
          </div>
        </div>
        <div className="px-5 py-5 flex-1 space-y-4">
          <nav aria-label="Navegación" className="flex flex-wrap gap-2 text-[12.5px]">
            <Link href={`/dashboard/agentes/vigia${sufijo}`} className="hairline rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]">Volver a servicio al cliente</Link>
            <Link href={soloPendientes ? base : conPendientes} className="hairline rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]" aria-current={soloPendientes ? 'true' : undefined}>
              {soloPendientes ? 'Mostrar todos' : 'Solo pendientes'}
            </Link>
          </nav>

          <p className="text-[12px]" style={{ color: 'var(--muted)' }} data-testid="ayuda">{AYUDA_REGLA_PROVISIONAL}</p>

          {avisoEncendido === false ? (
            <Aviso>El aviso de viaje está apagado: no se arman ni se envían avisos nuevos hasta que el dueño lo encienda.</Aviso>
          ) : null}
          {avisoEncendido === null && !sinMigrar && !errorLectura ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No pude confirmar si el aviso de viaje está encendido.</p>
          ) : null}
          {!puedeDecidir ? (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Solo el dueño o el encargado de la flota confirma, edita o descarta avisos. Tú puedes verlos, sin teléfonos completos.</p>
          ) : null}

          {sinMigrar ? <Aviso>La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.</Aviso> : null}
          {errorLectura ? <Aviso>{errorLectura}</Aviso> : null}

          {!sinMigrar && !errorLectura && total === 0 ? (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }} data-testid="vacio">{soloPendientes ? VACIO_PENDIENTES : VACIO_TODOS}</p>
          ) : null}

          {grupos.map((g) => (
            <section key={g.fecha || 'sin-fecha'} className="space-y-3" aria-labelledby={`dia-${g.fecha || 'sin-fecha'}`}>
              <h2 id={`dia-${g.fecha || 'sin-fecha'}`} className="font-display text-[15px] font-semibold">{dia(g.fecha)}</h2>
              {g.clientes.map((c) => (
                <div key={c.cliente} className="space-y-2">
                  <h3 className="text-[12.5px] font-medium" style={{ color: 'var(--muted)' }}>{c.cliente}</h3>
                  {c.tarjetas.map((t) => <Tarjeta key={t.id} t={t} accion={accion} puedeDecidir={puedeDecidir} />)}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
