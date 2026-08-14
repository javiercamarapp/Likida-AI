import { Bell } from 'lucide-react';
import { requireSessionTenant } from '@/lib/auth/guard';
import { correoConfigurado, enviarCorreo } from '@/lib/correo/enviar';
import { avisoDePrueba } from '@/lib/correo/avisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import {
  agentePorId, eventosDe, rolesQuePueden, repartoDe,
  leerConfigNotificaciones, guardarConfigNotificaciones, usuariosAvisables,
  CONFIG_NOTIF_DEFAULT, MARCAS_DE_INSISTENCIA, PISO_ENTRE_AVISOS_MS, puedeConfigurarAvisos,
  type AgenteId, type Reparto, type UsuarioAvisable,
} from '@/lib/likida/agentes/notificaciones';
import { reclamarTurnoDePrueba, acuseDeEnvio } from './prueba-correo';
import { FormaNotificaciones } from './notificaciones-forma';
import { BotonPrueba, type EstadoPrueba } from './boton-prueba';

// ═══════════════════════════════════════════════════════════════════════════
// LA SECCIÓN «NOTIFICACIONES» — una sola, montada por los seis agentes.
//
// Handle le pone Notificaciones al menú de cada uno de sus agentes. Aquí no
// hay pestañas —las páginas de agente de Likida son secciones apiladas— así
// que es la última sección de cada una: se llega bajando, no cambiando de
// vista, y el estado del canal se ve junto a la cola que lo dispara.
//
// ── POR QUÉ UN COMPONENTE COMPARTIDO Y NO SEIS COPIAS ────────────────────
//
// La razón es la puerta, no el ahorro de líneas. Esta sección monta una server
// action que ESCRIBE a quién le llegan los correos de una flota: seis copias
// del gateo son seis lugares donde el día que alguien agregue un agente se
// puede olvidar una línea, y el modo de falla dominante del código escrito por
// agentes es exactamente ése (IDOR de autorización, no de SQL). Una sola
// puerta es una sola que auditar, y tiene su prueba.
//
// El gateo NO se hereda de la página. La action es alcanzable por POST directo
// sin pasar por el render, así que re-verifica sesión, permiso y tenant
// ADENTRO, con el tenantId cerrado en el closure cruzado contra el de la
// sesión.
// ═══════════════════════════════════════════════════════════════════════════

/** Falla del lado del "no se pudo leer", que NO es lo mismo que "no hay
 *  nadie": la primera se arregla mirando el log, la segunda capturando
 *  correos. Se distinguen en pantalla porque llevan a acciones opuestas. */
type Lectura =
  | { ok: true; usuarios: UsuarioAvisable[] }
  | { ok: false; error: string };

async function leerUsuarios(tenantId: string, agenteId: string): Promise<Lectura> {
  try {
    return { ok: true, usuarios: await usuariosAvisables(tenantId) };
  } catch (err) {
    logger.error('notificaciones.usuarios_ilegibles', {
      tenantId, agente: agenteId, err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: 'No se pudieron leer las cuentas de la flota, así que no se puede decir a quién le llega. Vuelve a cargar la página.' };
  }
}

export async function SeccionNotificaciones({ tenantId, agenteId }: {
  tenantId: string;
  agenteId: AgenteId;
}) {
  const agente = agentePorId(agenteId);
  // No debería pasar —el id es un literal del catálogo—, pero un agente que no
  // existe no puede tener config: se calla en vez de renderizar una pantalla
  // que escribiría a una llave inventada.
  if (!agente) return null;

  const [lectura, usuarios] = await Promise.all([
    leerConfigNotificaciones(tenantId, agente),
    leerUsuarios(tenantId, agente.id),
  ]);

  const config = 'ok' in lectura ? lectura.ok : null;
  const errorConfig = 'error' in lectura
    ? lectura.error
    : usuarios.ok ? null : usuarios.error;

  // El reparto se calcula sobre la config GUARDADA, nunca sobre lo que hay
  // marcado en pantalla: lo que se enseña es lo que de verdad va a pasar hoy.
  const reparto: Reparto = config && usuarios.ok
    ? repartoDe(usuarios.usuarios, config, agente)
    : { reciben: [], excluidos: [] };

  async function guardar(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const objetivo = agentePorId(agenteId);
    if (!objetivo) return { error: 'Ese agente no existe.' };

    const sesion = await requireSessionTenant(objetivo.ruta);
    const negado = puedeConfigurarAvisos(sesion, tenantId, objetivo);
    if (negado) {
      logger.warn('notificaciones.acceso_negado', { tenantId, agente: objetivo.id, rol: sesion.rol });
      return { error: negado };
    }

    // El `agente` del formulario se IGNORA para decidir sobre qué se escribe:
    // se usa el del closure. Si se confiara en el campo oculto, un POST
    // fabricado reconfiguraría los avisos de otro agente desde esta página.
    // Se compara, eso sí, y se rechaza el desajuste: es señal de un bug o de
    // un intento, y ninguno de los dos debe guardarse en silencio.
    if (String(fd.get('agente') ?? '') !== objetivo.id) {
      logger.warn('notificaciones.agente_no_coincide', {
        tenantId, esperado: objetivo.id, recibido: String(fd.get('agente') ?? ''),
      });
      return { error: 'La forma no corresponde a este agente. Vuelve a cargar la página.' };
    }

    const r = await guardarConfigNotificaciones(tenantId, objetivo, {
      eventos: fd.getAll('eventos').map(String),
      roles: fd.getAll('roles').map(String),
    });
    if (r.error) return { error: r.error };

    logger.info('notificaciones.guardadas', { tenantId, agente: objetivo.id });
    // SIN REDIRECT, a diferencia del resto de las actions de estos agentes.
    // Dos razones: esta sección vive al FINAL de una página larga y un
    // redirect devolvería al usuario arriba; y al no navegar, el query string
    // (?tenant=…&rol=…) lo conserva el navegador solo — no hace falta arrastrar
    // el `sufijo` para esquivar el redirect de `requireSessionTenant`, que es
    // la trampa que documenta `dashboard/sufijo.ts`.
    return null;
  }

  /**
   * «Mándate una prueba» (auditoría 4, B5) — el correo que confirma que el
   * canal llega ANTES de que algo se rompa de verdad. Hasta hoy la única
   * forma de saberlo era esperar un incidente real.
   *
   * VA AL PROPIO USUARIO A PROPÓSITO, nunca al reparto: la pregunta que este
   * botón contesta es «¿me llega a MÍ?», y un botón que le manda correos de
   * mentira a todo el equipo entrena a ignorar los reales — el daño exacto
   * que el anti-ruido del motor existe para evitar.
   *
   * NO pasa por `avisar()`: no hay incidente que contar ni marcas que
   * consultar. Su freno es el turno por (usuario, agente) de
   * `prueba-correo.ts` — en memoria y POR INSTANCIA, documentado allá.
   */
  async function mandarPrueba(_prev: EstadoPrueba, _fd: FormData): Promise<EstadoPrueba> {
    'use server';
    const objetivo = agentePorId(agenteId);
    if (!objetivo) return { error: 'Ese agente no existe.' };

    // EL MISMO GATEO QUE `guardar`, y por la misma razón: la action es
    // alcanzable por POST directo sin pasar por el render.
    const sesion = await requireSessionTenant(objetivo.ruta);
    const negado = puedeConfigurarAvisos(sesion, tenantId, objetivo);
    if (negado) {
      logger.warn('notificaciones.prueba_negada', { tenantId, agente: objetivo.id, rol: sesion.rol });
      return { error: negado };
    }

    // El turno se reclama ANTES de tocar la base: el freno es del botón
    // entero, no solo del envío, y un envío que luego falle lo consume igual
    // (mismo criterio que `reclamarAviso` en el motor).
    const turno = reclamarTurnoDePrueba(`${sesion.userId}:${objetivo.id}`, Date.now());
    if (!turno.ok) {
      return { error: `Acabas de mandarte una prueba. La siguiente sale en ${turno.faltanSegundos} s.` };
    }

    // El correo del PROPIO usuario. La sesión no lo trae (`SessionTenant` no
    // tiene email), así que se lee de `app_user` por su userId — y el error
    // se mira POR VALOR: sin esto, una base caída se leería como «no tienes
    // correo» y mandaría a la persona a capturar un dato que sí tiene.
    const { data, error } = await supabaseAdmin()
      .from('app_user').select('email').eq('id', sesion.userId).maybeSingle();
    if (error) {
      logger.error('notificaciones.prueba_correo_ilegible', { tenantId, agente: objetivo.id, err: error.message });
      return { error: 'No se pudo leer el correo de tu cuenta, así que la prueba no salió. Inténtalo de nuevo.' };
    }
    const correo = ((data?.email as string | null) ?? '').trim();
    if (!correo) {
      return { error: 'Tu cuenta no tiene correo capturado, así que no hay a dónde mandarte la prueba. Captúralo en Usuarios y vuelve a intentar.' };
    }

    // El nombre de la flota es cosmético aquí: si no se puede leer, la
    // prueba sale igual diciendo «tu flota» (mismo criterio que el despacho
    // real, `nombreDeFlota` en el motor).
    const flotaLeida = await supabaseAdmin()
      .from('tenant').select('nombre').eq('id', tenantId).maybeSingle();
    const flota = flotaLeida.error ? null : ((flotaLeida.data?.nombre as string | null) ?? null);

    const envio = await enviarCorreo(correo, avisoDePrueba({ flota, agente: objetivo.nombre }));
    if (envio.ok) {
      logger.info('notificaciones.prueba_enviada', { tenantId, agente: objetivo.id });
    } else {
      logger.warn('notificaciones.prueba_no_enviada', { tenantId, agente: objetivo.id, motivo: envio.motivo });
    }
    const acuse = acuseDeEnvio(envio, correo);
    return acuse.enviado ? { enviado: acuse.mensaje } : { error: acuse.mensaje };
  }

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Bell width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <h2 className="font-display text-[15px] font-semibold">Notificaciones</h2>
      </div>
      <p className="text-[11px] mb-3.5" style={{ color: 'var(--faint)' }}>
        De qué avisa este agente por correo, y a quién de tu equipo le llega.
      </p>
      <FormaNotificaciones
        guardar={guardar}
        datos={{
          agente: { id: agente.id, nombre: agente.nombre },
          eventos: eventosDe(agente),
          config,
          errorConfig,
          configDefault: CONFIG_NOTIF_DEFAULT,
          rolesPosibles: rolesQuePueden(agente),
          usuarios: usuarios.ok ? usuarios.usuarios : [],
          reparto,
          canalListo: correoConfigurado(),
          antiRuido: {
            marcas: MARCAS_DE_INSISTENCIA,
            pisoMinutos: Math.round(PISO_ENTRE_AVISOS_MS / 60_000),
          },
        }}
      />
      <BotonPrueba mandarPrueba={mandarPrueba} canalListo={correoConfigurado()} />
    </section>
  );
}
