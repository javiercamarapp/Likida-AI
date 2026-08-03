import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/utils';
import Link from 'next/link';
import ChatNegocio from './chat';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

export default async function Admin() {
  const { nombre } = await requireSuperadmin();
  const r = await getResumenNegocio();

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-6xl mx-auto px-8 h-16 flex items-center justify-between">
          <h1 className="flex items-center gap-3 m-0 font-normal">
            <span className="font-semibold tracking-tight text-xl">Likida</span>
            <span className="text-base" style={{ color: 'var(--muted)' }}>· Consola de negocio</span>
          </h1>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm px-3 py-1.5 rounded-lg hairline hover:opacity-70">
              Ver panel de flota (demo)
            </Link>
            <Link href="/cuenta" className="text-sm px-3 py-1.5 rounded-lg hairline hover:opacity-70">
              Mi cuenta
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10 space-y-10">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Hola, {nombre ?? 'Javier'}</h2>
          <p className="text-base mt-1" style={{ color: 'var(--muted)' }}>
            Esto es tuyo — un cliente nunca ve esta pantalla.
          </p>
        </div>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Likida en números
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{r.tenants}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
                {r.tenants <= 1 ? 'Flota (todavía solo el demo)' : 'Flotas'}
              </div>
            </div>
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Gastado en IA (total)</div>
            </div>
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{numero(r.tokensIn + r.tokensOut)}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Tokens usados</div>
            </div>
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{r.viajesProcesados}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
            </div>
          </div>
          {r.tenants <= 1 && (
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Estas cifras son reales, no de ejemplo — Likida todavía no tiene clientes, así que son bajas a propósito.
            </p>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Agentes — costo por fase
          </h3>
          {r.porFase.length === 0 ? (
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>
              Todavía no hay actividad de IA registrada.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {r.porFase.map((f) => (
                <div key={f.fase} className="card p-6">
                  <div className="text-base font-medium">{FASE_LABEL[f.fase] ?? f.fase}</div>
                  <div className="text-2xl font-semibold tracking-tight tabular mt-2">{usd(f.costoUsd)}</div>
                  <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{f.n} llamadas</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <ChatNegocio resumen={r} />
        </section>
      </main>
    </div>
  );
}
