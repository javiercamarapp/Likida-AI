import Link from 'next/link';
import { Check, MessageCircle } from 'lucide-react';
import type { PrimerosPasos } from '@/lib/likida/primeros-pasos';

/**
 * LA GUÍA DE LA PRIMERA LIQUIDACIÓN (auditoría 5, 17-ago-2026).
 *
 * North star de onboarding: "un administrador nuevo completa su primera
 * liquidación sin llamada de soporte". Cuatro pasos que se palomean SOLOS
 * con señales reales del tenant (`getPrimerosPasos`) — nunca un check de
 * cortesía. Se pinta únicamente mientras no exista la primera liquidación;
 * después estorba y desaparece.
 */
export function PrimeraLiquidacion({ datos, sufijo = '' }: { datos: PrimerosPasos; sufijo?: string }) {
  if (datos.completado) return null;
  const pasos: Array<{ hecho: boolean; titulo: string; detalle: string; href: string; cta: string }> = [
    {
      hecho: datos.operadores > 0,
      titulo: 'Da de alta a tu primer operador',
      detalle: 'Nombre y teléfono — con eso Likida ya sabe de quién es cada comprobante.',
      href: '/dashboard/operadores', cta: 'Ir a Operadores',
    },
    {
      hecho: datos.viajes > 0,
      titulo: 'Crea un viaje con su anticipo',
      detalle: 'Ruta, operador y anticipo. El viaje es la carpeta donde cae todo lo demás.',
      href: '/dashboard/despacho', cta: 'Crear viaje',
    },
    {
      hecho: datos.comprobantes > 0,
      titulo: 'Que el operador mande una foto del ticket por WhatsApp',
      detalle: 'Una foto real desde su teléfono — Likida la lee, la clasifica y la cuelga del viaje.',
      href: '/dashboard/soporte', cta: 'Cómo conectar WhatsApp',
    },
    {
      hecho: datos.liquidaciones > 0,
      titulo: 'Cierra la liquidación',
      detalle: 'El motor cuadra gastos contra anticipo y política; tú revisas solo las excepciones.',
      href: '/dashboard/agentes/liquidacion', cta: 'Ver liquidación',
    },
  ];
  const hechos = pasos.filter((p) => p.hecho).length;
  return (
    <section className="hairline rounded-2xl p-5 mb-4" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Tu primera liquidación</h2>
        <span className="etiqueta-mono text-[11px]" style={{ color: 'var(--muted)' }}>{hechos} de {pasos.length}</span>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--muted)' }}>
        Así se aprende Likida: no con un manual, con un viaje real. Cada paso se palomea solo cuando de verdad sucede.
      </p>
      <ol className="space-y-2.5">
        {pasos.map((p, i) => (
          <li key={p.titulo} className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
              style={p.hecho
                ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
                : { border: '1px solid var(--line)', color: 'var(--muted)' }}>
              {p.hecho ? <Check width={12} height={12} strokeWidth={2.5} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium" style={{ color: p.hecho ? 'var(--muted)' : 'var(--ink)', textDecoration: p.hecho ? 'line-through' : undefined }}>
                {p.titulo}
              </p>
              {!p.hecho && <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>{p.detalle}</p>}
            </div>
            {!p.hecho && (
              <Link href={`${p.href}${sufijo}`}
                className="shrink-0 text-[12px] font-medium px-2.5 py-1 rounded-lg hairline transition-colors hover:bg-[var(--canvas)]"
                style={{ color: 'var(--ink2)' }}>
                {p.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[11.5px] mt-4 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
        <MessageCircle width={13} height={13} strokeWidth={1.75} />
        ¿Prefieres preguntar? El chat de tus datos te lleva de la mano — y por WhatsApp también.
      </p>
    </section>
  );
}
