import Link from 'next/link';
import { ListChecks, Check, CircleHelp } from 'lucide-react';
import { numero } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import type { PasoMarcha, GrupoPaso, ResumenMarcha } from '@/lib/likida/puesta_en_marcha';
import { AUTOMATIZACIONES } from '../rutas';

const GRUPOS: Array<{ id: GrupoPaso; titulo: string; nota: string }> = [
  { id: 'flota', titulo: 'Tu flota y su cuenta', nota: 'Lo que Likida necesita saber de tu empresa antes de hablar con tus choferes.' },
  { id: 'gente', titulo: 'Tu gente y tus camiones', nota: 'Operadores, unidades, patios y quién los corrige.' },
  { id: 'operacion', titulo: 'Tu primera operación', nota: 'El ciclo completo: viaje, ticket por WhatsApp y liquidación.' },
];

/**
 * LA PUESTA EN MARCHA (W2 «producto»): el checklist guiado de punta a punta. Cada
 * paso sale de una señal REAL del tenant (`puesta_en_marcha.ts`); uno cuya señal no
 * se pudo leer dice «no pude comprobarlo» — nunca un palomeo ni un pendiente
 * inventados.
 */
export function VistaPuestaEnMarcha({ pasos, resumen, puedeAdministrar, hrefAutomatizacion }: {
  pasos: PasoMarcha[];
  resumen: ResumenMarcha;
  /** El dueño hace los pasos de configuración; al jefe se le muestran sin botón. */
  puedeAdministrar: boolean;
  /** Por cada automatización: su href (con sufijo) o null si el rol no la ve. */
  hrefAutomatizacion: Record<string, string | null>;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ListChecks width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Puesta en marcha"
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          <section className="card p-4" aria-labelledby="titulo-avance">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="titulo-avance" className="font-display text-[15px] font-semibold">
                {resumen.completo ? 'Tu flota está lista para operar' : 'Lo que falta para operar sin ayuda'}
              </h2>
              <span className="etiqueta-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                {numero(resumen.hechos)} de {numero(resumen.total)} pasos
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--canvas)' }}
              role="progressbar" aria-valuemin={0} aria-valuemax={resumen.total} aria-valuenow={resumen.hechos} aria-label="Avance de la puesta en marcha">
              <div className="h-full rounded-full" style={{ width: `${resumen.total === 0 ? 0 : (resumen.hechos / resumen.total) * 100}%`, background: 'var(--marca)' }} />
            </div>
            {resumen.hayDatoFaltante && (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--warn)' }}>
                Algunos pasos no se pudieron comprobar en este momento: el avance de arriba es un mínimo, no una medida.
              </p>
            )}
            {resumen.siguiente && (
              <p className="mt-3 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Siguiente: <strong style={{ color: 'var(--ink)' }}>{resumen.siguiente.titulo}</strong>
                {(puedeAdministrar || !resumen.siguiente.soloDueno) && (
                  <> — <Link href={resumen.siguiente.href} className="underline">{resumen.siguiente.cta}</Link></>
                )}
              </p>
            )}
          </section>

          {GRUPOS.map((g) => (
            <section key={g.id} className="card p-4" aria-labelledby={`grupo-${g.id}`}>
              <h2 id={`grupo-${g.id}`} className="font-display text-[15px] font-semibold">{g.titulo}</h2>
              <p className="mb-3 text-[12px]" style={{ color: 'var(--muted)' }}>{g.nota}</p>
              <ol className="space-y-3">
                {pasos.filter((p) => p.grupo === g.id).map((p) => <Paso key={p.id} p={p} puedeAdministrar={puedeAdministrar} />)}
              </ol>
            </section>
          ))}

          <section className="card p-4" aria-labelledby="titulo-agentes">
            <h2 id="titulo-agentes" className="font-display text-[15px] font-semibold">Las automatizaciones que trabajan con lo que cargaste</h2>
            <p className="mb-3 text-[12px]" style={{ color: 'var(--muted)' }}>
              Cada una se activa en tu cuenta con Likida y arranca con tus operadores, unidades y política. Aquí puedes ver su pantalla.
            </p>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {AUTOMATIZACIONES.map((a) => {
                const href = hrefAutomatizacion[a.href];
                return (
                  <li key={a.href} className="text-[12.5px]">
                    {href ? <Link href={href} className="underline">{a.nombre}</Link> : <span style={{ color: 'var(--muted)' }}>{a.nombre}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

function Paso({ p, puedeAdministrar }: { p: PasoMarcha; puedeAdministrar: boolean }) {
  const hecho = p.estado === 'hecho';
  const sinDato = p.estado === 'sin_dato';
  const puedeActuar = puedeAdministrar || !p.soloDueno;
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
        style={hecho
          ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
          : sinDato ? { border: '1px dashed var(--warn)', color: 'var(--warn)' }
            : { border: '1px solid var(--line)', color: 'var(--muted)' }}>
        {hecho ? <Check width={12} height={12} strokeWidth={2.5} /> : sinDato ? <CircleHelp width={12} height={12} strokeWidth={2} /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium" style={{ color: hecho ? 'var(--muted)' : 'var(--ink)' }}>
          {p.titulo}
          {p.opcional && <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--faint)' }}>(opcional)</span>}
          <span className="sr-only">{hecho ? ' — hecho' : sinDato ? ' — no se pudo comprobar' : ' — pendiente'}</span>
        </p>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {sinDato ? 'No pude comprobarlo en este momento. ' : ''}{p.detalle}
        </p>
      </div>
      {!hecho && (
        puedeActuar ? (
          <Link href={p.href}
            className="hairline shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)]"
            style={{ color: 'var(--ink2)' }}>
            {p.cta}
          </Link>
        ) : (
          <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--faint)' }}>Lo hace quien administra</span>
        )
      )}
    </li>
  );
}
