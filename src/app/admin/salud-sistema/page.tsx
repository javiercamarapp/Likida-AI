import Link from 'next/link';
import { HeartPulse, ExternalLink, ArrowRight } from 'lucide-react';
import { Semaphore, EstadoVacio, type Estado } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { sentryActivo } from '@/lib/observability/sentry';
import { alertaConfigurada } from '@/lib/observability/alerta';
import { correoConfigurado } from '@/lib/correo/enviar';
import { cofreConfigurado } from '@/lib/likida/conectores/cofre';
import { envHealth, faltantes, type EnvGroup } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { redisConfigurado } from '@/lib/ratelimit';

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

interface Renglon {
  titulo: string;
  estado: Estado;
  etiqueta: string;
  detalle: string;
  /** `/ruta` interna se pinta con <Link>; una URL externa abre en otra pestaña. */
  link?: { href: string; texto: string };
}

/** `j***@dominio` — el renglón confirma A DÓNDE alertan los cron sin dejar el
 *  correo completo en una pantalla que puede acabar en una captura. */
function ofuscado(correo: string): string {
  const arroba = correo.indexOf('@');
  if (arroba <= 0) return '***';
  return `${correo[0]}***@${correo.slice(arroba + 1)}`;
}

/**
 * La consulta más barata que prueba el camino completo hasta Postgres:
 * HEAD + count no trae filas, solo la cabecera con el conteo.
 */
async function medirSupabase(): Promise<Renglon> {
  const base = {
    titulo: 'Base de datos — Supabase',
    link: { href: 'https://supabase.com/dashboard', texto: 'Abrir el panel de Supabase' },
  };
  try {
    // supabase-js reporta POR VALOR: sin comprobar `error`, una base caída se
    // leería como "respondió". Ver `exigir()` en analytics.ts.
    const { error } = await acotada(
      supabaseAdmin().from('tenant').select('id', { count: 'exact', head: true }),
      'salud.tenant',
    );
    if (error) {
      return { ...base, estado: 'bad', etiqueta: 'No respondió', detalle: `No respondió: ${error.message}` };
    }
    return { ...base, estado: 'ok', etiqueta: 'Respondió', detalle: 'Consulta real (HEAD sobre tenant) al cargar esta página.' };
  } catch (e) {
    // `supabaseAdmin()` lanza si faltan sus variables; también es "no respondió".
    return { ...base, estado: 'bad', etiqueta: 'No respondió', detalle: `No respondió: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function renglonAlerta(): Renglon {
  const titulo = 'Canal de alerta al operador';
  const correo = process.env.ALERTA_EMAIL;
  if (alertaConfigurada() && correo) {
    return {
      titulo, estado: 'ok', etiqueta: `Alertas de cron a ${ofuscado(correo)}`,
      detalle: 'Cuando un cron falla, sale un correo al operador (máximo uno por evento por hora).',
    };
  }
  if (!correo) {
    return {
      titulo, estado: 'warn', etiqueta: 'Sin ALERTA_EMAIL',
      detalle: 'Los fallos de cron no le llegan a nadie por correo.',
    };
  }
  // Hay dirección pero el correo (Resend) no está configurado: la alerta no
  // tiene por dónde salir. Decirlo "listo" sería el mismo verde de adorno.
  return {
    titulo, estado: 'warn', etiqueta: 'Correo sin configurar',
    detalle: 'ALERTA_EMAIL está puesta, pero falta RESEND_API_KEY o RESEND_EMAIL_DOMAIN: la alerta no puede salir.',
  };
}

/** El cofre de credenciales de conectores (`LIKIDA_COFRE_LLAVE`). La medición
 *  es la misma que usa la pantalla de conectores: `cofreConfigurado()` —
 *  presente Y de al menos 32 caracteres, no solo presente. */
function renglonCofre(): Renglon {
  const titulo = 'Cofre de credenciales — LIKIDA_COFRE_LLAVE';
  return cofreConfigurado()
    ? {
      titulo, estado: 'ok', etiqueta: 'Llave puesta (≥ 32 caracteres)',
      detalle: 'Las credenciales de conectores (rastreo GPS) se pueden cifrar y guardar.',
    }
    : {
      titulo, estado: 'warn', etiqueta: 'Ausente o demasiado corta',
      detalle: 'El cofre no puede guardar credenciales de conectores: cifrar() lanza a propósito — el modo de falla aceptable es "no se guardó", no "se guardó en claro".',
    };
}

/** Sin `CRON_SECRET`, los tres crons (escalar, facturar, purgar) devuelven 500
 *  A PROPÓSITO — un 200 dejaría el cron verde en Vercel sin haber hecho nada. */
function renglonCronSecret(): Renglon {
  const titulo = 'Crons — CRON_SECRET';
  return process.env.CRON_SECRET
    ? {
      titulo, estado: 'ok', etiqueta: 'Configurado',
      detalle: 'Escalar, facturar y purgar lo exigen como Bearer; Vercel Cron lo manda en cada disparo.',
    }
    : {
      titulo, estado: 'bad', etiqueta: 'Sin CRON_SECRET — los crons no corren',
      detalle: 'Los tres crons devuelven 500 sin él (a propósito: un 200 dejaría el cron verde sin hacer nada). Escalación, facturación y purga están paradas.',
    };
}

/** QStash: presencia de las TRES variables. El estado parcial (token sin
 *  llaves) es el peligroso: el cron encola y el callback rechaza con 503. */
function renglonQstash(): Renglon {
  const titulo = 'Cola de facturación — QStash';
  const token = !!process.env.UPSTASH_QSTASH_TOKEN;
  const llaves = !!process.env.QSTASH_CURRENT_SIGNING_KEY && !!process.env.QSTASH_NEXT_SIGNING_KEY;
  if (token && llaves) {
    return {
      titulo, estado: 'ok', etiqueta: 'Token y llaves de firma presentes',
      detalle: 'El cron de facturación puede encolar lotes grandes con hasta 10 min por lote; el callback verifica la firma.',
    };
  }
  if (token && !llaves) {
    return {
      titulo, estado: 'bad', etiqueta: 'Token SIN llaves de firma',
      detalle: 'El cron encola el lote pero el callback lo rechaza con 503 (no puede verificar la firma): los tickets encolados no se procesan. Faltan QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY.',
    };
  }
  return {
    titulo, estado: 'warn', etiqueta: 'Sin configurar',
    detalle: 'Sin UPSTASH_QSTASH_TOKEN el cron de facturación procesa el lote inline (falla-cerrado), bajo el techo de 300 s por invocación — funciona, pero un lote grande se corta. La cola existe para romper ese techo.',
  };
}

/** Límite de tasa distribuido (auditoría externa 15-ago, P1). Sin las dos
 *  variables de Upstash Redis, `rateLimit` sigue funcionando pero cae al Map
 *  en memoria de CADA instancia — en Vercel, "10 intentos" se vuelven
 *  "10 × instancias en paralelo": no hay límite global. Mismo `bad` que
 *  Sentry (no `warn`, como QStash): a diferencia de la cola, esto no es "un
 *  lote grande se corta", es "la protección contra fuerza bruta no protege". */
function renglonRatelimit(): Renglon {
  const titulo = 'Límite de tasa distribuido — Upstash Redis';
  return redisConfigurado()
    ? {
      titulo, estado: 'ok', etiqueta: 'Configurado',
      detalle: 'El conteo de login, export y el webhook de WhatsApp es global entre instancias, no por instancia.',
    }
    : {
      titulo, estado: 'bad', etiqueta: 'Sin configurar — límite solo por instancia',
      detalle: 'Falta UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN: el límite vive en la memoria de cada instancia y en Vercel eso ya no es un límite global.',
    };
}

const NOMBRE_GRUPO: Record<EnvGroup, string> = {
  llm: 'IA (OpenRouter)',
  whatsapp: 'WhatsApp Cloud API',
  supabase: 'Supabase (llaves)',
};

export default async function SaludSistemaPage() {
  const supabase = await medirSupabase();
  const salud = envHealth();
  const falta = faltantes();

  const renglones: Renglon[] = [
    sentryActivo()
      ? {
        titulo: 'Errores — Sentry', estado: 'ok', etiqueta: 'DSN configurado',
        detalle: 'Hay destino para los errores. Que Sentry los reciba de verdad se comprueba en su panel, no desde aquí.',
        link: { href: 'https://sentry.io', texto: 'Abrir Sentry' },
      }
      : {
        titulo: 'Errores — Sentry', estado: 'bad', etiqueta: 'Sin DSN — ciego',
        detalle: 'Los errores solo quedan en el runtime log de Vercel, sin alerta y con retención corta.',
        link: { href: 'https://sentry.io', texto: 'Abrir Sentry' },
      },
    supabase,
    correoConfigurado()
      ? {
        titulo: 'Correo — Resend', estado: 'ok', etiqueta: 'Configurado',
        detalle: 'Hay llave y dominio remitente: los avisos por correo pueden salir.',
      }
      : {
        titulo: 'Correo — Resend', estado: 'warn', etiqueta: 'Sin configurar',
        detalle: 'Falta RESEND_API_KEY o RESEND_EMAIL_DOMAIN: ningún aviso por correo sale (esperado en local).',
      },
    renglonAlerta(),
    renglonCronSecret(),
    renglonCofre(),
    renglonQstash(),
    renglonRatelimit(),
    {
      titulo: 'Uptime y deploys — Vercel', estado: 'neutral', etiqueta: 'No medido',
      // Un verde fijo aquí es mentira; un neutral honesto no. Desde adentro no
      // hay nada que medir: si esta página renderiza, Vercel ya contestó.
      detalle: 'No medido desde aquí — abre el panel: historial de deploys, logs de build y runtime.',
      link: { href: 'https://vercel.com/dashboard', texto: 'Abrir el panel de Vercel' },
    },
    {
      titulo: 'Stripe · Facturapi · CLABE', estado: 'neutral', etiqueta: 'Medidos en Costos & Facturación',
      // Se ENLAZA, no se duplica: esos tres ya tienen semáforo medido allá
      // (stripeConfigurado, facturapiConfigurado, la CLABE con su dígito
      // verificador), y dos copias del mismo semáforo se desincronizan al
      // primer cambio.
      detalle: 'El cobro (Stripe), el timbrado CFDI (Facturapi) y la cuenta de transferencias ya tienen su semáforo medido en su propia página.',
      link: { href: '/admin/costos-facturacion', texto: 'Ir a Costos & Facturación' },
    },
    ...(Object.keys(NOMBRE_GRUPO) as EnvGroup[]).map((g): Renglon => (
      salud[g]
        ? {
          titulo: `Variables — ${NOMBRE_GRUPO[g]}`, estado: 'ok', etiqueta: 'Completas',
          detalle: 'Todas las variables del grupo están puestas en este entorno.',
        }
        : {
          titulo: `Variables — ${NOMBRE_GRUPO[g]}`, estado: 'bad', etiqueta: 'Incompletas',
          detalle: `Faltan: ${(falta[g] ?? []).join(', ')}.`,
        }
    )),
  ];

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<HeartPulse width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Salud del sistema"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-3">
            <TituloSeccion>SRE — cada renglón está medido o dice que no lo está</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2">
              {renglones.map((r) => (
                <div key={r.titulo} className="hairline rounded-lg px-3 py-2.5 flex flex-col gap-1" style={{ background: 'var(--surface)' }}>
                  <span className="text-[13px] font-medium">{r.titulo}</span>
                  <Semaphore estado={r.estado} etiqueta={r.etiqueta} />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{r.detalle}</span>
                  {r.link && (
                    r.link.href.startsWith('/') ? (
                      <Link href={r.link.href}
                        className="text-xs inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--muted)' }}>
                        {r.link.texto}
                        <ArrowRight width={12} height={12} strokeWidth={1.75} className="shrink-0" />
                      </Link>
                    ) : (
                      <a href={r.link.href} target="_blank" rel="noopener noreferrer"
                        className="text-xs inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--muted)' }}>
                        {r.link.texto}
                        <ExternalLink width={12} height={12} strokeWidth={1.75} className="shrink-0" />
                      </a>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>

          <EstadoVacio>
            Timeline de incidentes, on-call y consumo vs. rate limits agregado — no está instrumentado aquí hoy;
            Sentry y Vercel ya miden lo suyo en sus propios dashboards, enlazados arriba.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
