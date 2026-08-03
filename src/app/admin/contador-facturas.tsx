'use client';

import { useEffect, useState } from 'react';

/** Un dígito: tablero fijo con el valor actual + una "hoja" que gira
 *  (rotateX) mostrando el valor ANTERIOR cayendo hacia adelante, al
 *  estilo reloj/contador de tarjetas plegables (Solari) — cuando el
 *  dígito cambia, la hoja se monta, gira 420ms y se desmonta, dejando
 *  ver el tablero de abajo (que ya tiene el valor nuevo desde el primer
 *  render). Un solo @keyframes en globals.css, sin librería nueva. */
function Digito({ valor }: { valor: string }) {
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

  const base: React.CSSProperties = {
    fontSize: 18,
    fontFamily: 'var(--font-sans)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    color: '#f2f2f0',
  };

  return (
    <div className="relative rounded-[5px]" style={{ width: 20, height: 27, background: 'linear-gradient(180deg, #262626, #141414)', perspective: 200 }}>
      <span className="absolute inset-0 flex items-center justify-center" style={base}>{mostrado}</span>
      <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'rgba(0,0,0,0.5)' }} />
      {anterior !== null && (
        <div
          className="absolute inset-0 rounded-[5px] flex items-center justify-center"
          style={{ ...base, background: 'linear-gradient(180deg, #2b2b2b, #161616)', transformOrigin: 'center', animation: 'reloj-flip 420ms cubic-bezier(0.4,0,0.2,1) forwards' }}
        >
          {anterior}
        </div>
      )}
    </div>
  );
}

/**
 * Contador retro de tarjetas plegables junto al saludo — muestra el total
 * HISTÓRICO real de facturas procesadas (`ResumenNegocio.facturasTotal`,
 * todas las filas de `gasto`, sin filtro de fecha). "Animado" no es un
 * tic falso: al montar, cuenta desde 0 hasta el total real con la misma
 * hoja plegable de un reloj Solari — una revelación honesta de un número
 * real, no un reloj inventando segundos que no representan nada del
 * negocio.
 */
export default function ContadorFacturas({ total }: { total: number }) {
  const [valor, setValor] = useState(0);

  useEffect(() => {
    if (total <= 0) return; // ya arranca en 0 (useState(0))
    const pasos = Math.min(total, 30); // si el total es grande, salta de más en más — no 4000 pasos de 1 en 1
    const incremento = Math.max(1, Math.round(total / pasos));
    let actual = 0;
    const id = setInterval(() => {
      actual = Math.min(total, actual + incremento);
      setValor(actual);
      if (actual >= total) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [total]);

  const digitos = String(valor).padStart(4, '0').split('');

  return (
    <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0">
      <div className="flex items-center gap-1">
        {digitos.map((d, i) => <Digito key={i} valor={d} />)}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        Facturas procesadas
      </span>
    </div>
  );
}
