import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, ALTO (A23): `acotada` se exportó "para que cualquier archivo
// lo importe", y cinco consultas nuevas del camino caliente (wa_pendientes,
// 16-ago) nacieron sin él — 300 000ms de undici contra un maxDuration de 120.
// No había regla que lo exigiera, a diferencia de `toLocaleString('es-MX')`,
// que sí tiene su prueba guardiana. Esta es la de `acotada`.
//
// La regla es simple y se puede leer: en estos archivos, cada `.from(` /
// `.rpc(` tiene su `acotada(`. Si añades una consulta, envuélvela.
// ═══════════════════════════════════════════════════════════════════════════
const GUARDADOS = [
  'src/lib/likida/wa_pendientes.ts',
  'src/lib/likida/avisar_cierre.ts',
  'src/lib/likida/conv.ts',
  // Los tres que A23 señaló y el primer arreglo dejó fuera: la lectura del
  // kill switch (primera línea del `after()`), el teléfono del jefe (en el
  // cierre) y la respuesta al chofer (dentro del presupuesto del webhook).
  'src/lib/likida/interruptores.ts',
  'src/lib/likida/contactos.ts',
  'src/lib/likida/consulta_chofer.ts',
  // ESCALA 50k (22-ago-2026, regla 5 de docs/escala-50k/REGLAS-ESCALA.md):
  // lo que queda en JS de la consola de superadmin también lleva techo. Un
  // `Promise.all` de dieciséis lecturas sin techo colgado en una es toda la
  // página en blanco. OJO: `Array.from(` cuenta como `.from(` para esta
  // regex — en estos archivos se usa `[...x].map` a propósito.
  'src/lib/admin/negocio.ts',
  'src/lib/admin/capacidad.ts',
  'src/lib/admin/corridas-cruzadas.ts',
  // ESCALA 50k (regla 5, 22-ago-2026): lo que queda del dashboard en JS va
  // envuelto en `acotada()`. El registro de viajes (RPC keyset + conteos).
  'src/lib/likida/viajes_registro.ts',
  // Escala 50k (mig. 0151): el panel fiscal lee UNA RPC de celdas agregadas;
  // cualquier lectura que quede en el archivo lleva techo.
  'src/lib/likida/fiscal.ts',
  // ESCALA 50k (REGLAS-ESCALA §5, 22-ago-2026): toda lectura del dashboard
  // que siga en JS lleva techo. Ojo: `Array.from(` también cuenta como
  // `.from(` aquí — analytics.ts lo evita a propósito.
  'src/lib/likida/analytics.ts',
  // ── ESCALA 50k (mig. 0152) ────────────────────────────────────────────
  // Los cuatro módulos del lado del ingreso y del encargado. No están en el
  // camino caliente del webhook, pero sí en el de las PANTALLAS: una consulta
  // sin techo cuelga la carga del panel hasta el timeout de la plataforma, y
  // el usuario ve una página en blanco en vez de una sección caída. Cada
  // `.from(`/`.rpc(` de aquí va envuelto en `acotada(`.
  'src/lib/likida/comercial.ts',
  'src/lib/likida/clientes.ts',
  'src/lib/likida/facturacion_clientes.ts',
  'src/lib/likida/operacion.ts',
];

describe('toda consulta de los módulos del camino caliente lleva techo', () => {
  it.each(GUARDADOS)('%s', (archivo) => {
    const fuente = readFileSync(archivo, 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const consultas = (fuente.match(/\.(from|rpc)\(/g) ?? []).length;
    const acotadas = (fuente.match(/\bacotada\(/g) ?? []).length;
    expect(consultas, 'control: el archivo sí consulta la base').toBeGreaterThan(0);
    expect(acotadas, `${archivo}: ${consultas} consultas y ${acotadas} acotada( — hay una sin techo`).toBe(consultas);
  });
});
