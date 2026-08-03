'use client';

import { useEffect, useState } from 'react';

/** Un dígito: tablero fijo con el valor actual + una "hoja" que gira
 *  (rotateX) mostrando el valor ANTERIOR cayendo hacia adelante, al
 *  estilo reloj/contador de tarjetas plegables (Solari) — cuando el
 *  dígito cambia, la hoja se monta, gira 420ms y se desmonta, dejando
 *  ver el tablero de abajo (que ya tiene el valor nuevo desde el primer
 *  render). Un solo @keyframes en globals.css, sin librería nueva. */
function Digito({ valor, tamaño }: { valor: string; tamaño: 'md' | 'lg' }) {
  const [mostrado, setMostrado] = useState(valor);
  const [valorPrevio, setValorPrevio] = useState(valor);
  const [anterior, setAnterior] = useState<string | null>(null);

  // Ajustar estado derivado de un cambio de prop se hace EN el render (el
  // patrón que React recomienda para esto), no en un efecto — el efecto de
  // abajo solo se encarga de la parte que sí es un timer externo: quitar
  // la hoja 420ms después de que terminó de girar.
  if (valor !== valorPrevio) {
    setAnterior(mostrado);
    setMostrado(valor);
    setValorPrevio(valor);
  }

  useEffect(() => {
    if (anterior === null) return;
    const t = setTimeout(() => setAnterior(null), 420);
    return () => clearTimeout(t);
  }, [anterior]);

  const dims = tamaño === 'lg' ? { w: 33, h: 45, font: 29, radio: 7 } : { w: 20, h: 27, font: 18, radio: 5 };
  const base: React.CSSProperties = {
    fontSize: dims.font,
    fontFamily: 'var(--font-sans)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    color: '#f2f2f0',
  };

  return (
    <div className="relative" style={{ width: dims.w, height: dims.h, borderRadius: dims.radio, background: 'linear-gradient(180deg, #262626, #141414)', perspective: dims.h * 5.5 }}>
      <span className="absolute inset-0 flex items-center justify-center" style={base}>{mostrado}</span>
      <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'rgba(0,0,0,0.5)' }} />
      {anterior !== null && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ ...base, borderRadius: dims.radio, background: 'linear-gradient(180deg, #2b2b2b, #161616)', transformOrigin: 'center', animation: 'reloj-flip 420ms cubic-bezier(0.4,0,0.2,1) forwards' }}
        >
          {anterior}
        </div>
      )}
    </div>
  );
}

/**
 * Contador retro de tarjetas plegables (estilo reloj Solari) — reutilizable
 * en cualquier página donde haya un total real que valga la pena revelar
 * así: MRR en Inicio, facturas históricas en Agente OCR, flotas dadas de
 * alta en Flotas. "Animado" es honesto: al montar cuenta desde 0 hasta
 * `valor` con la misma hoja plegable — una revelación de un número real,
 * nunca un tic inventado.
 */
export default function ContadorRetro({
  valor, digitos = 4, prefijo, etiqueta, tamaño = 'md',
}: {
  valor: number;
  digitos?: number;
  prefijo?: string;
  etiqueta: string;
  tamaño?: 'md' | 'lg';
}) {
  const [mostrado, setMostrado] = useState(0);

  useEffect(() => {
    if (valor <= 0) return; // ya arranca en 0 (useState(0))
    const pasos = Math.min(valor, 30);
    const incremento = Math.max(1, Math.round(valor / pasos));
    let actual = 0;
    const id = setInterval(() => {
      actual = Math.min(valor, actual + incremento);
      setMostrado(actual);
      if (actual >= valor) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [valor]);

  const cifras = String(mostrado).padStart(digitos, '0').split('');

  return (
    <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
      <div className="flex items-center gap-1.5">
        {prefijo && <span className="font-bold" style={{ fontSize: tamaño === 'lg' ? 23 : 16, color: 'var(--muted)' }}>{prefijo}</span>}
        {cifras.map((d, i) => <Digito key={i} valor={d} tamaño={tamaño} />)}
      </div>
      <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {etiqueta}
      </span>
    </div>
  );
}
