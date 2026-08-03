import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/formato';
import {
  Blocks, Database, Mail, Bug, Rocket, Smartphone, KeyRound,
} from 'lucide-react';
import { IconoProveedor } from '../proveedor-icono';

export const dynamic = 'force-dynamic';

/** Insignia monocromo — mismo patrón que admin/page.tsx, recreado local
 *  porque `page.tsx` no lo exporta (es una función chica, no vale la pena
 *  compartirla entre rutas). */
function Insignia({ Icono }: { Icono: typeof Blocks }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/** Punto de estado verde — las 5 tarjetas de esta sección están
 *  efectivamente conectadas HOY (no hay una tabla de "estado de
 *  integración" detrás; es un hecho verificable del código y la cuenta de
 *  cada servicio, igual que el resto de esta página). */
function PuntoOk() {
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--color-ok)' }} />;
}

/** Tarjeta de conector — mismo patrón que "Salud del sistema" en
 *  admin/page.tsx (`.card` que es un link completo, hover con sombra),
 *  ahora con un punto de estado junto al nombre. `href` externo abre en
 *  pestaña nueva; interno (WhatsApp Infra, ya vive bajo /admin) usa
 *  `next/link` para no recargar toda la consola. */
function Conector({
  Icono, titulo, subtitulo, href, externo = true,
}: {
  Icono: typeof Blocks; titulo: string; subtitulo: string; href: string; externo?: boolean;
}) {
  const contenido = (
    <>
      <Insignia Icono={Icono} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <PuntoOk />
          <span className="text-sm font-medium">{titulo}</span>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{subtitulo}</p>
      </div>
    </>
  );
  const className = 'card p-4 flex items-start gap-3 hover:shadow-md transition-shadow';
  return externo ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{contenido}</a>
  ) : (
    <Link href={href} className={className}>{contenido}</Link>
  );
}

/**
 * Integraciones — a diferencia de WhatsApp Infra y Conocimiento/RAG, esta
 * página SÍ tiene mucho que enseñar de verdad: son conectores reales,
 * conectados hoy, verificables en código o en la cuenta del servicio. Los
 * proveedores de modelos no son una tarjeta genérica — se listan los
 * modelos reales que corrieron (`resumen.porModelo`, la misma fuente que
 * usa Inicio), porque eso es lo único honesto que se puede decir de un
 * "proveedor de LLM": no cuáles se PODRÍAN usar, sino cuáles YA se usaron.
 */
export default async function IntegracionesPage() {
  const r = await getResumenNegocio();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Blocks width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Integraciones</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Los servicios reales de los que depende Likida hoy, y para qué se usa cada uno</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Conectores activos</TituloSeccion>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Conector
              Icono={Database} titulo="Supabase" href="https://supabase.com/dashboard"
              subtitulo="Postgres + Auth + RLS — la base de datos y el login de toda la app."
            />
            <Conector
              Icono={Mail} titulo="Resend" href="https://resend.com/emails"
              subtitulo="Correo transaccional — los magic-links de inicio de sesión."
            />
            <Conector
              Icono={Bug} titulo="Sentry" href="https://sentry.io"
              subtitulo="Registro de errores en producción. Ya enlazado también desde Inicio."
            />
            <Conector
              Icono={Rocket} titulo="Vercel" href="https://vercel.com/dashboard"
              subtitulo="Hosting y despliegues. Ya enlazado también desde Inicio."
            />
            <Conector
              Icono={Smartphone} titulo="Meta WhatsApp Business API" href="/admin/whatsapp-infra" externo={false}
              subtitulo="1 número operativo — atiende de punta a punta la conversación del bot."
            />
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Proveedores de modelos (LLM)</TituloSeccion>
          <p className="text-xs mt-2 mb-3" style={{ color: 'var(--muted)' }}>
            No un conector genérico — los modelos reales que corrieron OCR y Cuadre, tal como quedaron
            registrados en <code className="font-mono">llm_costo</code>.
          </p>
          {r.porModelo.length === 0 ? (
            <div className="card p-4 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
          ) : (
            <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
              {r.porModelo.map((m) => (
                <div key={m.modelo} className="px-4 py-3 flex items-center gap-3">
                  <IconoProveedor modelo={m.modelo} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-mono truncate">{m.modelo}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                  </div>
                  <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Rotación de API keys</TituloSeccion>
          <div className="card p-4 mt-3">
            <div className="flex items-start gap-3">
              <Insignia Icono={KeyRound} />
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                Rotación de API keys — Fase 5 del roadmap. Hoy las llaves de cada servicio viven en variables de
                entorno de Vercel, sin una UI de administración ni rotación automática dentro de este panel.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
