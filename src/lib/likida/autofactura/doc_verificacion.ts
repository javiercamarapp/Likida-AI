import type { GuionPortal } from '../facturacion/adaptadores/guion';
import { COMERCIOS } from '../facturacion/comercios';
import { estadoVerificacion, type RegistroVerificaciones } from './verificacion';

// Renderiza docs/operacion/verificacion-portales.md DESDE el estado real (guiones + registro + manifiesto de fixtures):
// el runbook y la tabla de estado no pueden desincronizarse del código. `scripts/generar-doc-verificacion.ts` lo escribe y una
// prueba exige que el archivo del repo sea exactamente este render.

export interface ManifiestoFixtures { portales: Record<string, { origen?: string; grabado?: { fecha: string; archivo: string } }> }

const lista = (s: string | readonly string[]): string[] => (typeof s === 'string' ? [s] : [...s]);
const cod = (s: string) => `\`${s.replace(/`/g, "'").replace(/\|/g, '\\|')}\``;

export function renderizarDocVerificacion(guiones: readonly GuionPortal[], registro: RegistroVerificaciones, manifiesto: ManifiestoFixtures): string {
  const filas = guiones.map((g) => {
    const e = estadoVerificacion(g, registro);
    const m = manifiesto.portales[g.comercio];
    const ficha = COMERCIOS.find((c) => c.clave === g.comercio);
    return { g, e, m, ficha };
  });
  const verificados = filas.filter((f) => f.e.estado === 'verificado').length;

  const out: string[] = [];
  out.push('# Verificación de portales de autofactura (runbook)');
  out.push('');
  out.push('> Generado desde el código por `npx tsx scripts/generar-doc-verificacion.ts`. **No lo edites a mano**: una prueba falla si difiere del render.');
  out.push('');
  out.push('## Qué significa «verificado»');
  out.push('');
  out.push('Un portal solo emite CFDI si su guion está **verificado**, y eso solo lo dice una **corrida supervisada contra el portal real**. Hay dos señales independientes y la pantalla las muestra por separado:');
  out.push('');
  out.push('| Señal | La calcula | Qué prueba | Qué NO prueba |');
  out.push('|---|---|---|---|');
  out.push('| **Contrato** | las pruebas, en cada push (`autofactura/contrato_portales.test.ts`: motor real + Chromium + HTML fixture, sin red) | que la tabla de selectores es válida y que el motor llena, aprieta, lee el UUID y el rechazo, y falla cerrado ante portal caído o CAPTCHA | que el portal real sea así: los fixtures `sintetico_desde_guion` se derivan de la propia tabla |');
  out.push('| **Real** | `scripts/verificar-portal.mjs`, con confirmación humana | que los selectores del formulario en blanco existen EN EL PORTAL REAL (visita de solo lectura) | el botón de emitir en varios portales, el contenedor del UUID, el cuadro de error y el XML: solo aparecen al emitir. Por eso la **primera emisión real sigue supervisada** |');
  out.push('');
  out.push('Si alguien cambia un selector después de la corrida, la huella de la tabla ya no coincide y el portal pasa a **obsoleto** (vuelve a no emitir). Escribir `verificado` a mano en `portales.ts` no habilita nada.');
  out.push('');
  out.push(`**Estado hoy: ${verificados} de ${filas.length} guiones verificados contra el portal real.**`);
  out.push('');
  out.push('## Cómo se corre (una persona, una visita, solo lectura)');
  out.push('');
  out.push('```bash');
  out.push('npx tsx scripts/verificar-portal.mjs --listar');
  out.push('npx tsx scripts/verificar-portal.mjs <clave> --visita-real --yo "Nombre Apellido"');
  out.push('```');
  out.push('');
  out.push('1. Exige `--visita-real` y `--yo`, una terminal interactiva (no corre en CI ni redirigido) y que teclees la frase `VISITAR <CLAVE> EN EL PORTAL REAL`.');
  out.push('2. Abre UNA vez el portal con un Chromium real. **Toda petición que no sea GET/HEAD se aborta** (emitir es un POST). No resuelve CAPTCHA, no teclea nada, no envía formularios.');
  out.push('3. Deja evidencia en `pruebas-manuales/verificacion-portales/<clave>/<fecha>/` (`reporte.txt`, `captura.jpg`, `dom-saneado.html`).');
  out.push('4. Solo si NO hubo CAPTCHA y resolvieron todos los selectores del formulario en blanco, escribe la entrada en `src/lib/likida/facturacion/adaptadores/verificaciones.json` (huella de la tabla, sha256 del reporte, quién confirmó) y guarda el DOM saneado como fixture `grabado`.');
  out.push('5. **Revisa el diff antes de commitear**: el DOM saneado va a git (`sanearHtml` quita scripts, valores, tokens, correos y RFC, pero es la primera barrera, no la única).');
  out.push('6. Con el portal verificado, la emisión real sigue el flujo supervisado de `docs/operacion/agente-autofactura.md` (bandera por flota, límites, confirmación humana por lote).');
  out.push('');
  out.push('Si sale `no_graduar_selectores`, el reporte lista cuáles faltaron y el inventario real de la página: corrige los candidatos en `portales.ts`, regenera fixtures (`npx tsx scripts/generar-fixtures-portales.ts`) y vuelve a correr. Si sale `no_graduar_captcha`, ese portal va por vinculación asistida / modo asistido, no por emisión automática.');
  out.push('');
  out.push('## Estado por portal');
  out.push('');
  out.push('| Portal | Real (visita supervisada) | Contrato (fixture) | Sesión | Bloqueo del catálogo |');
  out.push('|---|---|---|---|---|');
  for (const { g, e, m, ficha } of filas) {
    const real = e.estado === 'verificado' ? `verificado ${e.entrada.fecha} (${e.entrada.nivel}, por ${e.entrada.confirmadoPor})` : e.estado === 'obsoleto' ? `OBSOLETO (se midió otra tabla el ${e.entrada.fecha})` : 'no verificado';
    const contrato = m?.grabado ? `grabado ${m.grabado.fecha} + ${m.origen ?? 'sintético'}` : (m?.origen ?? 'sin fixture');
    const bloqueo = ficha?.noAutomatizable ? `${ficha.noAutomatizable.razon}` : '—';
    out.push(`| ${ficha?.nombre ?? g.comercio} (\`${g.comercio}\`) | ${real} | ${contrato} | ${g.requiereSesion ? 'exige sesión vinculada' : 'sin cuenta'} | ${bloqueo} |`);
  }
  out.push('');
  out.push('## Ficha de verificación por portal');
  out.push('');
  out.push('Lo que hay que mirar en cada visita. «Apuestas» son los elementos que el formulario en blanco no puede confirmar.');
  out.push('');
  for (const { g, ficha } of filas) {
    out.push(`### ${ficha?.nombre ?? g.comercio} — \`${g.comercio}\``);
    out.push('');
    out.push(`- URL: ${g.portal}`);
    out.push(`- Datos fiscales de la flota que pide: ${Object.keys(g.receptor ?? {}).join(', ') || 'ninguno'}`);
    out.push(`- Campos del ticket: ${Object.keys(g.campos).join(', ') || 'ninguno'}`);
    if (g.buscar) out.push(`- Paso de búsqueda previo: ${g.buscar.que}`);
    out.push(`- Botón de emitir (apuesta): ${lista(g.botonEmitir).map(cod).join(' o ')}`);
    if (g.uuid) out.push(`- Contenedor del UUID (apuesta, solo se ve emitiendo): ${cod(g.uuid)}`);
    if (g.xml) out.push(`- XML: ${lista(g.xml.boton).map(cod).join(' o ')} (solo tras emitir)`);
    if (g.lecturaDeCampo) out.push(`- Selectores copiados del DOM real el ${g.lecturaDeCampo.fecha} (${g.lecturaDeCampo.acta}); el pre-vuelo debería confirmarlos.`);
    else out.push('- Selectores derivados de la etiqueta del campo (hipótesis): el pre-vuelo puede no resolver todo.');
    if (ficha?.noAutomatizable) out.push(`- **No se automatiza**: ${ficha.noAutomatizable.razon} — ${ficha.noAutomatizable.nota}`);
    out.push(`- Comando: \`npx tsx scripts/verificar-portal.mjs ${g.comercio} --visita-real --yo "Nombre Apellido"\``);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
