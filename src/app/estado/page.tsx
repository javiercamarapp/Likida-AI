import type { Metadata } from 'next';
import { rico } from '@/lib/i18n/rico';
import { getT } from '@/lib/i18n/servidor';
import type { TrPublico } from '@/lib/i18n/publico_tr';
import { fechaHoraMx, numero } from '@/lib/formato';
import Link from 'next/link';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { headers } from 'next/headers';
import { cargarEstadoPublico, estadoMemoizado, type EstadoPublico } from './datos';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import type { EstadoMedido } from '@/lib/admin/salud';
import type { CeldaDia } from '@/lib/admin/estado';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('publico');
  return { title: t('est.meta.titulo'), description: t('est.meta.descripcion') };
}

// Pública y dinámica a propósito: el layout raíz ya llama `connection()` (CSP con nonce por petición, Ola 9b), así que
// esta página recibe el nonce igual que /seguridad. No lleva scripts propios ni estilos inyectados.
export const dynamic = 'force-dynamic';

/**
 * /estado (E4) — la página de estado PÚBLICA. REGLA DURA, igual que /seguridad: solo se afirma lo que se MIDE. Un día
 * sin medición se pinta «sin medición», nunca en verde; un componente sin medición reciente no se llama «operativo».
 * No lleva datos de flotas ni nombres de crons, versiones ni motivos de fallo: solo cinco componentes y tres estados.
 */

const ESTADO: Record<EstadoMedido | 'sin_medicion', { clases: string; fondo: string; texto: string }> = {
  ok: { clases: 'bg-[var(--okbg)] text-[var(--ok)]', fondo: 'bg-[var(--okbg)]', texto: 'text-[var(--ok)]' },
  degradado: { clases: 'bg-[var(--warnbg)] text-[var(--warn)]', fondo: 'bg-[var(--warnbg)]', texto: 'text-[var(--warn)]' },
  caido: { clases: 'bg-[var(--badbg)] text-[var(--bad)]', fondo: 'bg-[var(--badbg)]', texto: 'text-[var(--bad)]' },
  sin_medicion: { clases: 'bg-[var(--surface)] text-muted', fondo: 'bg-[var(--surface)]', texto: 'text-muted' },
};

const CELDA: Record<CeldaDia, { fondo: string }> = {
  ok: { fondo: 'bg-[var(--ok)]' },
  degradado: { fondo: 'bg-[var(--warn)]' },
  caido: { fondo: 'bg-[var(--bad)] ' },
  sin_medicion: { fondo: 'bg-[var(--line)] opacity-55' },
};

function resumenGeneral(e: EstadoPublico, t: TrPublico['t']): { titulo: string; estado: EstadoMedido | 'sin_medicion' } {
  const vistos = Object.values(e.actual).filter((v): v is EstadoMedido => v !== null);
  if (!e.reciente || vistos.length === 0) return { titulo: t('est.res.sin_medicion'), estado: 'sin_medicion' };
  if (vistos.includes('caido')) return { titulo: t('est.res.caido'), estado: 'caido' };
  if (vistos.includes('degradado')) return { titulo: t('est.res.degradado'), estado: 'degradado' };
  return { titulo: t('est.res.ok'), estado: 'ok' };
}

function Etiqueta({ estado, t }: { estado: EstadoMedido | 'sin_medicion'; t: TrPublico['t'] }) {
  const e = ESTADO[estado];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap ${e.clases}`}>
      {t(`est.e.${estado}`)}
    </span>
  );
}

function fechaLegible(iso: string, idioma: TrPublico['idioma']): string {
  return fechaHoraMx(iso, idioma);
}

/**
 * M3 (ronda 19): el mismo rate limit por IP que `/api/health` (30/min). Pasado el límite se sirve lo último memoizado SIN
 * tocar la base (o «no pudimos leer» si no hay nada). Falla ABIERTO si Redis no contesta: una página de estado que se
 * apaga porque el limitador cayó es justo la que se necesita en una caída.
 */
async function dentroDelLimite(): Promise<boolean> {
  try {
    const ip = clientIp(new Request('http://estado.local', { headers: await headers() }));
    return await rateLimit(`estado:${ip}`, 30, 60_000, { fallaCerrado: false });
  } catch {
    return true;
  }
}

export default async function PaginaEstado() {
  const { t, idioma } = await getT('publico');
  const estado = (await dentroDelLimite()) ? await cargarEstadoPublico().catch((): null => null) : estadoMemoizado();

  if (estado === null) {
    return (
      <MarcoPublico
        titulo={t('est.titulo')}
        apoyo={t('est.apoyo.error')}
      />
    );
  }

  const general = resumenGeneral(estado, t);
  return (
    <MarcoPublico
      ancho="lectura"
      rotulo={t('est.rotulo')}
      titulo={t('est.titulo')}
      apoyo={t('est.apoyo')}
    >
        <section aria-live="polite" className={`mt-8 flex items-center justify-between gap-4 rounded-xl px-5 py-4 ${ESTADO[general.estado].fondo}`}>
          <h2 className={`font-display text-[17px] font-semibold ${ESTADO[general.estado].texto}`}>{general.titulo}</h2>
          <Etiqueta estado={general.estado} t={t} />
        </section>
        <p className="mt-2 text-[12px] text-muted">
          {estado.latidoIlegible
            ? t('est.ult.ilegible')
            : estado.ultimaMedicion
              ? `${t('est.ult.fecha', { fecha: fechaLegible(estado.ultimaMedicion, idioma) })}${estado.reciente ? '' : t('est.ult.vieja')}`
              : t('est.ult.ninguna')}
        </p>

        <div className="mt-8 space-y-6">
          {estado.resumen.map((r) => {
            const actual = estado.actual[r.componente] ?? 'sin_medicion';
            const nombre = t(`est.c.${r.componente}.nombre`);
            return (
              <section key={r.componente} aria-labelledby={`c-${r.componente}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`c-${r.componente}`} className="font-display text-[16px] font-semibold">{nombre}</h2>
                  <Etiqueta estado={actual} t={t} />
                </div>
                <p className="mt-1 text-[13px] text-muted">{t(`est.c.${r.componente}.mide`)}</p>
                {/* 30 celdas, de la más antigua a hoy. Cada una dice su día y su estado en texto, no solo en color. */}
                <ul className="mt-3 flex gap-[3px]" aria-label={t('est.dias.aria', { nombre })}>
                  {r.dias.map((d) => (
                    <li
                      key={d.dia}
                      className={`h-7 flex-1 rounded-[3px] ${CELDA[d.celda].fondo}`}
                      title={`${d.dia}: ${t(`est.dia.${d.celda}`)}`}
                      aria-label={`${d.dia}: ${t(`est.dia.${d.celda}`)}`}
                    />
                  ))}
                </ul>
                <p className="mt-2 text-[12px] text-muted">
                  {estado.historialIlegible
                    ? t('est.hist.ilegible')
                    : r.disponibilidadPct === null
                      ? t('est.hist.sin')
                      : t('est.hist.disp', { pct: r.disponibilidadPct.toFixed(2), muestras: numero(r.muestras, idioma), dias: r.diasMedidos })}
                </p>
              </section>
            );
          })}
        </div>

        <p className="mt-10 text-[12px] leading-relaxed text-muted">
          {rico(t('est.como'), { enlace: (c) => <Link href="/seguridad" className="underline">{c}</Link> })}
        </p>
    </MarcoPublico>
  );
}
