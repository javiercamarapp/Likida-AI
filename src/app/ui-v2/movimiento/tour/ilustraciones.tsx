import type { ReactNode } from 'react';
import type { Ilu } from '@/app/ui-v2/onboarding/tipos';

// Ilustraciones del marco de la tarjeta: SVG en línea de 160 x 96, aria-hidden, líneas de 2 px, MONOCROMAS (tinta y grises;
// sin color de acento). El estado final es el que se ve sin animación: con «reducir movimiento» no se mueve nada.
// Clases: .ilu-l (línea gris), .ilu-a (línea de tinta), .ilu-f (relleno de superficie), .ilu-fa (relleno de tinta),
// .ilu-traza (se dibuja), .ilu-barra (crece), .ilu-pop (aparece), .ilu-entra (sube), .d1..d6 (escalonado).

const T = (d: string, extra = '') => <path className={`ilu-a ilu-traza ${extra}`} d={d} pathLength={1} />;

const DIBUJOS: Record<Ilu, ReactNode> = {
  barras: <>
    <path className="ilu-l" d="M24 80H136" />
    {[0, 1, 2, 3, 4].map((i) => <rect key={i} className={`ilu-fa ilu-barra d${i + 1}`} x={32 + i * 22} y={80 - [22, 38, 30, 50, 42][i]} width="12" height={[22, 38, 30, 50, 42][i]} rx="2" />)}
  </>,
  linea: <>
    <path className="ilu-l" d="M24 80H136M24 80V16" />
    {T('M28 66L50 52L72 58L96 34L120 40L134 22')}
    <circle className="ilu-fa ilu-pop d5" cx="134" cy="22" r="4" />
  </>,
  chat: <>
    <rect className="ilu-f ilu-entra d1" x="22" y="16" width="78" height="26" rx="8" />
    <path className="ilu-l" d="M34 26H84M34 33H70" />
    <rect className="ilu-fa ilu-entra d3" x="60" y="52" width="78" height="26" rx="8" />
    <path className="ilu-t" d="M72 62H122M72 69H104" />
  </>,
  nodos: <>
    <path className="ilu-l" d="M80 48L36 24M80 48L36 72M80 48L124 24M80 48L124 72" />
    <circle className="ilu-fa ilu-pop d1" cx="80" cy="48" r="9" />
    {[[36, 24], [36, 72], [124, 24], [124, 72]].map(([x, y], i) => <circle key={i} className={`ilu-f ilu-bordea ilu-pop d${i + 2}`} cx={x} cy={y} r="7" />)}
  </>,
  tarjetas: <>
    {[0, 1, 2].map((i) => <g key={i} className={`ilu-entra d${i + 1}`}><rect className="ilu-f" x={20 + i * 44} y={22 + (i % 2) * 8} width="38" height="52" rx="6" /><path className="ilu-l" d={`M${28 + i * 44} ${36 + (i % 2) * 8}H${52 + i * 44}M${28 + i * 44} ${44 + (i % 2) * 8}H${46 + i * 44}`} /></g>)}
  </>,
  escudo: <>
    {T('M80 14L116 26V50C116 68 100 80 80 86C60 80 44 68 44 50V26Z')}
    {T('M64 50L76 62L98 38', 'ilu-grueso')}
  </>,
  mapa: <>
    <path className="ilu-l" d="M26 20L58 12L102 24L134 14V76L102 86L58 74L26 82Z" />
    <path className="ilu-l" d="M58 12V74M102 24V86" />
    {T('M40 62C60 40 88 62 120 34')}
    <circle className="ilu-fa ilu-pop d4" cx="120" cy="34" r="4" />
  </>,
  importar: <>
    <rect className="ilu-f ilu-entra d1" x="50" y="40" width="60" height="40" rx="6" />
    {T('M80 12V48')}{T('M66 36L80 50L94 36')}
  </>,
  corte: <>
    <rect className="ilu-f" x="36" y="14" width="88" height="68" rx="8" />
    <path className="ilu-l" d="M48 32H112M48 44H112M48 56H88" />
    {T('M96 70L104 62L116 76')}
  </>,
  campana: <>
    {T('M80 18C64 18 56 30 56 44V58L48 68H112L104 58V44C104 30 96 18 80 18Z')}
    <path className="ilu-a" d="M72 76C73 82 87 82 88 76" />
    <circle className="ilu-fa ilu-pop d3" cx="100" cy="22" r="4" />
  </>,
  lista: <>
    {[0, 1, 2].map((i) => <g key={i} className={`ilu-entra d${i + 1}`}><rect className={i === 0 ? 'ilu-fa' : 'ilu-f'} x="32" y={20 + i * 22} width="12" height="12" rx="3" /><path className="ilu-l" d={`M54 ${26 + i * 22}H128`} /></g>)}
  </>,
  equipo: <>
    {[[56, 40], [104, 40], [80, 62]].map(([x, y], i) => <g key={i} className={`ilu-pop d${i + 1}`}><circle className="ilu-f ilu-bordea" cx={x} cy={y - 10} r="9" /><path className="ilu-a" d={`M${x - 14} ${y + 14}C${x - 12} ${y + 2} ${x + 12} ${y + 2} ${x + 14} ${y + 14}`} /></g>)}
  </>,
  panel: <>
    <rect className="ilu-f" x="24" y="14" width="112" height="68" rx="8" />
    <path className="ilu-l" d="M24 30H136M56 30V82" />
    <rect className="ilu-fa ilu-barra d2" x="68" y="58" width="10" height="16" rx="2" /><rect className="ilu-fa ilu-barra d3" x="84" y="48" width="10" height="26" rx="2" /><rect className="ilu-fa ilu-barra d4" x="100" y="40" width="10" height="34" rx="2" />
  </>,
  conectar: <>
    <rect className="ilu-f ilu-entra d1" x="16" y="30" width="44" height="36" rx="6" />
    <rect className="ilu-f ilu-entra d3" x="100" y="30" width="44" height="36" rx="6" />
    <path className="ilu-l" d="M26 44H50M26 52H42M110 44H134M110 52H126" />
    {T('M60 48H100')}
    <circle className="ilu-fa ilu-pop d5" cx="80" cy="48" r="5" />
  </>,
  documento: <>
    <path className="ilu-f ilu-entra d1" d="M52 12H100L116 28V84H52Z" />
    <path className="ilu-l" d="M100 12V28H116M62 44H106M62 54H106M62 64H90" />
    <circle className="ilu-fa ilu-pop d4" cx="108" cy="74" r="9" />
    <path className="ilu-t ilu-grueso" d="M103 74L107 78L114 70" />
  </>,
  correo: <>
    <rect className="ilu-f ilu-entra d1" x="30" y="24" width="100" height="56" rx="8" />
    {T('M32 28L80 58L128 28')}
    <path className="ilu-l" d="M30 78L64 50M130 78L96 50" />
    <circle className="ilu-fa ilu-pop d5" cx="122" cy="26" r="5" />
  </>,
  llave: <>
    <circle className="ilu-f ilu-bordea ilu-pop d1" cx="54" cy="48" r="18" />
    <circle className="ilu-fa ilu-pop d2" cx="54" cy="48" r="5" />
    {T('M72 48H128M110 48V62M122 48V58')}
  </>,
  celebrar: <>
    <circle className="ilu-f" cx="80" cy="50" r="28" />
    {T('M66 52L77 63L96 40', 'ilu-grueso')}
    <path className="ilu-l ilu-entra d3" d="M80 10V18M40 24L46 30M120 24L114 30M24 56H32M128 56H136" />
  </>,
  reloj: <>
    <circle className="ilu-f ilu-bordea" cx="80" cy="48" r="30" />
    {T('M80 28V48L94 56')}
    <circle className="ilu-fa ilu-pop d4" cx="80" cy="48" r="3" />
  </>,
  cierre: <>
    <circle className="ilu-f" cx="80" cy="48" r="30" />
    {T('M64 50L76 62L98 38', 'ilu-grueso')}
  </>,
};

export function Ilustracion({ nombre }: { nombre: string | undefined }) {
  const dibujo = DIBUJOS[(nombre ?? 'panel') as Ilu] ?? DIBUJOS.panel;
  return <svg className="rv-onb-ilu" viewBox="0 0 160 96" aria-hidden="true" focusable="false">{dibujo}</svg>;
}
export const NOMBRES_ILU = Object.keys(DIBUJOS) as Ilu[];
