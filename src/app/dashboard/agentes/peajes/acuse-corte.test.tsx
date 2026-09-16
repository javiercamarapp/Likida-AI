import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResumenBarrido } from '@/lib/likida/intake/consolidado';

// ═══════════════════════════════════════════════════════════════════════════
// REN-31C-C1 — EL ACUSE QUE DICE «NO HABÍA NADA» SOBRE UNA COLA DE 1,000.
//
// Lo creó el arreglo de REN-30-C1 (`54bddb2`) de esta misma continuación, y lo
// encontró el auditor de rendimiento al reauditar el rubro. Antes de ese
// commit, `revisadas` era el tamaño de la cola leída, así que `revisadas === 0`
// significaba de verdad «la cola está vacía». Con el reloj de corte,
// `revisadas` pasó a contar las líneas que SÍ se revisaron — y un corte que
// cae antes de la primera línea deja `revisadas = 0` con
// `cortadosPorReloj = 1,000`.
//
// Entra esto: flota con 1,000 líneas `por_conciliar`, el prólogo del barrido
// (lectura de la cola, del XML y del fondo de gastos) se come los 25 s del
// reloj, el corte cae antes de tocar la primera línea.
// Sale esto mal: el contralor aprieta «Ejecutar ahora» y la pantalla le dice
// «No había nada pendiente que barrer» sobre mil líneas sin conciliar.
//
// Es exactamente la regla que CLAUDE.md pone primero —un rótulo tiene que ser
// verdad— y por eso se arregla aquí en vez de quedar propuesta: un arreglo que
// deja una cifra falsa en la pantalla del comprador es peor que no haberlo
// hecho.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// `useActionState` es lo único que decide qué acuse se pinta: se sustituye por
// el estado que la prueba quiere ver, que es más barato y más directo que
// empujar una Server Action de mentira.
let estadoFingido: { error?: string; resumen?: ResumenBarrido } | null = null;
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useActionState: () => [estadoFingido, () => {}, false] };
});

const { BotonEjecutar } = await import('./controles');

function acuse(resumen: ResumenBarrido): string {
  estadoFingido = { resumen };
  return renderToStaticMarkup(
    <BotonEjecutar ejecutarAhora={async () => null} pendientes={resumen.revisadas + resumen.cortadosPorReloj} />,
  );
}

/**
 * La cifra tal como sale renderizada, con sus fronteras de etiqueta: el acuse
 * pinta cada número dentro de su propio `<span>`, así que `>1000<` distingue
 * la cifra impresa de un `1000` que apareciera en un nombre de clase.
 *
 * Antes esto quitaba las etiquetas con `/<[^>]+>/g` y comparaba texto pelado.
 * Se cambió por dos razones, y la segunda NO es la que parecía:
 *   · `toContain('3')` sobre texto pelado casa con cualquier 3 de la página
 *     —el de un `text-[12px]` incluido—, así que afirmaba menos de lo que
 *     aparentaba;
 *   · se investigó como candidato al rojo de CodeQL en este PR y **quedó
 *     descartado**: ese mismo patrón vive desde antes en `investigador.ts`,
 *     `respuesta_campana.ts` y `scripts/cosecha/*.mjs`, sobre corridas verdes.
 *     No es el hallazgo.
 */
const cifra = (n: number) => `>${n}<`;

const VACIA: ResumenBarrido = {
  revisadas: 0, conciliadas: 0, candidatosRefrescados: 0, siguenPendientes: 0, cortadosPorReloj: 0,
};

describe('acuse del barrido de peajes — el corte por reloj no se puede leer como cola vacía', () => {
  it('EL CASO: 0 revisadas porque el reloj cortó antes de la primera, y 1,000 fuera', () => {
    const texto = acuse({ ...VACIA, cortadosPorReloj: 1000 });
    expect(
      texto,
      'decirle «no había nada» a un contralor con mil líneas sin conciliar es la cifra inventada que el producto prohíbe',
    ).not.toContain('No había nada pendiente');
    expect(texto).toContain(cifra(1000));
  });

  it('con la cola de verdad vacía sigue diciéndolo tal cual', () => {
    expect(acuse(VACIA)).toContain('No había nada pendiente que barrer');
  });

  it('con corte a medias dice las dos mitades: lo revisado y lo que quedó fuera', () => {
    const texto = acuse({
      revisadas: 3, conciliadas: 1, candidatosRefrescados: 1, siguenPendientes: 2, cortadosPorReloj: 997,
    });
    expect(texto).toContain(cifra(3));
    expect(texto).toContain(cifra(997));
    expect(texto).not.toContain('No había nada pendiente');
  });
});

describe('la bitácora de corridas tampoco puede decir «ok» sobre un barrido cortado', () => {
  it('page.tsx deriva el estado de la corrida de `cortadosPorReloj`, no lo teclea', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/dashboard/agentes/peajes/page.tsx', 'utf8');
    // `tareasTotal: resumen.revisadas` con un corte reporta «0 de 0» y `ok`:
    // la corrida que dejó 1,000 líneas sin tocar queda archivada como sana.
    expect(src).toMatch(/estado:\s*resumen\.cortadosPorReloj\s*>\s*0\s*\?\s*'parcial'\s*:\s*'ok'/);
    expect(src).not.toMatch(/registrarCorrida\(tenantId, 'peajes', \{\s*\n\s*inicio,\s*\n\s*fin: new Date\(\),\s*\n\s*estado: 'ok',/);
  });
});
