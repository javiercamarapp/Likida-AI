// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS MANUAL — la bandeja de códigos pendientes contra la BASE REAL.
//
// Los tests de `npm test` cubren la lógica pura (a qué gasto pertenece un
// acercamiento). Lo que NO pueden ver es el mapeo a columnas: un `folio_portal`
// mal escrito typechea perfecto y falla en runtime. Esto hace el viaje redondo
// de verdad — guardar, leer, emparejar, reclamar — contra Postgres.
//
// NO entra en `npm test`: necesita credenciales y toca la base.
//
// Se limpia solo: el "reclamar" ES el borrado, y el finally barre si algo truena.
//
// USO
//   npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/bandeja.prueba.ts
// ═══════════════════════════════════════════════════════════════════════════

import { test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function cargarEnv(ruta: string): void {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, '');
    if (valor && !process.env[m[1]]) process.env[m[1]] = valor;
  }
}

// Un monto absurdo y con centavos irrepetibles: si algo queda huérfano en la
// tabla, se ve de inmediato que salió de aquí y no de un viaje real.
const MONTO_PRUEBA = 9999.37;

test('bandeja: guardar → leer → emparejar → reclamar', async () => {
  cargarEnv(resolve('.env.local'));
  expect(process.env.SUPABASE_SERVICE_ROLE_KEY, 'falta SUPABASE_SERVICE_ROLE_KEY').toBeTruthy();

  const { guardarCodigoPendiente, getCodigosPendientes, reclamarCodigoPendiente } =
    await import('@/lib/cuadra/repo');
  const { emparejarPendiente } = await import('@/lib/cuadra/intake/emparejar');
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  const { data: viajes } = await supabaseAdmin().from('viaje').select('id, tenant_id').limit(1);
  const viaje = viajes?.[0];
  if (!viaje) return console.log('\n⚠️  Sin viajes en la base: no hay dónde probar\n');
  const tenantId = viaje.tenant_id as string;
  const viajeId = viaje.id as string;

  let id: string | undefined;
  try {
    await guardarCodigoPendiente(tenantId, viajeId, {
      monto: MONTO_PRUEBA,
      folioPortal: '2026072500402011000207172POSA9',
      codigoBarras: 'T1131KH1131GQH74C1QJ3',
      urlFacturacion: 'https://facturacion.officedepot.com.mx/#/generaF/x/y',
    });

    const bandeja = await getCodigosPendientes(viajeId, tenantId);
    const mio = bandeja.find((c) => c.monto === MONTO_PRUEBA);
    id = mio?.id;
    console.log(`\nguardado    id=${mio?.id}`);
    console.log(`leído       monto=${mio?.monto}  folio=${mio?.folioPortal}`);
    console.log(`            barras=${mio?.codigoBarras}`);
    console.log(`            liga=${mio?.urlFacturacion?.slice(0, 50)}…`);

    // El mapeo de columnas: si `folio_portal` estuviera mal escrito, esto sería
    // undefined aunque el insert haya "funcionado".
    expect(mio?.folioPortal).toBe('2026072500402011000207172POSA9');
    expect(mio?.codigoBarras).toBe('T1131KH1131GQH74C1QJ3');
    expect(mio?.urlFacturacion).toContain('officedepot');

    // Emparejar por total, que es la única llave contra el ticket.
    expect(emparejarPendiente(MONTO_PRUEBA, bandeja)?.id).toBe(mio!.id);

    // El claim es atómico: el primero se lo lleva, el segundo se entera de que
    // llegó tarde. Es lo que evita que dos comprobantes del mismo total peguen
    // el mismo folio cuando la ráfaga corre en paralelo.
    expect(await reclamarCodigoPendiente(tenantId, mio!.id)).toBe(true);
    expect(await reclamarCodigoPendiente(tenantId, mio!.id)).toBe(false);
    id = undefined;
    console.log('reclamado   1ª vez true, 2ª vez false (claim atómico) ✅');

    const despues = await getCodigosPendientes(viajeId, tenantId);
    expect(despues.find((c) => c.monto === MONTO_PRUEBA)).toBeUndefined();
    console.log('bandeja     vacía tras reclamar ✅\n');
  } finally {
    if (id) await supabaseAdmin().from('codigo_pendiente').delete().eq('id', id);
  }
}, 120_000);
