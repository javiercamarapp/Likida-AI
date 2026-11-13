import { uniformes } from '@/app/admin/cifras-uniformes';
import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { sentryActivo } from '@/lib/observability/sentry';
import { alertaConfigurada } from '@/lib/observability/alerta';
import { correoConfigurado } from '@/lib/correo/enviar';
import { cofreConfigurado } from '@/lib/likida/conectores/cofre';
import { envHealth, faltantes, type EnvGroup } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { redisConfigurado } from '@/lib/ratelimit';
import { CRONS, detalleLatidos } from '@/lib/admin/salud';
import { getT } from '@/lib/i18n/servidor';
import { QuemaSlo, leerQuema } from '../quema-slo';
import { getSLOs, getLatencias, type LatenciasMedidas } from '@/lib/admin/slo';
import { logger } from '@/lib/logger';
import { BotonEnlace, FilaTarjetas, ListaFuentes, Tarjeta } from '../../ui-v2/componentes';
import { BarList } from '../../ui-v2/graficas';
import { numero } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { evaluarFuentes, resumirFuentes } from '@/lib/likida/fuentes/estado';
import { entradasDeLatidos, RELOJ_DE_FUENTE } from '@/lib/likida/fuentes/desde_latidos';
import { filasDeEvaluaciones } from '@/lib/likida/fuentes/texto';
import { leerSilencioWebhook } from '@/lib/likida/fuentes/leer';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { obtenerPanoramaAccion } from '../requiere-accion';
import { resumenRelojes } from '../crons/estado-relojes';
import { TablaRenglones, type RenglonSistema } from '../renglon-sistema';
import '../sistema.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// Salud del sistema / SRE — cada renglón está MEDIDO o dice "no medido".
//
// La versión anterior pintaba `<Semaphore estado="ok" etiqueta="Conectado">`
// FIJO para Sentry, Vercel y Supabase (auditoría 4, D3): un semáforo que no
// puede ponerse en rojo no es un semáforo, es decoración — y en la única
// pantalla que existe para preguntar "¿está vivo el sistema?", un verde de
// adorno es la mentira más cara posible. Regla del repo: un rótulo tiene que
// ser verdad.
//
// Qué puede afirmar cada renglón sin mentir:
//   · Sentry: solo que el DSN ESTÁ configurado. Que Sentry reciba de verdad no
//     se puede probar desde aquí sin mandar un evento — por eso el rótulo dice
//     "configurado", nunca "conectado".
//   · Supabase: una consulta real y barata (HEAD + count sobre `tenant`), con
//     el error comprobado POR VALOR y bajo el tope de `acotada` — una base
//     caída se dice, no se lee como "todo bien".
//   · Vercel: NO hay medición disponible desde adentro (medirse a sí mismo
//     respondiendo no dice nada: si esta página renderiza, Vercel contestó).
//     Neutral honesto con el link al panel, que es donde sí se mide.
//
// AUDITORÍA DEL 14-AGO — cuatro dependencias que sí tienen medición y estaban
// fuera del radar de esta pantalla entraron como renglones:
//   · `LIKIDA_COFRE_LLAVE` (`cofreConfigurado()`): sin ella el cofre no puede
//     cifrar y guardar credenciales de conectores — `cifrar()` LANZA a
//     propósito, porque guardarlas en claro no es una opción.
//   · `CRON_SECRET`: los tres crons (escalar, facturar, purgar) devuelven 500
//     SIN él, a propósito — un 200 dejaría el cron verde en Vercel sin haber
//     hecho nada.
//   · QStash (`UPSTASH_QSTASH_TOKEN` + las dos signing keys): la cola que
//     rompe el techo de 300 s del cron de facturación. El caso peligroso es el
//     PARCIAL: con token pero sin llaves, el cron encola y el callback rechaza
//     con 503 — el lote se queda encolado sin procesarse.
//   · Stripe / Facturapi / CLABE ya se miden en Costos & Facturación — se
//     enlaza, no se duplica la medición (dos copias del mismo semáforo se
//     desincronizan al primer cambio).
//
// AUDITORÍA EXTERNA DEL 15-AGO (P1) — una quinta: `redisConfigurado()`
// (Upstash Redis, `UPSTASH_REDIS_REST_URL`/`TOKEN`). Sin ella `rateLimit`
// sigue funcionando pero cae al Map en memoria de cada instancia: en Vercel,
// "10 intentos" se vuelven "10 × instancias en paralelo". Se mide con la
// MISMA función que ya usa `ratelimit.ts` para decidir su backend — ver la
// nota de `renglonRatelimit()`.
// ═══════════════════════════════════════════════════════════════════════════

/** `j***@dominio` — el renglón confirma A DÓNDE alertan los cron sin dejar el
 *  correo completo en una pantalla que puede acabar en una captura. */
function ofuscado(correo: string): string {
  const arroba = correo.indexOf('@');
  if (arroba <= 0) return '***';
  return `${correo[0]}***@${correo.slice(arroba + 1)}`;
}

/**
 * La consulta más barata que prueba el camino completo hasta Postgres: HEAD + count no trae filas, solo la cabecera con el conteo.
 */
async function medirSupabase(): Promise<RenglonSistema> {
  const { t: tx } = await getT('admin_sistema');
  const base = {
    titulo: tx('salud_sistema.base_de_datos_supabase'),
    link: { href: 'https://supabase.com/dashboard', texto: tx('salud_sistema.abrir_el_panel_de_supabase') },
  };
  try {
    // supabase-js reporta POR VALOR: sin comprobar `error`, una base caída se leería como "respondió". Ver `exigir()` en analytics.ts.
    const { error } = await acotada(
      supabaseAdmin().from('tenant').select('id', { count: 'exact', head: true }),
      'salud.tenant',
    );
    if (error) {
      return { ...base, tono: 'bad', etiqueta: tx('salud_sistema.no_respondio'), detalle: tx('salud_sistema.no_respondio_2', { message: error.message }) };
    }
    return { ...base, tono: 'ok', etiqueta: tx('salud_sistema.respondio'), detalle: tx('salud_sistema.se_hizo_una_consulta_real_al') };
  } catch (e) {
    // `supabaseAdmin()` lanza si faltan sus variables; también es "no respondió".
    return { ...base, tono: 'bad', etiqueta: tx('salud_sistema.no_respondio'), detalle: tx('salud_sistema.no_respondio_3', { v: e instanceof Error ? e.message : String(e) }) };
  }
}

function renglonAlerta(tx: TSistema = T_SISTEMA_ES): RenglonSistema {
  const titulo = tx('salud_sistema.aviso_al_operador_cuando_algo_falla');
  const correo = process.env.ALERTA_EMAIL;
  if (alertaConfigurada() && correo) {
    return {
      titulo, tono: 'ok', etiqueta: tx('salud_sistema.avisos_a', { correo: ofuscado(correo) }),
      detalle: tx('salud_sistema.cuando_un_reloj_falla_sale_un'),
    };
  }
  if (!correo) {
    return {
      titulo, tono: 'warn', etiqueta: tx('salud_sistema.sin_destinatario'),
      detalle: tx('salud_sistema.los_fallos_de_los_relojes_no'),
      arreglo: tx('salud_sistema.falta_la_variable_alerta_email_en'),
    };
  }
  // Hay dirección pero el correo (Resend) no está configurado: la alerta no tiene por dónde salir. Decirlo "listo" sería el mismo verde de adorno.
  return {
    titulo, tono: 'warn', etiqueta: tx('salud_sistema.correo_sin_configurar'),
    detalle: tx('salud_sistema.hay_direccion_de_aviso_pero_el'),
    arreglo: tx('salud_sistema.faltan_resend_api_key_o_resend'),
  };
}

/** El cofre de credenciales de conectores. La medición es la misma que usa la pantalla de conectores: `cofreConfigurado()` — presente Y
 *  de al menos 32 caracteres, no solo presente. */
function renglonCofre(tx: TSistema = T_SISTEMA_ES): RenglonSistema {
  const titulo = tx('salud_sistema.cofre_de_credenciales');
  return cofreConfigurado()
    ? { titulo, tono: 'ok', etiqueta: tx('salud_sistema.llave_puesta'), detalle: tx('salud_sistema.las_credenciales_de_los_conectores_rastreo') }
    : {
      titulo, tono: 'warn', etiqueta: tx('salud_sistema.ausente_o_demasiado_corta'),
      detalle: tx('salud_sistema.el_cofre_no_puede_guardar_credenciales'),
      arreglo: tx('salud_sistema.falta_likida_cofre_llave_o_tiene'),
    };
}

/** Sin `CRON_SECRET`, TODOS los relojes devuelven error A PROPÓSITO (`puertaCron`): un 200 dejaría el reloj verde en Vercel sin haber
 *  hecho nada. La cuenta sale de `CRONS`, la misma constante que `salud.test.ts` cruza contra vercel.json: no se puede desfasar. */
function renglonCronSecret(tx: TSistema = T_SISTEMA_ES): RenglonSistema {
  const titulo = tx('salud_sistema.clave_de_los_relojes');
  return process.env.CRON_SECRET
    ? {
      titulo, tono: 'ok', etiqueta: tx('salud_sistema.configurada'),
      detalle: tx('salud_sistema.los_relojes_la_exigen_en_cada', { length: CRONS.length }),
    }
    : {
      titulo, tono: 'bad', etiqueta: tx('salud_sistema.sin_clave_los_relojes_no_corren'),
      detalle: tx('salud_sistema.los_relojes_devuelven_error_sin_ella', { length: CRONS.length }),
      arreglo: tx('salud_sistema.falta_cron_secret_en_el_servidor'),
    };
}

/** QStash: presencia de las TRES variables. El estado parcial (token sin llaves) es el peligroso: el reloj encola y la respuesta de vuelta se rechaza. */
function renglonQstash(tx: TSistema = T_SISTEMA_ES): RenglonSistema {
  const titulo = tx('salud_sistema.cola_de_facturacion_qstash');
  const token = !!process.env.UPSTASH_QSTASH_TOKEN;
  const llaves = !!process.env.QSTASH_CURRENT_SIGNING_KEY && !!process.env.QSTASH_NEXT_SIGNING_KEY;
  if (token && llaves) {
    return {
      titulo, tono: 'ok', etiqueta: tx('salud_sistema.token_y_llaves_de_firma_presentes'),
      detalle: tx('salud_sistema.el_reloj_de_facturacion_puede_encolar'),
    };
  }
  if (token && !llaves) {
    return {
      titulo, tono: 'bad', etiqueta: tx('salud_sistema.token_sin_llaves_de_firma'),
      detalle: tx('salud_sistema.el_reloj_encola_el_lote_pero'),
      arreglo: tx('salud_sistema.faltan_qstash_current_signing_key_y_qstash_next_signing_key'),
    };
  }
  return {
    titulo, tono: 'warn', etiqueta: tx('salud_sistema.sin_configurar'),
    detalle: tx('salud_sistema.sin_la_cola_el_reloj_de'),
    arreglo: tx('salud_sistema.falta_upstash_qstash_token'),
  };
}

/** Límite de intentos distribuido (auditoría externa 15-ago, P1). Sin las dos variables de Upstash Redis, `rateLimit` sigue funcionando
 *  pero cae al Map en memoria de CADA instancia — en Vercel, "10 intentos" se vuelven "10 × instancias en paralelo": no hay límite
 *  global. Mismo `bad` que Sentry: no es "un lote grande se corta", es "la protección contra fuerza bruta no protege". */
function renglonRatelimit(tx: TSistema = T_SISTEMA_ES): RenglonSistema {
  const titulo = tx('salud_sistema.limite_de_intentos_upstash_redis');
  return redisConfigurado()
    ? {
      titulo, tono: 'ok', etiqueta: tx('salud_sistema.configurado'),
      detalle: tx('salud_sistema.el_conteo_de_intentos_de_login'),
    }
    : {
      titulo, tono: 'bad', etiqueta: tx('salud_sistema.sin_configurar_limite_solo_por_instancia'),
      detalle: tx('salud_sistema.el_limite_vive_en_la_memoria'),
      arreglo: tx('salud_sistema.faltan_upstash_redis_rest_url_y_token'),
    };
}

const nombreGrupo = (tx: TSistema = T_SISTEMA_ES): Record<EnvGroup, string> => ({
  llm: tx('salud_sistema.ia_openrouter'),
  whatsapp: 'WhatsApp Cloud API',
  supabase: tx('salud_sistema.supabase_llaves'),
});

export default async function SaludSistemaPage() {
  const { t: tx } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const salud = envHealth();
  const NOMBRE_GRUPO = nombreGrupo(tx);
  const falta = faltantes();
  // Las cuatro lecturas caen cada una por su lado y NINGUNA tumba la pantalla: una fuente ciega se dice «sin dato», nunca un cero.
  const [supabase, latidos, slos, panorama, quemaSlo, silencio, latencias, { t: tf }] = await Promise.all([
    medirSupabase(),
    detalleLatidos().catch((e: unknown) => { logger.error('admin.salud.latidos', { err: e instanceof Error ? e.message : String(e) }); return null; }),
    getSLOs().catch((e: unknown) => { logger.error('admin.salud.slos', { err: e instanceof Error ? e.message : String(e) }); return null; }),
    obtenerPanoramaAccion().catch(() => null),
    leerQuema(),
    leerSilencioWebhook().catch(() => null),
    getLatencias(7).catch((): LatenciasMedidas | null => null),
    getT('fuentes'),
  ]);
  const { t: tMon } = await getT('monitoreo');
  const lista = latidos === null ? null : CRONS.map((c) => ({ cron: c, l: latidos[c] }));
  const relojes = lista === null ? null : resumenRelojes(lista);
  const relojesMalos = relojes === null ? 0 : new Set([...relojes.sinLatir, ...relojes.conFallo]).size;
  const medidos = slos?.filter((x) => x.cumple !== null) ?? [];
  const incumplidos = medidos.filter((x) => x.cumple === false).length;
  const pendientes = panorama?.resumen.pendientes ?? null;
  // F19: la MISMA pieza de estado por fuente que ve el cliente, aplicada al latido del reloj que lee cada fuente. Latidos ilegibles = «sin dato».
  const evalsFuentes = evaluarFuentes(entradasDeLatidos(latidos), ahoraMs());
  const resumenFuentes = resumirFuentes(evalsFuentes);
  const avisoSilencio = silencio?.hayAlerta ? tf('conexiones.silencio', { horas: silencio.umbralHoras, viajes: silencio.viajesAbiertos ?? 0 }) : null;

  const renglones: RenglonSistema[] = [
    sentryActivo()
      ? {
        titulo: tx('salud_sistema.errores_sentry'), tono: 'ok', etiqueta: tx('salud_sistema.destino_de_errores_puesto'),
        detalle: tx('salud_sistema.hay_a_donde_mandar_los_errores'),
        link: { href: 'https://sentry.io', texto: tx('salud_sistema.abrir_sentry') },
      }
      : {
        titulo: tx('salud_sistema.errores_sentry'), tono: 'bad', etiqueta: tx('salud_sistema.sin_dsn_ciego'),
        detalle: tx('salud_sistema.los_errores_solo_quedan_en_el'),
        arreglo: tx('salud_sistema.falta_el_dsn_de_sentry_en'),
        link: { href: 'https://sentry.io', texto: tx('salud_sistema.abrir_sentry') },
      },
    supabase,
    correoConfigurado()
      ? { titulo: tx('salud_sistema.correo_resend'), tono: 'ok', etiqueta: tx('salud_sistema.configurado'), detalle: tx('salud_sistema.hay_llave_y_dominio_remitente_los') }
      : {
        titulo: tx('salud_sistema.correo_resend'), tono: 'warn', etiqueta: tx('salud_sistema.sin_configurar'),
        detalle: tx('salud_sistema.ningun_aviso_por_correo_sale_esperado'),
        arreglo: tx('salud_sistema.faltan_resend_api_key_o_resend'),
      },
    renglonAlerta(tx),
    renglonCronSecret(tx),
    renglonCofre(tx),
    renglonQstash(tx),
    renglonRatelimit(tx),
    {
      titulo: tx('salud_sistema.disponibilidad_y_despliegues_vercel'), tono: 'neutral', etiqueta: tx('salud_sistema.no_medido'),
      // Un verde fijo aquí es mentira; un neutral honesto no. Desde adentro no hay nada que medir: si esta página renderiza, Vercel ya contestó.
      detalle: tx('salud_sistema.no_se_mide_desde_aqui_abre'),
      link: { href: 'https://vercel.com/dashboard', texto: tx('salud_sistema.abrir_el_panel_de_vercel') },
    },
    {
      titulo: tx('salud_sistema.cobro_timbrado_y_cuenta_de_transferencias'), tono: 'neutral', etiqueta: tx('salud_sistema.medidos_en_planes_y_cobro'),
      // Se ENLAZA, no se duplica: esos tres ya tienen semáforo medido allá, y dos copias del mismo semáforo se desincronizan al primer cambio.
      detalle: tx('salud_sistema.el_cobro_stripe_el_timbrado_de'),
      link: { href: '/admin/costos-facturacion', texto: tx('salud_sistema.ir_a_planes_y_cobro') },
    },
    ...(Object.keys(NOMBRE_GRUPO) as EnvGroup[]).map((g): RenglonSistema => (
      salud[g]
        ? { titulo: tx('salud_sistema.variables_de', { grupo: NOMBRE_GRUPO[g] }), tono: 'ok', etiqueta: tx('salud_sistema.completas'), detalle: tx('salud_sistema.todas_las_variables_del_grupo_estan') }
        : {
          titulo: tx('salud_sistema.variables_de', { grupo: NOMBRE_GRUPO[g] }), tono: 'bad', etiqueta: tx('salud_sistema.incompletas'),
          detalle: tx('salud_sistema.faltan_variables_de_este_grupo_en'),
          arreglo: tx('salud_sistema.faltan_variables', { lista: (falta[g] ?? []).join(', ') }),
        }
    )),
  ];

  const mayorP95 = <T extends { p95Ms: number | null }>(f: readonly T[] | null | undefined) => (f ?? []).filter((x) => x.p95Ms !== null).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)).slice(0, 6);
  const p95Rutas = mayorP95(latencias?.rutas);
  const p95Relojes = mayorP95(latencias?.crons);

  return (
    <EsqueletoPanelCifras titulo={tx('salud_sistema.estado')} apoyo={tx('salud_sistema.si_el_sistema_esta_vivo_hoy')} etiquetaCifras={tx('salud_sistema.resumen_de_salud')} cifras={uniformes([
        relojes === null
          ? { etiqueta: tx('salud_sistema.relojes_a_tiempo'), valor: null, estado: 'error', mensaje: tx('salud_sistema.no_se_pudo_leer_el_pulso'), reintentar: true }
          : { etiqueta: tx('salud_sistema.relojes_a_tiempo'), valor: CRONS.length - relojesMalos, formato: 'entero', tono: relojesMalos > 0 ? 'bad' : relojes.parciales.length > 0 ? 'warn' : 'ok', nota: relojesMalos > 0 ? tx('salud_sistema.de_no_laten_o_fallaron', { relojesMalos, length: CRONS.length }) : relojes.parciales.length > 0 ? tx('salud_sistema.con_corrida_parcial', { n: relojes.parciales.length }) : tx('salud_sistema.los_latieron_en_su_cadencia', { length: CRONS.length }), href: '/admin/crons' },
        slos === null
          ? { etiqueta: tx('salud_sistema.objetivos_que_se_cumplen'), valor: null, estado: 'error', mensaje: tx('salud_sistema.no_se_pudieron_medir_los_objetivos'), reintentar: true }
          : medidos.length === 0
            ? { etiqueta: tx('salud_sistema.objetivos_que_se_cumplen'), valor: null, estado: 'vacio', mensaje: tx('salud_sistema.sin_muestra_suficiente_para_medirlos_todavia') }
            : { etiqueta: tx('salud_sistema.objetivos_que_se_cumplen'), valor: medidos.length - incumplidos, formato: 'entero', tono: incumplidos > 0 ? 'bad' : 'ok', nota: slos.length > medidos.length ? tx('salud_sistema.de_medidos_sin_muestra', { medidos: medidos.length, sin: slos.length - medidos.length }) : tx('salud_sistema.de_medidos', { medidos: medidos.length }), href: '/admin/observabilidad' },
        pendientes === null
          ? { etiqueta: tx('salud_sistema.pendientes_de_la_consola'), valor: null, estado: 'error', mensaje: tx('salud_sistema.no_se_pudo_leer_lo_que'), reintentar: true }
          : { etiqueta: tx('salud_sistema.pendientes_de_la_consola'), valor: pendientes, formato: 'entero', tono: panorama?.resumen.hayUrgente ? 'bad' : pendientes > 0 ? 'warn' : undefined, nota: tx('salud_sistema.lo_mismo_que_cuenta_la_campana'), href: '/admin/escalaciones' },
        // Servicios con semáforo MEDIDO: los «no medido» (neutral) no cuentan ni a favor ni en contra.
        { etiqueta: tx('salud_sistema.kpi_servicios'), valor: renglones.filter((r) => r.tono === 'ok').length, formato: 'entero', tono: renglones.some((r) => r.tono === 'bad') ? 'bad' : renglones.some((r) => r.tono === 'warn') ? 'warn' : 'ok', nota: tx('salud_sistema.kpi_servicios_nota', { medidos: renglones.filter((r) => r.tono !== 'neutral').length, total: renglones.length }) },
      ])}
      >
      <Tarjeta titulo={tx('salud_sistema.cada_pieza_medida_o_declarada_sin')}>
        <TablaRenglones
          renglones={renglones} etiqueta={tx('salud_sistema.semaforo_por_servicio')}
          columnas={{ servicio: tx('salud_sistema.col_servicio'), estado: tx('salud_sistema.estado'), significa: tx('salud_sistema.col_significa'), enlace: tx('salud_sistema.col_enlace') }}
          rotuloArreglo={(n) => tx('salud_sistema.como_arreglar_n', { n })}
        />
      </Tarjeta>

      <FilaTarjetas variante="6-6">
        <Tarjeta key="rutas" titulo={tx('salud_sistema.grafica_rutas')} contenida reintentar
          estado={latencias === null || latencias.rutas === null ? 'error' : p95Rutas.length === 0 ? 'vacio' : 'ok'}
          mensaje={latencias === null || latencias.rutas === null ? tx('observabilidad.no_se_pudo_leer_la_latencia') : tx('observabilidad.sin_muestras_todavia')}
          detalle={tx('observabilidad.la_tabla_existe_y_esta_vacia')}>
          <BarList etiqueta={tx('salud_sistema.grafica_rutas')} items={p95Rutas.map((r) => ({ clave: r.nombre, etiqueta: r.nombre, valor: r.p95Ms, texto: `${numero(r.p95Ms ?? 0)} ms` }))} />
        </Tarjeta>
        <Tarjeta key="relojes" titulo={tx('salud_sistema.grafica_relojes')} contenida reintentar
          estado={latencias === null || latencias.crons === null ? 'error' : p95Relojes.length === 0 ? 'vacio' : 'ok'}
          mensaje={latencias === null || latencias.crons === null ? tx('observabilidad.no_se_pudo_leer_la_latencia_2') : tx('observabilidad.sin_muestras_todavia')}
          detalle={tx('observabilidad.ningun_reloj_ha_corrido_desde_que')}>
          <BarList etiqueta={tx('salud_sistema.grafica_relojes')} items={p95Relojes.map((r) => ({ clave: r.nombre, etiqueta: r.nombre, valor: r.p95Ms, texto: `${numero(r.p95Ms ?? 0)} ms` }))} />
        </Tarjeta>
      </FilaTarjetas>

      {slos !== null && incumplidos > 0 ? (
        <section className="adm-sis-bloque adm-sis-caja" aria-labelledby="slo-incumplidos">
          <h2 className="adm-sis-titulo" id="slo-incumplidos">{tx('salud_sistema.objetivos_que_no_se_cumplen')}</h2>
          <ul className="adm-sis-lista">
            {slos.filter((x) => x.cumple === false).map((x) => (
              <li key={x.clave}><span>{x.nombre}</span>{rico(tx('salud_sistema.e0_objetivo_e0', { medido: x.medido, objetivo: x.objetivo, ventana: x.ventana }), { e0: (c) => <span>{c}</span> })}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <FilaTarjetas variante="6-6">
        <section className="adm-sis-bloque adm-sis-caja"><QuemaSlo evaluaciones={quemaSlo} t={tMon} /></section>
        <section className="adm-sis-bloque adm-sis-caja" aria-labelledby="fuentes-sistema">
          <h2 className="adm-sis-titulo" id="fuentes-sistema">{tf('admin.titulo')}</h2>
          <p className="adm-sis-nota">{tf('admin.apoyo')}</p>
          <ListaFuentes
            etiqueta={tf('admin.titulo')}
            aviso={avisoSilencio}
            resumen={[tf('conexiones.resumen', { alDia: resumenFuentes.alDia, total: resumenFuentes.total })]}
            filas={filasDeEvaluaciones(evalsFuentes, tf, (e) => tf('admin.reloj', { cron: RELOJ_DE_FUENTE[e.id] }))}
          />
        </section>
      </FilaTarjetas>

      <Tarjeta
        titulo={tx('salud_sistema.lo_que_aun_no_se_instrumenta')}
        acciones={(
          <span className="adm-sis-acciones">
            <BotonEnlace href="/admin/crons" variante="secondary" tamano="sm">{tx('salud_sistema.ver_los_relojes_uno_por_uno')}</BotonEnlace>
            <BotonEnlace href="/admin/observabilidad" variante="secondary" tamano="sm">{tx('salud_sistema.interruptores_y_latencias')}</BotonEnlace>
          </span>
        )}
      >
        <p className="adm-sis-nota">{tx('salud_sistema.linea_de_incidentes_guardia_y_consumo')}</p>
      </Tarjeta>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('salud_sistema.estado') };
}
