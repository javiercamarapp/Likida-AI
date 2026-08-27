// ═══════════════════════════════════════════════════════════════════════════
// LA CALCULADORA DE RECUPERACIÓN FISCAL — página pública (A2, lead magnet).
//
// El resultado se enseña ANTES de pedir el contacto (regla anti-abandono del
// blueprint); el contacto es opcional y va a `prospecto` con fuente
// 'landing'. El motor es puro y corre en el navegador — aquí no hay ningún
// dato de nadie hasta que el visitante decide dejarlo.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { Calculadora } from './calc';
import { PulsoSitio } from './pulso';

export const metadata: Metadata = {
  title: 'Calculadora de recuperación fiscal — Likida',
  description:
    'Cuánto estás dejando ir en el 50% de peajes y el estímulo IEPS de diésel. Con los supuestos a la vista y la advertencia que otros omiten: el estímulo es ingreso acumulable.',
};

export default function PaginaCalculadora() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
      <PulsoSitio pagina="calculadora" />
      <header className="pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider">Calculadora de recuperación fiscal</p>
        <h1 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Likida</h1>
        <p className="mt-3 text-sm">
          Tres datos que tu flota sí tiene a la mano. El resultado sale aquí mismo, con cada supuesto junto a su cifra
          y la advertencia que casi todos omiten. Sin RFC, sin registro.
        </p>
      </header>
      <Calculadora />
    </main>
  );
}
