'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AvisoCompacto, Boton, Casilla, Fieldset } from '@/app/ui-v2/componentes';
import './agentes.css';
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
    <div className="rv-ag-notif">
      {apagado && (
        <AvisoCompacto tono="warn" resumen={<>El correo no está configurado en este entorno: <strong>no sale ningún aviso</strong>, se marque lo que se marque.</>}
          mas="Se enciende conectando Resend en Conexiones. Hasta entonces esta pantalla prefiere decirlo a ofrecer un interruptor que no hace nada." />
      )}

      {datos.errorConfig && <AvisoCompacto tono="error" resumen={datos.errorConfig} />}

      <div className="rv-ag-notif__rejilla">
        <form action={accion} className="rv-ag-notif__forma">
          <input type="hidden" name="agente" value={datos.agente.id} />

          {/* ── DE QUÉ avisa ── «el» a mano: los seis se llaman "Agente de …", así que el artículo siempre cuadra. */}
          <Fieldset leyenda={`De qué te avisa el ${datos.agente.nombre}`}
            ayuda="No hay casilla para «la corrida salió bien»: un aviso que llega cuando todo está en orden es el que más rápido enseña a ignorar los que sí piden algo.">
            <div className="rv-ag-notif__lista" data-apagado={apagado || undefined}>
              {datos.eventos.map((e) => {
                // `conectado === false` = este agente declara el evento pero todavía no hay código que lo emita. Se enseña APAGADO y
                // con el porqué, en vez de ofrecer una casilla que se marca, se guarda, y no dispara nada.
                const muerto = e.conectado === false;
                return (
                  <Casilla
                    key={e.id}
                    name="eventos"
                    value={e.id}
                    checked={!muerto && eventos.includes(e.id)}
                    disabled={muerto || apagado}
                    onChange={() => alternar(eventos, setEventos, e.id)}
                    etiqueta={e.titulo}
                    ayuda={
                      <>
                        <span className="rv-ag-notif__linea">{e.cuando}</span>
                        {muerto ? (
                          <span className="rv-ag-notif__linea" data-tono="warn">
                            Todavía no está conectado: este agente aún no detecta esa situación, así que encenderlo no mandaría nada.
                            Aparece aquí porque es lo siguiente que le toca.
                          </span>
                        ) : (
                          <span className="rv-ag-notif__linea">{e.porQue}</span>
                        )}
                      </>
                    }
                  />
                );
              })}
            </div>
          </Fieldset>

          {/* ── A QUIÉN ── */}
          <Fieldset leyenda="A quién le llega"
            ayuda="Solo cuentas del panel de esta flota. No se puede teclear una dirección suelta: cada destinatario es alguien que ya puede ver este dato adentro. Los operadores no aparecen: no tienen cuenta ni correo, hablan por WhatsApp.">
            <div className="rv-ag-notif__lista" data-apagado={apagado || undefined}>
              {datos.rolesPosibles.map((rol) => {
                const c = porRol[rol];
                return (
                  <Casilla
                    key={rol}
                    name="roles"
                    value={rol}
                    checked={roles.includes(rol)}
                    disabled={apagado}
                    onChange={() => alternar(roles, setRoles, rol)}
                    etiqueta={ROTULO_ROL[rol] ?? rol}
                    ayuda={!c || c.total === 0
                      ? 'nadie con este rol en la flota'
                      : c.sinCorreo > 0
                        ? `${c.total} ${c.total === 1 ? 'cuenta' : 'cuentas'} · ${c.sinCorreo} sin correo`
                        : `${c.total} ${c.total === 1 ? 'cuenta' : 'cuentas'}`}
                  />
                );
              })}
            </div>
          </Fieldset>

          {sinNadie && <AvisoCompacto tono="warn" resumen="Tienes avisos encendidos y nadie que los reciba. Marca un rol, o apaga los avisos." />}

          <div className="rv-ag-notif__acciones">
            <BotonGuardar apagado={apagado} sucio={sucio} />
            {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
          </div>
        </form>

        {/* ── La verdad medida: a quién le llega hoy y a quién no ── */}
        <div className="rv-ag-notif__verdad">
          <section className="rv-ag-notif__bloque" aria-label="Hoy le llega a">
            {/* sin-info: rótulo de bloque de lectura dentro de la sección Notificaciones */}
            <h3 className="rv-ag-notif__rotulo">Hoy le llega a</h3>
            {apagado ? (
              <Nota>Hoy no le llega a nadie: el canal de correo está apagado en este entorno.</Nota>
            ) : datos.config === null ? (
              <Nota>No se pudo leer la configuración, así que no sale ningún aviso. Guarda de nuevo para reactivarlos.</Nota>
            ) : datos.reparto.reciben.length === 0 ? (
              <Nota>{datos.config.eventos.length === 0
                ? 'Este agente no manda ningún correo: todos sus avisos están apagados.'
                : 'Nadie lo recibe todavía. Revisa los roles marcados y que esas cuentas tengan correo.'}</Nota>
            ) : (
              <ul className="rv-ag-notif__personas">
                {datos.reparto.reciben.map((d) => (
                  <li key={d.id}>
                    <strong>{d.nombre ?? d.email}</strong>
                    <span>{d.email}</span>
                    <em>{ROTULO_ROL[d.rol] ?? d.rol}</em>
                  </li>
                ))}
              </ul>
            )}
            {sucio && !apagado && <Nota tono="warn">Esta lista es la de la configuración guardada. Guarda para que aplique lo que acabas de marcar.</Nota>}
          </section>

          {datos.reparto.excluidos.length > 0 && (
            <section className="rv-ag-notif__bloque" aria-label="A quién no, y por qué">
              {/* sin-info: rótulo de bloque de lectura dentro de la sección Notificaciones */}
            <h3 className="rv-ag-notif__rotulo">A quién no, y por qué</h3>
              {datos.reparto.excluidos.map((x) => (
                <p key={x.id} className="rv-ag-notif__nota">
                  <strong>{x.nombre ?? ROTULO_ROL[x.rol] ?? x.rol}</strong> — {x.porque}
                </p>
              ))}
            </section>
          )}

          {/* El anti-ruido, con los números del motor: es la pregunta que sigue a "¿lo enciendo?" y la razón por la que se puede encender. */}
          <section className="rv-ag-notif__bloque" aria-label="Cuántos correos, como máximo">
            {/* sin-info: rótulo de bloque de lectura dentro de la sección Notificaciones */}
            <h3 className="rv-ag-notif__rotulo">Cuántos correos, como máximo</h3>
            <p className="rv-ag-notif__nota">
              Si algo se rompe y sigue roto, no llega un correo por corrida. Llegan <strong>{datos.antiRuido.marcas.length} como máximo</strong>{' '}
              por incidente: el primero, y luego solo cuando la cosa empeora de verdad ({datos.antiRuido.marcas.join(', ')} veces). Entre dos
              avisos siempre pasan al menos {datos.antiRuido.pisoMinutos} minutos, también cuando algo se rompe, se arregla y se vuelve a
              romper. La cuenta vuelve a cero en cuanto el problema se resuelve, así que el siguiente incidente te avisa desde el primero.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function BotonGuardar({ apagado, sucio }: { apagado: boolean; sucio: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} disabled={pending || apagado}
      title={apagado ? 'El correo no está configurado en este entorno' : undefined}>
      {pending ? 'Guardando…' : sucio ? 'Guardar cambios' : 'Guardar notificaciones'}
    </Boton>
  );
}

function Nota({ children, tono }: { children: React.ReactNode; tono?: 'warn' }) {
  return <p className="rv-ag-notif__nota" data-tono={tono}>{children}</p>;
}
