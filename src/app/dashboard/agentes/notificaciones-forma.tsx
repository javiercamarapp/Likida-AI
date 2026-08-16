'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Mail, MailX, UserX, TriangleAlert, BellOff } from 'lucide-react';
// SOLO TIPOS, y no es una preferencia de estilo: `notificaciones.ts` importa
// `supabaseAdmin` y, por `correo/enviar.ts`, el PNG del logo en base64. Un
// import de valor metería las dos cosas —el cliente de service-role y un
// logo de kilobytes— en el bundle del navegador. `import type` se borra al
// compilar, así que este archivo no arrastra nada del servidor; todo lo que
// necesita en tiempo de ejecución entra por props.
import type {
  ConfigNotificaciones, EventoDeclarado, EventoId, RolAvisable, Reparto, UsuarioAvisable,
} from '@/lib/likida/agentes/notificaciones';

// ═══════════════════════════════════════════════════════════════════════════
// LA PESTAÑA «NOTIFICACIONES» — una sola, para los seis agentes.
//
// Cada agente necesita su propio menú de Notificaciones; Likida
// no tenía ninguna porque hasta el 14-ago-2026 no había canal de salida. Este
// componente es la pantalla de esa decisión: de QUÉ avisa este agente y a
// QUIÉN, con la mitad honesta a la vista (a quién NO le llega y por qué),
// igual que la cola del Agente de Cobranza enseña a quién no puede escribirle.
//
// LO QUE ESTA PANTALLA NO HACE, Y ES EL PUNTO:
//   · No ofrece un aviso de "corrida completada". No existe en el catálogo.
//   · No ofrece escribir un correo a mano. Los destinatarios son cuentas del
//     panel de esta flota: gente que ya puede ver ese dato adentro.
//   · No ofrece interruptores cuando el canal está apagado. Lo dice.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionNotificaciones = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

/**
 * Cómo se llama cada rol para una persona.
 *
 * Repetido de `dashboard/aviso-rol.tsx` (que lo tiene privado dentro de su
 * componente) y no importado: ese módulo exporta una cinta, no un rótulo. Son
 * tres cadenas; el día que aparezca un cuarto sitio, el mapa se muda a un
 * módulo compartido y los tres lo importan.
 */
const ROTULO_ROL: Record<string, string> = {
  flota_admin: 'Dueño de la flota',
  encargado: 'Jefe de tráfico',
  contador: 'Contador',
};

export interface DatosNotificaciones {
  /** El agente al que pertenece esta pestaña. */
  agente: { id: string; nombre: string };
  /** Lo que a ESTE agente le puede pasar. Viene del catálogo del motor: si un
   *  agente no emite un evento, aquí no aparece su casilla. */
  eventos: readonly EventoDeclarado[];
  /** La config guardada, o `null` si no se pudo leer (entonces se dice, y el
   *  formulario arranca con el default para poder recuperarla). */
  config: ConfigNotificaciones | null;
  errorConfig: string | null;
  configDefault: ConfigNotificaciones;
  /** Los roles a los que tiene sentido ofrecerles este agente — los que
   *  pueden abrir su pantalla. */
  rolesPosibles: readonly RolAvisable[];
  /** Las cuentas del panel de esta flota. */
  usuarios: readonly UsuarioAvisable[];
  /** El reparto REAL de la config GUARDADA, calculado en el servidor. Lo que
   *  se ve aquí es lo que de verdad va a pasar, no una maqueta. */
  reparto: Reparto;
  /** `correoConfigurado()`. Es el juicio: sin canal, esto no ofrece nada. */
  canalListo: boolean;
  /** Las constantes del anti-ruido, para explicarlo con los números REALES
   *  del motor en vez de con una frase que se puede quedar vieja. */
  antiRuido: { marcas: readonly number[]; pisoMinutos: number };
}

export function FormaNotificaciones({ datos, guardar }: {
  datos: DatosNotificaciones;
  guardar: AccionNotificaciones;
}) {
  const [estado, accion] = useActionState(guardar, null);
  const inicial = datos.config ?? datos.configDefault;
  const [eventos, setEventos] = useState<EventoId[]>([...inicial.eventos]);
  const [roles, setRoles] = useState<RolAvisable[]>([...inicial.roles]);

  const apagado = !datos.canalListo;

  // Cuántas cuentas hay por rol y cuántas de ellas no tienen correo. No es un
  // segundo `repartoDe` —eso vive en el motor y lo calcula el servidor—: es
  // un conteo por rol, para que al marcar una casilla se vea a cuánta gente
  // toca antes de guardar.
  const porRol = useMemo(() => {
    const m: Record<string, { total: number; sinCorreo: number }> = {};
    for (const u of datos.usuarios) {
      const c = m[u.rol] ?? { total: 0, sinCorreo: 0 };
      c.total++;
      if (!u.email?.trim()) c.sinCorreo++;
      m[u.rol] = c;
    }
    return m;
  }, [datos.usuarios]);

  // "¿Cambió algo respecto de lo guardado?" — por CONJUNTO, no por orden: el
  // orden en que se marcan las casillas no es una diferencia, y decir "guarda
  // para que aplique" cuando nada cambió entrena a ignorar ese aviso también.
  const mismos = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((v) => b.includes(v));
  const sucio = !mismos(eventos, inicial.eventos) || !mismos(roles, inicial.roles);

  // El aviso que la pantalla tiene que dar ANTES de que el cliente guarde: no
  // es un error de validación, es la configuración que se ve prendida y no
  // manda nada. El servidor la rechaza igual (`validarConfigNotificaciones`).
  const sinNadie = eventos.length > 0 && roles.length === 0;

  function alternar<T extends string>(lista: T[], set: (v: T[]) => void, valor: T) {
    set(lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]);
  }

  return (
    <div className="space-y-3.5">
      {apagado && (
        <Banda tono="warn" Icono={MailX}>
          El correo no está configurado en este entorno: <strong>no sale ningún aviso</strong>, se
          marque lo que se marque. Se enciende conectando Resend en Conexiones — hasta entonces
          esta pantalla prefiere decirlo a ofrecer un interruptor que no hace nada.
        </Banda>
      )}

      {datos.errorConfig && (
        <Banda tono="bad" Icono={TriangleAlert}>
          {datos.errorConfig}
        </Banda>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <form action={accion} className="space-y-4">
          <input type="hidden" name="agente" value={datos.agente.id} />

          {/* ── DE QUÉ avisa ── */}
          <fieldset disabled={apagado} className="disabled:opacity-50">
            <legend className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>
              {/* «el» a mano: los seis se llaman "Agente de …", así que el
                  artículo siempre cuadra. Sin él se lee "De qué te avisa
                  Agente de Cobranza", que suena a traducción automática. */}
              De qué te avisa el {datos.agente.nombre}
            </legend>
            <div className="space-y-2.5">
              {datos.eventos.map((e) => {
                // `conectado === false` = este agente declara el evento pero
                // todavía no hay código que lo emita. Se enseña APAGADO y con
                // el porqué, en vez de ofrecer una casilla que se marca, se
                // guarda, y no dispara nada: quien la marcara se quedaría
                // esperando un correo que no existe, creyéndose cubierto.
                const muerto = e.conectado === false;
                return (
                  <label key={e.id}
                    className={`flex items-start gap-2.5 ${muerto ? 'cursor-default' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox" name="eventos" value={e.id}
                      checked={!muerto && eventos.includes(e.id)}
                      disabled={muerto}
                      onChange={() => alternar(eventos, setEventos, e.id)}
                      className="mt-0.5 w-3.5 h-3.5 shrink-0"
                      style={{ accentColor: 'var(--marca)' }}
                    />
                    <span className="min-w-0" style={muerto ? { opacity: 0.55 } : undefined}>
                      <span className="block text-[13px] font-medium">{e.titulo}</span>
                      <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>{e.cuando}</span>
                      {muerto ? (
                        <span className="block text-[11px] mt-0.5" style={{ color: 'var(--warn)' }}>
                          Todavía no está conectado: este agente aún no detecta esa situación, así que
                          encenderlo no mandaría nada. Aparece aquí porque es lo siguiente que le toca.
                        </span>
                      ) : (
                        <span className="block text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{e.porQue}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] mt-2.5" style={{ color: 'var(--faint)' }}>
              No hay casilla para «la corrida salió bien»: un aviso que llega cuando todo está
              en orden es el que más rápido enseña a ignorar los que sí piden algo.
            </p>
          </fieldset>

          {/* ── A QUIÉN ── */}
          <fieldset disabled={apagado} className="disabled:opacity-50">
            <legend className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>
              A quién le llega
            </legend>
            <div className="space-y-2">
              {datos.rolesPosibles.map((rol) => {
                const c = porRol[rol];
                return (
                  <label key={rol} className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox" name="roles" value={rol}
                      checked={roles.includes(rol)}
                      onChange={() => alternar(roles, setRoles, rol)}
                      className="mt-0.5 w-3.5 h-3.5 shrink-0"
                      style={{ accentColor: 'var(--marca)' }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{ROTULO_ROL[rol] ?? rol}</span>
                      <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>
                        {!c || c.total === 0
                          ? 'nadie con este rol en la flota'
                          : c.sinCorreo > 0
                            ? `${c.total} ${c.total === 1 ? 'cuenta' : 'cuentas'} · ${c.sinCorreo} sin correo`
                            : `${c.total} ${c.total === 1 ? 'cuenta' : 'cuentas'}`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] mt-2.5" style={{ color: 'var(--faint)' }}>
              Solo cuentas del panel de esta flota. No se puede teclear una dirección suelta:
              cada destinatario es alguien que ya puede ver este dato adentro. Los operadores
              no aparecen — no tienen cuenta ni correo, hablan por WhatsApp.
            </p>
          </fieldset>

          {sinNadie && (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
              Tienes avisos encendidos y nadie que los reciba. Marca un rol, o apaga los avisos.
            </p>
          )}

          <div className="flex items-center gap-3 pt-0.5">
            <BotonGuardar apagado={apagado} sucio={sucio} />
            {estado?.error && <p className="text-[12px]" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
          </div>
        </form>

        {/* ── La verdad medida: a quién le llega hoy y a quién no ── */}
        <div className="space-y-3">
          <div>
            <div className="etiqueta-mono text-[10px] uppercase mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
              <Mail width={11} height={11} strokeWidth={2} />
              Hoy le llega a
            </div>
            <div className="rounded-xl hairline p-3.5" style={{ background: 'var(--surface)' }}>
              {apagado ? (
                <Nota>Hoy no le llega a nadie: el canal de correo está apagado en este entorno.</Nota>
              ) : datos.config === null ? (
                <Nota>No se pudo leer la configuración, así que no sale ningún aviso. Guarda de
                  nuevo para reactivarlos.</Nota>
              ) : datos.reparto.reciben.length === 0 ? (
                <Nota>{datos.config.eventos.length === 0
                  ? 'Este agente no manda ningún correo: todos sus avisos están apagados.'
                  : 'Nadie lo recibe todavía. Revisa los roles marcados y que esas cuentas tengan correo.'}</Nota>
              ) : (
                <ul className="space-y-1.5">
                  {datos.reparto.reciben.map((d) => (
                    <li key={d.id} className="text-[12.5px] flex items-baseline gap-2">
                      <span className="font-medium truncate">{d.nombre ?? d.email}</span>
                      <span className="truncate" style={{ color: 'var(--muted)' }}>{d.email}</span>
                      <span className="ml-auto shrink-0 text-[11px]" style={{ color: 'var(--faint)' }}>
                        {ROTULO_ROL[d.rol] ?? d.rol}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {sucio && !apagado && (
                <p className="text-[11px] mt-2.5" style={{ color: 'var(--warn)' }}>
                  Esta lista es la de la configuración guardada. Guarda para que aplique lo que acabas de marcar.
                </p>
              )}
            </div>
          </div>

          {datos.reparto.excluidos.length > 0 && (
            <div>
              <div className="etiqueta-mono text-[10px] uppercase mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
                <UserX width={11} height={11} strokeWidth={2} />
                A quién no, y por qué
              </div>
              <div className="rounded-xl hairline p-3.5 space-y-1.5" style={{ background: 'var(--surface)' }}>
                {datos.reparto.excluidos.map((x) => (
                  <p key={x.id} className="text-[12.5px]">
                    <span className="font-medium">{x.nombre ?? ROTULO_ROL[x.rol] ?? x.rol}</span>
                    <span style={{ color: 'var(--muted)' }}> — {x.porque}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* El anti-ruido, con los números del motor: es la pregunta que
              sigue a "¿lo enciendo?" y la razón por la que se puede encender. */}
          <div>
            <div className="etiqueta-mono text-[10px] uppercase mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
              <BellOff width={11} height={11} strokeWidth={2} />
              Cuántos correos, como máximo
            </div>
            <div className="rounded-xl hairline p-3.5 text-[12px] leading-relaxed" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              Si algo se rompe y sigue roto, no llega un correo por corrida.
              Llegan <strong style={{ color: 'var(--ink)' }}>{datos.antiRuido.marcas.length} como máximo</strong>{' '}
              por incidente: el primero, y luego solo cuando la cosa empeora de verdad
              ({datos.antiRuido.marcas.join(', ')} veces). Entre dos avisos siempre
              pasan al menos {datos.antiRuido.pisoMinutos} minutos — también cuando algo
              se rompe, se arregla y se vuelve a romper. La cuenta vuelve a cero en cuanto
              el problema se resuelve, así que el siguiente incidente te avisa desde el primero.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BotonGuardar({ apagado, sucio }: { apagado: boolean; sucio: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending || apagado}
      title={apagado ? 'El correo no está configurado en este entorno' : undefined}
      className="text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-40"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {pending ? 'Guardando…' : sucio ? 'Guardar cambios' : 'Guardar notificaciones'}
    </button>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{children}</p>;
}

function Banda({ tono, Icono, children }: {
  tono: 'warn' | 'bad';
  Icono: typeof Mail;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl hairline px-3.5 py-2.5 flex items-start gap-2.5 text-[12.5px]"
      style={{ background: 'var(--surface)' }}>
      <Icono width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: `var(--${tono})` }} />
      <span style={{ color: 'var(--muted)' }}>{children}</span>
    </div>
  );
}
