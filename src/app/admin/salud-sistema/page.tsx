import { Activity, ExternalLink } from 'lucide-react';
import { Semaphore, EstadoVacio, type Estado } from '../ui/kit';
import { sentryActivo } from '@/lib/observability/sentry';
import { alertaConfigurada } from '@/lib/observability/alerta';
import { correoConfigurado } from '@/lib/correo/enviar';
import { envHealth, faltantes, type EnvGroup } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

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
// ═══════════════════════════════════════════════════════════════════════════

interface Renglon {
  titulo: string;
  estado: Estado;
  etiqueta: string;
  detalle: string;
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
    {
      titulo: 'Uptime y deploys — Vercel', estado: 'neutral', etiqueta: 'No medido',
      // Un verde fijo aquí es mentira; un neutral honesto no. Desde adentro no
      // hay nada que medir: si esta página renderiza, Vercel ya contestó.
      detalle: 'No medido desde aquí — abre el panel: historial de deploys, logs de build y runtime.',
      link: { href: 'https://vercel.com/dashboard', texto: 'Abrir el panel de Vercel' },
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
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Activity width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Salud del sistema</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>SRE — cada renglón está medido o dice que no lo está</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {renglones.map((r) => (
              <div key={r.titulo} className="card p-4 flex flex-col gap-1.5">
                <span className="text-sm font-medium">{r.titulo}</span>
                <Semaphore estado={r.estado} etiqueta={r.etiqueta} />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{r.detalle}</span>
                {r.link && (
                  <a href={r.link.href} target="_blank" rel="noopener noreferrer"
                    className="text-xs inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--muted)' }}>
                    {r.link.texto}
                    <ExternalLink width={12} height={12} strokeWidth={1.75} className="shrink-0" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            Timeline de incidentes, on-call y consumo vs. rate limits agregado — no está instrumentado aquí hoy;
            Sentry y Vercel ya miden lo suyo en sus propios dashboards, enlazados arriba.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
