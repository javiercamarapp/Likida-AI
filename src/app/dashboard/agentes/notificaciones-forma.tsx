'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AvisoCompacto, Boton, Casilla, Fieldset, Tooltip } from '@/app/ui-v2/componentes';
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
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

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
const rotuloRol = (t: TResto = T_RESTO_ES): Record<string, string> => ({
  flota_admin: t('op.dueno_de_la_flota'),
  encargado: t('ch.jefe_de_trafico'),
  contador: t('ch.contador'),
});

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
  const { t } = useT('resto', restoEs);
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
        <AvisoCompacto tono="warn" resumen={<>{rico(t('ch.el_correo_no_esta_configurado_en_2'), { strong: (c) => <strong>{c}</strong> })}</>}
          mas={t('ch.se_enciende_conectando_resend_en_conexiones')} />
      )}

      {datos.errorConfig && <AvisoCompacto tono="error" resumen={datos.errorConfig} />}

      <div className="rv-ag-notif__rejilla">
        <form action={accion} className="rv-ag-notif__forma">
          <input type="hidden" name="agente" value={datos.agente.id} />

          {/* ── DE QUÉ avisa ── «el» a mano: los seis se llaman "Agente de …", así que el artículo siempre cuadra. */}
          <Fieldset leyenda={t('ch.de_que_te_avisa_el', { nombre: datos.agente.nombre })}
            ayuda={t('ch.no_hay_casilla_para_la_corrida')}>
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
          <Fieldset leyenda={t('ch.a_quien_le_llega')}
            ayuda={t('ch.solo_cuentas_del_panel_de_esta')}>
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
                    etiqueta={rotuloRol(t)[rol] ?? rol}
                    ayuda={!c || c.total === 0
                      ? t('ch.nadie_con_este_rol_en_la')
                      : c.sinCorreo > 0
                        ? `${c.total} ${c.total === 1 ? 'cuenta' : 'cuentas'} · ${c.sinCorreo} sin correo`
                        : `${c.total} ${c.total === 1 ? 'cuenta' : 'cuentas'}`}
                  />
                );
              })}
            </div>
          </Fieldset>

          {sinNadie && <AvisoCompacto tono="warn" resumen={t('ch.tienes_avisos_encendidos_y_nadie_que')} />}

          <div className="rv-ag-notif__acciones">
            <BotonGuardar apagado={apagado} sucio={sucio} />
            {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
          </div>
        </form>

        {/* ── La verdad medida: a quién le llega hoy y a quién no ── */}
        <div className="rv-ag-notif__verdad">
          <section className="rv-ag-notif__bloque" aria-label={t('ch.hoy_le_llega_a')}>
            {/* sin-info: rótulo de bloque de lectura dentro de la sección Notificaciones */}
            <h3 className="rv-ag-notif__rotulo">{t('ch.hoy_le_llega_a')}</h3>
            {apagado ? (
              <Nota>{t('ch.hoy_no_le_llega_a_nadie')}</Nota>
            ) : datos.config === null ? (
              <Nota>{t('ch.no_se_pudo_leer_la_configuracion')}</Nota>
            ) : datos.reparto.reciben.length === 0 ? (
              <Nota>{datos.config.eventos.length === 0
                ? t('ch.este_agente_no_manda_ningun_correo')
                : t('ch.nadie_lo_recibe_todavia_revisa_los')}</Nota>
            ) : (
              <ul className="rv-ag-notif__personas">
                {datos.reparto.reciben.map((d) => (
                  <li key={d.id}>
                    <strong>{d.nombre ?? d.email}</strong>
                    <span>{d.email}</span>
                    <em>{rotuloRol(t)[d.rol] ?? d.rol}</em>
                  </li>
                ))}
              </ul>
            )}
            {sucio && !apagado && <Nota tono="warn">{t('ch.esta_lista_es_la_de_la')}</Nota>}
          </section>

          {datos.reparto.excluidos.length > 0 && (
            <section className="rv-ag-notif__bloque" aria-label={t('ch.a_quien_no_y_por_que')}>
              {/* sin-info: rótulo de bloque de lectura dentro de la sección Notificaciones */}
            <h3 className="rv-ag-notif__rotulo">{t('ch.a_quien_no_y_por_que')}</h3>
              {datos.reparto.excluidos.map((x) => (
                <p key={x.id} className="rv-ag-notif__nota">
                  <strong>{x.nombre ?? rotuloRol(t)[x.rol] ?? x.rol}</strong> — {x.porque}
                </p>
              ))}
            </section>
          )}

          {/* El anti-ruido, con los números del motor: es la pregunta que sigue a "¿lo enciendo?" y la razón por la que se puede encender. */}
          <section className="rv-ag-notif__bloque" aria-label={t('ch.cuantos_correos_como_maximo')}>
            {/* sin-info: rótulo de bloque de lectura dentro de la sección Notificaciones */}
            <h3 className="rv-ag-notif__rotulo">{t('ch.cuantos_correos_como_maximo')}</h3>
            <p className="rv-ag-notif__nota">{rico(t('ch.si_algo_se_rompe_y_sigue', { length: datos.antiRuido.marcas.length, datos: datos.antiRuido.marcas.join(', '), pisoMinutos: datos.antiRuido.pisoMinutos }), { strong: (c) => <strong>{c}</strong> })}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function BotonGuardar({ apagado, sucio }: { apagado: boolean; sucio: boolean }) {
  const { t } = useT('resto', restoEs);
  const { pending } = useFormStatus();
  const boton = (
    <Boton type="submit" variante={apagado ? 'secondary' : 'primary'} loading={pending} disabled={pending || apagado}
      className={apagado ? 'rv-ag-no-disponible' : undefined}>
      {apagado ? t('f26d2.boton.no_disponible') : pending ? 'Guardando…' : sucio ? t('op.guardar_cambios') : t('ch.guardar_notificaciones')}
    </Boton>
  );
  return apagado ? <Tooltip texto={t('ch.el_correo_no_esta_configurado_en')}>{boton}</Tooltip> : boton;
}

function Nota({ children, tono }: { children: React.ReactNode; tono?: 'warn' }) {
  return <p className="rv-ag-notif__nota" data-tono={tono}>{children}</p>;
}
