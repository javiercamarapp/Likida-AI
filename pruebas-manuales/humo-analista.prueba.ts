// Humo del analista (llamada real) — NO CI.
import { ejecutarAnalista } from '../src/lib/agents/analista';
const DEMO = '11111111-1111-1111-1111-111111111111';
async function main() {
  for (const q of ['hola', '¿qué puede hacer Likida por mí?', '¿Cómo va mi operación en general?']) {
    console.log('\n═══', q);
    const r = await ejecutarAnalista({ tenantId: DEMO, nombreFlota: 'FLOTA DEMO SA DE CV', mensajes: [{ rol: 'usuario', texto: q }] });
    console.log(`modelo=${r.modelo} costo=$${r.costoUsd.toFixed(5)} tools=[${r.toolsUsadas.join(',')}]`);
    for (const b of r.bloques) console.log('  ', JSON.stringify(b).slice(0, 260));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FALLO', e); process.exit(1); });
