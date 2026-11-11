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
import { getSLOs } from '@/lib/admin/slo';
import { logger } from '@/lib/logger';
import { BotonEnlace, MarcoPagina, EstadoVacio, ListaFuentes } from '../../ui-v2/componentes';
import { getT } from '@/lib/i18n/servidor';
import { ahoraMs } from '@/lib/saludo';
import { evaluarFuentes, resumirFuentes } from '@/lib/likida/fuentes/estado';
import { entradasDeLatidos, RELOJ_DE_FUENTE } from '@/lib/likida/fuentes/desde_latidos';
import { filasDeEvaluaciones } from '@/lib/likida/fuentes/texto';
import { leerSilencioWebhook } from '@/lib/likida/fuentes/leer';
import { TiraCifras } from '../../ui-v2/graficas';
import { obtenerPanoramaAccion } from '../requiere-accion';
import { resumenRelojes } from '../crons/estado-relojes';
import { TarjetaRenglon, type RenglonSistema } from '../renglon-sistema';
import '../sistema.css';

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
  const base = {
    titulo: 'Base de datos (Supabase)',
    link: { href: 'https://supabase.com/dashboard', texto: 'Abrir el panel de Supabase' },
  };
  try {
    // supabase-js reporta POR VALOR: sin comprobar `error`, una base caída se leería como "respondió". Ver `exigir()` en analytics.ts.
    const { error } = await acotada(
      supabaseAdmin().from('tenant').select('id', { count: 'exact', head: true }),
      'salud.tenant',
    );
    if (error) {
      return { ...base, tono: 'bad', etiqueta: 'No respondió', detalle: `No respondió: ${error.message}` };
    }
    return { ...base, tono: 'ok', etiqueta: 'Respondió', detalle: 'Se hizo una consulta real al abrir esta pantalla y contestó.' };
  } catch (e) {
    // `supabaseAdmin()` lanza si faltan sus variables; también es "no respondió".
    return { ...base, tono: 'bad', etiqueta: 'No respondió', detalle: `No respondió: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function renglonAlerta(): RenglonSistema {
  const titulo = 'Aviso al operador cuando algo falla';
  const correo = process.env.ALERTA_EMAIL;
  if (alertaConfigurada() && correo) {
    return {
      titulo, tono: 'ok', etiqueta: `Avisos a ${ofuscado(correo)}`,
      detalle: 'Cuando un reloj falla, sale un correo al operador (máximo uno por evento por hora).',
    };
  }
  if (!correo) {
    return {
      titulo, tono: 'warn', etiqueta: 'Sin destinatario',
      detalle: 'Los fallos de los relojes no le llegan a nadie por correo.',
      arreglo: 'Falta la variable ALERTA_EMAIL en el servidor.',
    };
  }
  // Hay dirección pero el correo (Resend) no está configurado: la alerta no tiene por dónde salir. Decirlo "listo" sería el mismo verde de adorno.
  return {
    titulo, tono: 'warn', etiqueta: 'Correo sin configurar',
    detalle: 'Hay dirección de aviso, pero el correo no está configurado: la alerta no puede salir.',
    arreglo: 'Faltan RESEND_API_KEY o RESEND_EMAIL_DOMAIN en el servidor.',
  };
}

/** El cofre de credenciales de conectores. La medición es la misma que usa la pantalla de conectores: `cofreConfigurado()` — presente Y
 *  de al menos 32 caracteres, no solo presente. */
function renglonCofre(): RenglonSistema {
  const titulo = 'Cofre de credenciales';
  return cofreConfigurado()
    ? { titulo, tono: 'ok', etiqueta: 'Llave puesta', detalle: 'Las credenciales de los conectores (rastreo GPS) se pueden cifrar y guardar.' }
    : {
      titulo, tono: 'warn', etiqueta: 'Ausente o demasiado corta',
      detalle: 'El cofre no puede guardar credenciales de conectores. A propósito no las guarda sin cifrar: el modo de falla aceptable es «no se guardó», nunca «se guardó en claro».',
      arreglo: 'Falta LIKIDA_COFRE_LLAVE, o tiene menos de 32 caracteres.',
    };
}

/** Sin `CRON_SECRET`, TODOS los relojes devuelven error A PROPÓSITO (`puertaCron`): un 200 dejaría el reloj verde en Vercel sin haber
 *  hecho nada. La cuenta sale de `CRONS`, la misma constante que `salud.test.ts` cruza contra vercel.json: no se puede desfasar. */
function renglonCronSecret(): RenglonSistema {
  const titulo = 'Clave de los relojes';
  return process.env.CRON_SECRET
    ? {
      titulo, tono: 'ok', etiqueta: 'Configurada',
      detalle: `Los ${CRONS.length} relojes la exigen en cada disparo y Vercel la manda sola.`,
    }
    : {
      titulo, tono: 'bad', etiqueta: 'Sin clave: los relojes no corren',
      detalle: `Los ${CRONS.length} relojes devuelven error sin ella (a propósito: un éxito dejaría el reloj en verde sin hacer nada). Ninguno está corriendo.`,
      arreglo: 'Falta CRON_SECRET en el servidor.',
    };
}

/** QStash: presencia de las TRES variables. El estado parcial (token sin llaves) es el peligroso: el reloj encola y la respuesta de vuelta se rechaza. */
function renglonQstash(): RenglonSistema {
  const titulo = 'Cola de facturación (QStash)';
  const token = !!process.env.UPSTASH_QSTASH_TOKEN;
  const llaves = !!process.env.QSTASH_CURRENT_SIGNING_KEY && !!process.env.QSTASH_NEXT_SIGNING_KEY;
  if (token && llaves) {
    return {
      titulo, tono: 'ok', etiqueta: 'Token y llaves de firma presentes',
      detalle: 'El reloj de facturación puede encolar lotes grandes, hasta 10 minutos por lote, y la vuelta verifica la firma.',
    };
  }
  if (token && !llaves) {
    return {
      titulo, tono: 'bad', etiqueta: 'Token SIN llaves de firma',
      detalle: 'El reloj encola el lote pero la vuelta lo rechaza (error 503) porque no puede verificar la firma: lo encolado no se procesa.',
      arreglo: 'Faltan QSTASH_CURRENT_SIGNING_KEY y QSTASH_NEXT_SIGNING_KEY.',
    };
  }
  return {
    titulo, tono: 'warn', etiqueta: 'Sin configurar',
    detalle: 'Sin la cola, el reloj de facturación procesa el lote en la misma pasada, bajo el tope de 300 s: funciona, pero un lote grande se corta. La cola existe para romper ese tope.',
    arreglo: 'Falta UPSTASH_QSTASH_TOKEN.',
  };
}

/** Límite de intentos distribuido (auditoría externa 15-ago, P1). Sin las dos variables de Upstash Redis, `rateLimit` sigue funcionando
 *  pero cae al Map en memoria de CADA instancia — en Vercel, "10 intentos" se vuelven "10 × instancias en paralelo": no hay límite
 *  global. Mismo `bad` que Sentry: no es "un lote grande se corta", es "la protección contra fuerza bruta no protege". */
function renglonRatelimit(): RenglonSistema {
  const titulo = 'Límite de intentos (Upstash Redis)';
  return redisConfigurado()
    ? {
      titulo, tono: 'ok', etiqueta: 'Configurado',
      detalle: 'El conteo de intentos de login, exportaciones y del webhook de WhatsApp es global entre instancias, no por instancia.',
    }
    : {
      titulo, tono: 'bad', etiqueta: 'Sin configurar — límite solo por instancia',
      detalle: 'El límite vive en la memoria de cada instancia y en Vercel eso ya no es un límite global: la protección contra intentos repetidos no protege.',
      arreglo: 'Faltan UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN.',
    };
}

const NOMBRE_GRUPO: Record<EnvGroup, string> = {
  llm: 'IA (OpenRouter)',
  whatsapp: 'WhatsApp Cloud API',
  supabase: 'Supabase (llaves)',
};

export default async function SaludSistemaPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const salud = envHealth();
  const falta = faltantes();
  // Las cuatro lecturas caen cada una por su lado y NINGUNA tumba la pantalla: una fuente ciega se dice «sin dato», nunca un cero.
  const [supabase, latidos, slos, panorama, silencio, { t: tf }] = await Promise.all([
    medirSupabase(),
    detalleLatidos().catch((e: unknown) => { logger.error('admin.salud.latidos', { err: e instanceof Error ? e.message : String(e) }); return null; }),
    getSLOs().catch((e: unknown) => { logger.error('admin.salud.slos', { err: e instanceof Error ? e.message : String(e) }); return null; }),
    obtenerPanoramaAccion().catch(() => null),
    leerSilencioWebhook().catch(() => null),
    getT('fuentes'),
  ]);
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
        titulo: 'Errores (Sentry)', tono: 'ok', etiqueta: 'Destino de errores puesto',
        detalle: 'Hay a dónde mandar los errores. Que Sentry los reciba de verdad se comprueba en su panel, no desde aquí.',
        link: { href: 'https://sentry.io', texto: 'Abrir Sentry' },
      }
      : {
        titulo: 'Errores (Sentry)', tono: 'bad', etiqueta: 'Sin DSN — ciego',
        detalle: 'Los errores solo quedan en el registro de ejecución de Vercel, sin alerta y con retención corta.',
        arreglo: 'Falta el DSN de Sentry en el servidor.',
        link: { href: 'https://sentry.io', texto: 'Abrir Sentry' },
      },
    supabase,
    correoConfigurado()
      ? { titulo: 'Correo (Resend)', tono: 'ok', etiqueta: 'Configurado', detalle: 'Hay llave y dominio remitente: los avisos por correo pueden salir.' }
      : {
        titulo: 'Correo (Resend)', tono: 'warn', etiqueta: 'Sin configurar',
        detalle: 'Ningún aviso por correo sale (esperado en local).',
        arreglo: 'Faltan RESEND_API_KEY o RESEND_EMAIL_DOMAIN en el servidor.',
      },
    renglonAlerta(),
    renglonCronSecret(),
    renglonCofre(),
    renglonQstash(),
    renglonRatelimit(),
    {
      titulo: 'Disponibilidad y despliegues (Vercel)', tono: 'neutral', etiqueta: 'No medido',
      // Un verde fijo aquí es mentira; un neutral honesto no. Desde adentro no hay nada que medir: si esta página renderiza, Vercel ya contestó.
      detalle: 'No se mide desde aquí. Abre el panel: historial de despliegues, registros de construcción y de ejecución.',
      link: { href: 'https://vercel.com/dashboard', texto: 'Abrir el panel de Vercel' },
    },
    {
      titulo: 'Cobro, timbrado y cuenta de transferencias', tono: 'neutral', etiqueta: 'Medidos en Planes y cobro',
      // Se ENLAZA, no se duplica: esos tres ya tienen semáforo medido allá, y dos copias del mismo semáforo se desincronizan al primer cambio.
      detalle: 'El cobro (Stripe), el timbrado de facturas (Facturapi) y la cuenta de transferencias ya tienen su semáforo medido en su propia pantalla.',
      link: { href: '/admin/costos-facturacion', texto: 'Ir a Planes y cobro' },
    },
    ...(Object.keys(NOMBRE_GRUPO) as EnvGroup[]).map((g): RenglonSistema => (
      salud[g]
        ? { titulo: `Variables de ${NOMBRE_GRUPO[g]}`, tono: 'ok', etiqueta: 'Completas', detalle: 'Todas las variables del grupo están puestas en este entorno.' }
        : {
          titulo: `Variables de ${NOMBRE_GRUPO[g]}`, tono: 'bad', etiqueta: 'Incompletas',
          detalle: 'Faltan variables de este grupo en este entorno.',
          arreglo: `Faltan: ${(falta[g] ?? []).join(', ')}.`,
        }
    )),
  ];

  return (
    <MarcoPagina titulo="Estado" apoyo="Si el sistema está vivo, hoy: relojes, objetivos de servicio y cada pieza de la que depende. Todo está medido o dice que no lo está.">
      <TiraCifras etiqueta="Resumen de salud" items={[
        relojes === null
          ? { etiqueta: 'Relojes a tiempo', valor: null, estado: 'error', mensaje: 'No se pudo leer el pulso de los relojes.', reintentar: true }
          : { etiqueta: 'Relojes a tiempo', valor: CRONS.length - relojesMalos, formato: 'entero', tono: relojesMalos > 0 ? 'bad' : relojes.parciales.length > 0 ? 'warn' : 'ok', nota: relojesMalos > 0 ? `${relojesMalos} de ${CRONS.length} no laten o fallaron.` : relojes.parciales.length > 0 ? `${relojes.parciales.length} con corrida parcial.` : `Los ${CRONS.length} latieron en su cadencia.`, href: '/admin/crons' },
        slos === null
          ? { etiqueta: 'Objetivos que se cumplen', valor: null, estado: 'error', mensaje: 'No se pudieron medir los objetivos.', reintentar: true }
          : medidos.length === 0
            ? { etiqueta: 'Objetivos que se cumplen', valor: null, estado: 'vacio', mensaje: 'Sin muestra suficiente para medirlos todavía.' }
            : { etiqueta: 'Objetivos que se cumplen', valor: medidos.length - incumplidos, formato: 'entero', tono: incumplidos > 0 ? 'bad' : 'ok', nota: `De ${medidos.length} medidos${slos.length > medidos.length ? `; ${slos.length - medidos.length} sin muestra` : ''}.`, href: '/admin/observabilidad' },
        pendientes === null
          ? { etiqueta: 'Pendientes de la consola', valor: null, estado: 'error', mensaje: 'No se pudo leer lo que espera a una persona.', reintentar: true }
          : { etiqueta: 'Pendientes de la consola', valor: pendientes, formato: 'entero', tono: panorama?.resumen.hayUrgente ? 'bad' : pendientes > 0 ? 'warn' : undefined, nota: 'Lo mismo que cuenta la campana.', href: '/admin/escalaciones' },
      ]} />

      {slos !== null && incumplidos > 0 ? (
        <section className="adm-sis-bloque" aria-labelledby="slo-incumplidos">
          <h2 className="adm-sis-titulo" id="slo-incumplidos">Objetivos que no se cumplen</h2>
          <ul className="adm-sis-lista">
            {slos.filter((x) => x.cumple === false).map((x) => (
              <li key={x.clave}><span>{x.nombre}</span><span>{x.medido} (objetivo {x.objetivo}, {x.ventana})</span></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="adm-sis-bloque" aria-labelledby="fuentes-sistema">
        <h2 className="adm-sis-titulo" id="fuentes-sistema">{tf('admin.titulo')}</h2>
        <p className="adm-sis-nota">{tf('admin.apoyo')}</p>
        <ListaFuentes
          etiqueta={tf('admin.titulo')}
          aviso={avisoSilencio}
          resumen={[tf('conexiones.resumen', { alDia: resumenFuentes.alDia, total: resumenFuentes.total })]}
          filas={filasDeEvaluaciones(evalsFuentes, tf, (e) => tf('admin.reloj', { cron: RELOJ_DE_FUENTE[e.id] }))}
        />
      </section>

      <section className="adm-sis-bloque" aria-labelledby="piezas-sistema">
        <h2 className="adm-sis-titulo" id="piezas-sistema">Cada pieza, medida o declarada sin medir</h2>
        <div className="adm-sis-rejilla">
          {renglones.map((r) => <TarjetaRenglon key={r.titulo} r={r} />)}
        </div>
      </section>

      <EstadoVacio titulo="Lo que aún no se instrumenta">
        Línea de incidentes, guardia y consumo contra límites de proveedores agregado no están medidos aquí. Sentry y Vercel miden lo suyo en sus propios paneles, enlazados arriba.
      </EstadoVacio>
      <div className="adm-sis-acciones">
        <BotonEnlace href="/admin/crons" variante="secondary" tamano="sm">Ver los relojes uno por uno</BotonEnlace>
        <BotonEnlace href="/admin/observabilidad" variante="secondary" tamano="sm">Interruptores y latencias</BotonEnlace>
      </div>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Estado' };
