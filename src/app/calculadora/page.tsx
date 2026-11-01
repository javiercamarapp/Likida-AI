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
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';

export const metadata: Metadata = {
  title: 'Calculadora de recuperación fiscal — Likida',
  description:
    'Cuánto estás dejando ir en el 50% de peajes y el estímulo IEPS de diésel. Con los supuestos a la vista y la advertencia que otros omiten: el estímulo es ingreso acumulable.',
};

export default function PaginaCalculadora() {
  return (
    <MarcoPublico
      rotulo="Calculadora de recuperación fiscal"
      titulo="Likida"
      apoyo="Tres datos que tu flota sí tiene a la mano. El resultado sale aquí mismo, con cada supuesto junto a su cifra y la advertencia que casi todos omiten. Sin RFC, sin registro."
    >
      <PulsoSitio pagina="calculadora" />
      <div className="rv-pub__prosa">
        <Calculadora />
      </div>
    </MarcoPublico>
  );
}
