// Humo del análisis de archivo adjunto (llamada real de pago) — NO CI.
import { leerArchivoUniversal } from '../src/lib/likida/intake/archivo';
import { ejecutarAnalista } from '../src/lib/agents/analista';

async function main() {
  const csv = 'ruta,concepto,monto\nSilao-Monterrey,diésel,8340.50\nSilao-Monterrey,casetas,1240\nCDMX-Guadalajara,diésel,6120\nCDMX-Guadalajara,viáticos,900\n';
  const leido = await leerArchivoUniversal('gastos-semana.csv', Buffer.from(csv));
  console.log('extracto:', leido.extracto.slice(0, 200));
  const t0 = Date.now();
  const r = await ejecutarAnalista({
    tenantId: '11111111-1111-1111-1111-111111111111', nombreFlota: 'FLOTA DEMO SA DE CV',
    usuario: { nombre: 'Javier', rol: 'flota_admin' },
    documento: { nombre: 'gastos-semana.csv', extracto: leido.extracto },
    mensajes: [{ rol: 'usuario', texto: '¿Qué ves en mi archivo? Dame una tabla del gasto por ruta y dime cuál pesa más.' }],
  });
  console.log(`⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s costo=$${r.costoUsd.toFixed(5)} tools=[${r.toolsUsadas.join(',')}]`);
  for (const b of r.bloques) console.log('  ', JSON.stringify(b).slice(0, 300));
}
main().then(() => process.exit(0)).catch((e) => { console.error('FALLO', e); process.exit(1); });
