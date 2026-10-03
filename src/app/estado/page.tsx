import type { Metadata } from 'next';
import { fechaHoraMx, numero } from '@/lib/formato';
import Link from 'next/link';
import { headers } from 'next/headers';
import { cargarEstadoPublico, estadoMemoizado, type EstadoPublico } from './datos';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import type { ComponenteEstado, EstadoMedido } from '@/lib/admin/salud';
import type { CeldaDia } from '@/lib/admin/estado';

export const metadata: Metadata = {
  title: 'Estado — Likida',
  description: 'Estado medido de los componentes de Likida y su disponibilidad de los últimos 30 días.',
};

// Pública y dinámica a propósito: el layout raíz ya llama `connection()` (CSP con nonce por petición, Ola 9b), así que
// esta página recibe el nonce igual que /seguridad. No lleva scripts propios ni estilos inyectados.
export const dynamic = 'force-dynamic';

/**
 * /estado (E4) — la página de estado PÚBLICA. REGLA DURA, igual que /seguridad: solo se afirma lo que se MIDE. Un día
 * sin medición se pinta «sin medición», nunca en verde; un componente sin medición reciente no se llama «operativo».
 * No lleva datos de flotas ni nombres de crons, versiones ni motivos de fallo: solo cinco componentes y tres estados.
 */

const COMPONENTES: Record<ComponenteEstado, { nombre: string; mide: string }> = {
  app: { nombre: 'Aplicación', mide: 'La aplicación responde por su dirección pública (la guardia le pregunta cada 5 minutos desde el servidor).' },
  base: { nombre: 'Base de datos', mide: 'Una consulta real a la base de datos de producción, desde la misma verificación.' },
  crons: { nombre: 'Procesos programados', mide: 'Los procesos de fondo (cobranza, facturación, avisos) corren a su hora y terminan bien.' },
  whatsapp: { nombre: 'WhatsApp', mide: 'Nuestra tubería de WhatsApp (recibir, procesar y enviar) está al día. No mide la red de Meta.' },
  correo: { nombre: 'Correo', mide: 'La tubería de envío de correo corre al día. No mide que el mensaje llegue al buzón del destinatario.' },
};

const ESTADO: Record<EstadoMedido | 'sin_medicion', { etiqueta: string; color: string; fondo: string }> = {
  ok: { etiqueta: 'Operativo', color: 'var(--ok, #137a38)', fondo: 'var(--okbg, #e7f5ec)' },
  degradado: { etiqueta: 'Degradado', color: 'var(--warn, #9a5c00)', fondo: 'var(--warnbg, #fbf3e0)' },
  caido: { etiqueta: 'Interrupción', color: 'var(--bad, #b91c1c)', fondo: 'var(--badbg, #fbeaea)' },
  sin_medicion: { etiqueta: 'Sin medición', color: 'var(--muted, #666)', fondo: 'var(--surface, #f3f3f3)' },
};

const CELDA: Record<CeldaDia, { color: string; texto: string }> = {
  ok: { color: 'var(--ok, #137a38)', texto: 'sin interrupciones medidas' },
  degradado: { color: 'var(--warn, #9a5c00)', texto: 'con degradación medida' },
  caido: { color: 'var(--bad, #b91c1c)', texto: 'con al menos una interrupción medida' },
  sin_medicion: { color: 'var(--line, #d4d4d4)', texto: 'sin medición' },
};

function resumenGeneral(e: EstadoPublico): { titulo: string; estado: EstadoMedido | 'sin_medicion' } {
  const vistos = Object.values(e.actual).filter((v): v is EstadoMedido => v !== null);
  if (!e.reciente || vistos.length === 0) return { titulo: 'Sin medición reciente', estado: 'sin_medicion' };
  if (vistos.includes('caido')) return { titulo: 'Hay una interrupción en curso', estado: 'caido' };
  if (vistos.includes('degradado')) return { titulo: 'Rendimiento degradado', estado: 'degradado' };
  return { titulo: 'Todos los componentes medidos operan con normalidad', estado: 'ok' };
}

function Etiqueta({ estado }: { estado: EstadoMedido | 'sin_medicion' }) {
  const e = ESTADO[estado];
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap" style={{ color: e.color, background: e.fondo }}>
      {e.etiqueta}
    </span>
  );
}

function fechaLegible(iso: string): string {
  return fechaHoraMx(iso);
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
  const estado = (await dentroDelLimite()) ? await cargarEstadoPublico().catch((): null => null) : estadoMemoizado();

  if (estado === null) {
    // Ni siquiera se pudo armar: se dice. No se pinta un verde por omisión.
    return (
      <main className="min-h-dvh px-6 py-16" style={{ background: 'var(--canvas, #fff)' }}>
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Estado de Likida</h1>
          <p className="mt-4 text-[15px]" style={{ color: 'var(--muted, #555)' }}>
            No pudimos leer las mediciones en este momento. Que esta página no cargue no significa que el servicio esté
            bien ni que esté mal: significa que no podemos decirlo desde aquí. Vuelve a intentar en unos minutos.
          </p>
        </div>
      </main>
    );
  }

  const general = resumenGeneral(estado);
  return (
    <main className="min-h-dvh px-6 py-16" style={{ background: 'var(--canvas, #fff)' }}>
      <div className="mx-auto max-w-3xl">
        <p className="etiqueta-mono text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted, #666)' }}>Estado</p>
        <h1 className="font-display text-3xl font-semibold mt-2 tracking-tight">Estado de Likida</h1>
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--muted, #555)' }}>
          Medido por nuestra propia guardia cada 5 minutos, desde el servidor. Solo lectura: esta página no tiene
          controles ni datos de clientes. Lo que no se mide, se dice.
        </p>

        <section aria-live="polite" className="mt-8 rounded-xl px-5 py-4 flex items-center justify-between gap-4" style={{ background: ESTADO[general.estado].fondo }}>
          <h2 className="font-display text-[17px] font-semibold" style={{ color: ESTADO[general.estado].color }}>{general.titulo}</h2>
          <Etiqueta estado={general.estado} />
        </section>
        <p className="mt-2 text-[12px]" style={{ color: 'var(--muted, #666)' }}>
          {estado.latidoIlegible
            ? 'No se pudo leer la última medición.'
            : estado.ultimaMedicion
              ? `Última medición: ${fechaLegible(estado.ultimaMedicion)} (hora de la Ciudad de México).${estado.reciente ? '' : ' Es anterior a 15 minutos: no se muestra como estado actual.'}`
              : 'Todavía no hay ninguna medición.'}
        </p>

        <div className="mt-8 space-y-6">
          {estado.resumen.map((r) => {
            const actual = estado.actual[r.componente] ?? 'sin_medicion';
            const info = COMPONENTES[r.componente];
            return (
              <section key={r.componente} aria-labelledby={`c-${r.componente}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`c-${r.componente}`} className="font-display text-[16px] font-semibold">{info.nombre}</h2>
                  <Etiqueta estado={actual} />
                </div>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--muted, #555)' }}>{info.mide}</p>
                {/* 30 celdas, de la más antigua a hoy. Cada una dice su día y su estado en texto, no solo en color. */}
                <ul className="mt-3 flex gap-[3px]" aria-label={`Últimos 30 días de ${info.nombre}`}>
                  {r.dias.map((d) => (
                    <li
                      key={d.dia}
                      className="h-7 flex-1 rounded-[3px]"
                      style={{ background: CELDA[d.celda].color, opacity: d.celda === 'sin_medicion' ? 0.55 : 1 }}
                      title={`${d.dia}: ${CELDA[d.celda].texto}`}
                      aria-label={`${d.dia}: ${CELDA[d.celda].texto}`}
                    />
                  ))}
                </ul>
                <p className="mt-2 text-[12px]" style={{ color: 'var(--muted, #666)' }}>
                  {estado.historialIlegible
                    ? 'No se pudo leer el historial.'
                    : r.disponibilidadPct === null
                      ? 'Sin mediciones en los últimos 30 días.'
                      : `Disponibilidad medida: ${r.disponibilidadPct.toFixed(2)} % · ${numero(r.muestras)} mediciones en ${r.diasMedidos} de 30 días.`}
                </p>
              </section>
            );
          })}
        </div>

        <p className="mt-10 text-[12px] leading-relaxed" style={{ color: 'var(--muted, #666)' }}>
          Cómo leerlo: la disponibilidad es la proporción de mediciones sin interrupción; un día en gris no tiene
          mediciones (no cuenta como bueno ni como malo) y un día en rojo tuvo al menos una interrupción medida, aunque
          haya durado minutos. Si toda la plataforma cayera, esta página tampoco respondería. Más sobre cómo cuidamos
          tu información en <Link href="/seguridad" className="underline">Seguridad</Link>.
        </p>
      </div>
    </main>
  );
}
