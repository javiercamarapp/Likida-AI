// Humo del analista (llamada real) — NO CI. Dump completo del error.
import { ejecutarAnalista } from '../src/lib/agents/analista';
const DEMO = '11111111-1111-1111-1111-111111111111';
async function main() {
  try {
    const r = await ejecutarAnalista({ tenantId: DEMO, nombreFlota: 'FLOTA DEMO SA DE CV', mensajes: [{ rol: 'usuario', texto: '¿Cómo va mi operación en general?' }] });
    console.log(`modelo=${r.modelo} costo=$${r.costoUsd.toFixed(5)} in/out=${r.tokensIn}/${r.tokensOut} tools=[${r.toolsUsadas.join(',')}]`);
    for (const b of r.bloques) console.log('  ', JSON.stringify(b).slice(0, 300));
  } catch (e) {
    const err = e as { cause?: { error?: { metadata?: unknown } } };
    console.error('FALLO METADATA:', JSON.stringify(err?.cause ?? e, null, 2).slice(0, 1500));
  }
}
main().then(() => process.exit(0));
