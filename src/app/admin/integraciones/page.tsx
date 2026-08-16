import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/formato';
import {
  Blocks, Database, Mail, Bug, Rocket, Smartphone, KeyRound,
} from 'lucide-react';
import { sentryActivo } from '@/lib/observability/sentry';
import { correoConfigurado } from '@/lib/correo/enviar';
import { envHealth, faltantes } from '@/lib/env';
import { IconoProveedor } from '../proveedor-icono';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatusPill, EstadoVacio, type Estado } from '../ui/kit';

export const dynamic = 'force-dynamic';

/** El estado MEDIDO de un conector — o la confesión de que no se mide. */
interface Medicion { estado: Estado; etiqueta: string; detalle?: string }

/** Tarjeta de conector — ficha interna estilo consola (hairline sobre
 *  --surface). El pill ya NO es un `estado="ok"` fijo: la versión anterior
 *  pintaba "Conectado" en verde para las 5 tarjetas sin medir nada — el
 *  mismo "verde de adorno" que salud-sistema documenta como bug D3, y que
 *  la auditoría del 14-ago volvió a señalar aquí. Ahora cada pill viene de
 *  una medición real (`sentryActivo`, `correoConfigurado`, `envHealth`) con
 *  el rótulo que esa medición puede sostener ("DSN configurado", no
 *  "Conectado": que el servicio reciba de verdad se comprueba en su panel);
 *  y lo que no tiene medición desde aquí (Vercel) dice "Sin medir" en
 *  neutro, nunca verde. `href` externo abre en pestaña nueva; interno
 *  (WhatsApp Infra, ya vive bajo /admin) usa `next/link` para no recargar
 *  toda la consola. */
function Conector({
  Icono, titulo, subtitulo, href, medicion, externo = true,
}: {
  Icono: typeof Blocks; titulo: string; subtitulo: string; href: string;
  medicion: Medicion; externo?: boolean;
}) {
  const contenido = (
    <>
      <Icono width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium truncate">{titulo}</span>
          <StatusPill estado={medicion.estado}>{medicion.etiqueta}</StatusPill>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{subtitulo}</p>
        {medicion.detalle && (
          <p className="text-xs mt-1" style={{ color: medicion.estado === 'bad' ? 'var(--bad)' : 'var(--warn)' }}>
            {medicion.detalle}
          </p>
        )}
      </div>
    </>
  );
  const className = 'hairline rounded-lg px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-[var(--canvas)]';
  const estilo = { background: 'var(--surface)' };
  return externo ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={estilo}>{contenido}</a>
  ) : (
    <Link href={href} className={className} style={estilo}>{contenido}</Link>
  );
}

/**
 * Integraciones — a diferencia de WhatsApp Infra y Conocimiento/RAG, esta
 * página SÍ tiene mucho que enseñar de verdad: son conectores reales, y su
 * estado ahora está MEDIDO (variables de entorno y configuración de cada
 * servicio, las mismas mediciones que usa salud-sistema — no una copia:
 * `sentryActivo()`, `correoConfigurado()`, `envHealth()`/`faltantes()`).
 * Los proveedores de modelos no son una tarjeta genérica — se listan los
 * modelos reales que corrieron (`resumen.porModelo`, la misma fuente que
 * usa Inicio), porque eso es lo único honesto que se puede decir de un
 * "proveedor de LLM": no cuáles se PODRÍAN usar, sino cuáles YA se usaron.
 *
 * Re-envuelta en la anatomía de página (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts`.
 */
export default async function IntegracionesPage() {
  const r = await getResumenNegocio();
  const salud = envHealth();
  const falta = faltantes();

  // Qué puede afirmar cada pill sin mentir (mismo criterio que
  // salud-sistema): configuración presente ≠ servicio vivo. La prueba viva
  // de Supabase (consulta HEAD real) vive en salud-sistema; aquí se afirma
  // lo que estas mediciones alcanzan, con el rótulo exacto de lo medido.
  const medSupabase: Medicion = salud.supabase
    ? { estado: 'ok', etiqueta: 'Llaves completas' }
    : { estado: 'bad', etiqueta: 'Faltan llaves', detalle: `Faltan: ${(falta.supabase ?? []).join(', ')}.` };
  const medResend: Medicion = correoConfigurado()
    ? { estado: 'ok', etiqueta: 'Configurado' }
    : { estado: 'warn', etiqueta: 'Sin configurar', detalle: 'Falta RESEND_API_KEY o RESEND_EMAIL_DOMAIN: ningún correo sale (esperado en local).' };
  const medSentry: Medicion = sentryActivo()
    ? { estado: 'ok', etiqueta: 'DSN configurado' }
    : { estado: 'bad', etiqueta: 'Sin DSN', detalle: 'Los errores solo quedan en el runtime log de Vercel.' };
  // Desde adentro no hay nada que medir de Vercel: si esta página
  // renderiza, Vercel ya contestó. Neutral honesto, nunca verde fijo.
  const medVercel: Medicion = { estado: 'neutral', etiqueta: 'Sin medir' };
  const medWhatsapp: Medicion = salud.whatsapp
    ? { estado: 'ok', etiqueta: 'Variables completas' }
    : { estado: 'bad', etiqueta: 'Faltan variables', detalle: `Faltan: ${(falta.whatsapp ?? []).join(', ')}.` };

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Blocks width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Integraciones"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Los servicios reales de los que depende Likida hoy — cada pill está medido en este entorno, o dice que no se mide desde aquí
          </p>

          <div className="card p-3">
            <TituloSeccion>Conectores</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2">
              <Conector
                Icono={Database} titulo="Supabase" href="https://supabase.com/dashboard" medicion={medSupabase}
                subtitulo="Postgres + Auth + RLS — la base de datos y el login de toda la app. La prueba viva (consulta real) está en Salud del sistema."
              />
              <Conector
                Icono={Mail} titulo="Resend" href="https://resend.com/emails" medicion={medResend}
                subtitulo="Correo transaccional — los magic-links de inicio de sesión."
              />
              <Conector
                Icono={Bug} titulo="Sentry" href="https://sentry.io" medicion={medSentry}
                subtitulo="Registro de errores en producción. Que reciba de verdad se comprueba en su panel, no desde aquí."
              />
              <Conector
                Icono={Rocket} titulo="Vercel" href="https://vercel.com/dashboard" medicion={medVercel}
                subtitulo="Hosting y despliegues. Vercel ya lo mide en su panel — se enlaza en vez de reconstruirse."
              />
              <Conector
                Icono={Smartphone} titulo="Meta WhatsApp Business API" href="/admin/whatsapp-infra" externo={false} medicion={medWhatsapp}
                subtitulo="El número sigue siendo el de PRUEBA de Meta: el bot conversa completo, pero un chofer real aún no puede escribirle — falta número mexicano + verificación del negocio."
              />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <TituloSeccion>Proveedores de modelos (LLM)</TituloSeccion>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                No un conector genérico — los modelos reales que corrieron OCR y Cuadre, tal como quedaron
                registrados en <code className="font-mono">llm_costo</code>.
              </p>
            </div>
            {r.porModelo.length === 0 ? (
              <div className="px-4 pb-3 pt-2 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
            ) : (
              <div className="divide-y mt-1" style={{ borderColor: 'var(--line2)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="px-4 py-2.5 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{numero(m.n)} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-3">
            <TituloSeccion>Rotación de API keys</TituloSeccion>
            {/* EstadoVacio (kit compartido) — mismo icono (KeyRound, igual
                que antes) y mensaje honesto, ni una palabra cambiada. */}
            <div className="mt-2">
              <EstadoVacio icono={<KeyRound width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Rotación de API keys — Fase 5 del roadmap. Hoy las llaves de cada servicio viven en variables de
                entorno de Vercel, sin una UI de administración ni rotación automática dentro de este panel.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
