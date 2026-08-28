// ═══════════════════════════════════════════════════════════════════════════
// PRE-VUELO GENÉRICO CONTRA EL PORTAL REAL DE CUALQUIER GUION. SOLO LEE.
//
//   set -a; source .env.local; set +a
//   PORTAL=office_depot npx vitest run --config vitest.manual.config.ts \
//     pruebas-manuales/guion-prevuelo.prueba.ts
//
//   # o todos de una:
//   PORTAL=todos npx vitest run --config vitest.manual.config.ts \
//     pruebas-manuales/guion-prevuelo.prueba.ts
//
// ── QUÉ ES ESTO, Y POR QUÉ ES LA MITAD DE LA RAMA ─────────────────────────
//
// `capufe-prevuelo.prueba.ts` hizo esto mismo para UN portal, a mano, con sus
// dieciséis selectores escritos uno por uno en un array de chequeos. Funcionó:
// de ahí salió que ocho selectores resolvían y siete eran apuestas, y eso es
// lo que hizo que CAPUFE se pudiera facturar sin adivinar.
//
// Este arnés hace lo mismo LEYENDO EL GUION. No hay lista de chequeos escrita
// a mano: los selectores salen de la tabla de `portales.ts`, así que un portal
// nuevo no necesita un arnés nuevo — necesita una tabla, que es todo lo que
// necesita para nada más.
//
// Es la pieza que GRADÚA un portal: mientras `verificado` sea `null`, el motor
// ensaya y se niega a emitir (`motivoSinVerificar` en `guion.ts`). Se corre
// esto, se lee el reporte, y lo que reportó se pega en `verificado`. A partir
// de esa línea el portal emite.
//
// ── LO QUE ESTE ARCHIVO NO PUEDE HACER, POR CONSTRUCCIÓN ─────────────────
//
// No escribe, no aprieta y no manda nada. Y no es una promesa de comentario:
//
//   1. No se llama a `escribir`, `hacerClic` ni `seleccionar`. Solo los métodos
//      de LECTURA de la misma `PaginaPlaywright` que usa el motor (`existe`,
//      `leerTexto`, `inventario`, `captura`).
//   2. Se intercepta la red y se ABORTA todo lo que no sea GET/HEAD. Emitir un
//      CFDI es un POST; con esto, aunque alguien meta un clic por error, el
//      formulario no llega a salir. Lo abortado se reporta — es información
//      sobre el portal, no un daño.
//
// ── UNA VISITA POR PORTAL, NO UN BUCLE ───────────────────────────────────
//
// Una navegación por portal, en serie, con el user-agent de un Chrome normal.
// Si hace falta volver a mirar algo, se mira en la captura y en el reporte que
// esto deja escritos, no volviendo a entrar: N visitas seguidas desde la misma
// IP se parecen, desde el lado del portal, a un robot.
// ═══════════════════════════════════════════════════════════════════════════

import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conNavegador, type PaginaPlaywright } from '@/lib/likida/facturacion/adaptadores/pagina_playwright';
import { GUIONES, guionDe } from '@/lib/likida/facturacion/adaptadores/portales';
import { SELECTORES_CAPTCHA_COMUNES } from '@/lib/likida/facturacion/adaptadores/pasos';
import type { CampoGuion, GuionPortal } from '@/lib/likida/facturacion/adaptadores/guion';

const QUE_PORTAL = (process.env.PORTAL ?? '').trim();
const HOY = new Date().toISOString().slice(0, 10);
const DIR = join('pruebas-manuales', 'ensayo', HOY);

/** Un Chrome de escritorio cualquiera. Ni se disfraza ni se anuncia como bot. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const renglones: string[] = [];
const decir = (s = '') => {
  renglones.push(s);
  console.log(s);
};

/** Qué se espera de cada selector con el formulario EN BLANCO, que es como se abre. */
type Espera = 'debe' | 'no-todavia';

interface Chequeo {
  que: string;
  candidatos: readonly string[];
  espera: Espera;
  /** Por qué se espera eso. Sin esto, un «falta» se lee como fallo cuando no lo es. */
  nota?: string;
}

const lista = (s: string | readonly string[]): readonly string[] => (typeof s === 'string' ? [s] : s);

/**
 * Los chequeos de UN guion, derivados de la tabla.
 *
 * `error`, `uuid` y el resultado de la búsqueda van como `no-todavia` A
 * PROPÓSITO: con el formulario en blanco no hay error que enseñar, no hay CFDI
 * emitido y no se ha buscado nada. Que falten aquí NO prueba nada, y marcarlos
 * como `debe` haría que un pre-vuelo bueno se leyera como un portal roto.
 */
function chequeosDe(g: GuionPortal): Chequeo[] {
  const c: Chequeo[] = [];
  for (const [dato, campo] of Object.entries(g.receptor ?? {}) as Array<[string, CampoGuion]>) {
    c.push({ que: `dato fiscal · ${dato}`, candidatos: lista(campo.selector), espera: 'debe' });
  }
  for (const [clave, campo] of Object.entries(g.campos) as Array<[string, CampoGuion]>) {
    c.push({ que: `campo del ticket · ${clave}`, candidatos: lista(campo.selector), espera: 'debe' });
  }
  if (g.buscar) {
    c.push({ que: g.buscar.que, candidatos: lista(g.buscar.boton), espera: 'debe' });
    if (g.buscar.esperar) {
      c.push({
        que: 'resultado de la búsqueda', candidatos: [g.buscar.esperar], espera: 'no-todavia',
        nota: 'Solo aparece DESPUÉS de buscar. Ausente aquí no prueba nada.',
      });
    }
    if (g.buscar.sinResultados) {
      c.push({ que: 'aviso de "no encontramos ese ticket"', candidatos: [g.buscar.sinResultados], espera: 'no-todavia' });
    }
  }
  c.push({
    que: 'botón de emitir', candidatos: lista(g.botonEmitir), espera: 'debe',
    nota: 'APUESTA en casi todos los portales: se elige por TEXTO. En varios no existe hasta que el consumo se encontró.',
  });
  if (g.uuid) {
    c.push({
      que: 'contenedor del UUID', candidatos: [g.uuid], espera: 'no-todavia',
      nota: 'Imposible de verificar sin emitir un CFDI de verdad, que es justo lo que este arnés no hace. Es la apuesta que hay que mirar en la PRIMERA emisión real.',
    });
  }
  if (g.error) {
    c.push({ que: 'cuadro de error', candidatos: [g.error], espera: 'no-todavia', nota: 'Con el formulario en blanco no hay error que enseñar.' });
  }
  if (g.xml) {
    c.push({ que: 'botón de bajar el XML', candidatos: lista(g.xml.boton), espera: 'no-todavia', nota: 'Aparece después de emitir.' });
  }
  return c;
}

async function volar(g: GuionPortal): Promise<void> {
  const bloqueadas: string[] = [];
  const resueltos: string[] = [];
  const sinResolver: string[] = [];

  await conNavegador(
    async (_abrirPagina, sesion) => {
      const pagina: PaginaPlaywright = await sesion.fabrica({
        directorioCapturas: DIR, capturaCompleta: true, calidadCaptura: 70,
      })();
      const page = pagina.pagina;

      // ── EL CANDADO. Antes de navegar, o no sirve de nada.
      await page.route('**/*', async (ruta) => {
        const req = ruta.request();
        const metodo = req.method();
        if (metodo === 'GET' || metodo === 'HEAD') return ruta.continue();
        bloqueadas.push(`${metodo} ${req.url()}`);
        return ruta.abort();
      });

      const t0 = Date.now();
      let abrio = true;
      let porQueNo = '';
      try {
        await pagina.abrir(g.portal);
      } catch (e) {
        abrio = false;
        porQueNo = e instanceof Error ? e.message : String(e);
      }
      const ms = Date.now() - t0;

      decir('═'.repeat(78));
      decir(`PRE-VUELO · ${g.comercio.toUpperCase()} — SOLO LECTURA`);
      decir('═'.repeat(78));
      decir(`URL      ${g.portal}`);
      decir(`Fecha    ${new Date().toISOString()}`);
      decir(`Abrió    ${abrio ? `sí, en ${ms} ms` : `NO — ${porQueNo}`}`);
      if (!abrio) {
        decir('');
        decir('Sin página no hay nada que verificar. El portal puede estar caído o bloqueando esta IP.');
        decir('NO se marca nada como verificado: un portal que no abrió no dijo que sus selectores estén mal.');
        decir('');
        return;
      }
      decir(`Título   ${await page.title()}`);
      const urlReal = page.url();
      decir(`URL real ${urlReal}${urlReal !== g.portal ? '   ⚠️ HUBO REDIRECCIÓN' : ''}`);
      decir('');

      // ── EL CAPTCHA, PRIMERO. Si lo hay, el resto del reporte es informativo:
      // ese portal no se va a automatizar y el ticket va con una persona.
      const conCaptcha: string[] = [];
      for (const sel of [...(g.captcha ?? []), ...SELECTORES_CAPTCHA_COMUNES]) {
        if (await pagina.existe(sel)) conCaptcha.push(sel);
      }
      if (conCaptcha.length > 0) {
        decir(`⛔ CAPTCHA: ${conCaptcha.join(', ')}`);
        decir('   Este portal NO se automatiza. Likida no resuelve ni rodea captchas: rodearlos');
        decir('   es operar contra los términos del portal y la cuenta que se bloquea es la del');
        decir('   CLIENTE. El camino correcto es el modo asistido — la pantalla prellenada.');
        decir('');
      }

      // ── SELECTOR POR SELECTOR ───────────────────────────────────────────
      decir('SELECTORES');
      decir('─'.repeat(78));
      for (const ch of chequeosDe(g)) {
        let gano: string | null = null;
        for (const cand of ch.candidatos) {
          if (await pagina.existe(cand)) { gano = cand; break; }
        }
        if (gano) {
          decir(`✅ ${ch.que}`);
          decir(`     ${gano}`);
          if (ch.candidatos.length > 1) decir(`     (ganó el candidato ${ch.candidatos.indexOf(gano) + 1} de ${ch.candidatos.length})`);
          resueltos.push(ch.que);
        } else {
          const marca = ch.espera === 'debe' ? '❌' : '·';
          decir(`${marca} ${ch.que} — ninguno de ${ch.candidatos.length} candidato(s) resuelve`);
          for (const cand of ch.candidatos) decir(`     ${cand}`);
          if (ch.espera === 'debe') sinResolver.push(ch.que);
        }
        if (ch.nota) decir(`     ↳ ${ch.nota}`);
      }
      decir('');

      // ── EL INVENTARIO: lo que la página SÍ tiene, para poder corregir ────
      // Sin esto, un «no resuelve» deja a quien lo lea sin nada que hacer. Con
      // el inventario, el selector bueno se lee directamente de aquí.
      const inv = await pagina.inventario();
      decir(`INVENTARIO REAL — ${inv.campos.length} campos, ${inv.botones.length} botones`);
      decir('─'.repeat(78));
      for (const c of inv.campos.filter((x) => x.visible)) {
        decir(`  <${c.tag} type="${c.type}" id="${c.id}" name="${c.name}">  etiqueta: ${c.etiqueta || '—'}  placeholder: ${c.placeholder || '—'}`);
        if (c.opciones.length > 0) decir(`      opciones: ${c.opciones.slice(0, 8).join(' | ')}${c.opciones.length > 8 ? ' …' : ''}`);
      }
      for (const b of inv.botones.filter((x) => x.visible)) {
        decir(`  [botón] "${b.texto}"  id="${b.id}" name="${b.name}"`);
      }
      decir('');

      const captura = await pagina.captura();
      decir(`Captura  ${captura}`);
      if (bloqueadas.length > 0) {
        decir(`Bloqueadas (no-GET): ${bloqueadas.length}`);
        for (const b of bloqueadas.slice(0, 10)) decir(`     ${b}`);
      }
      decir('');

      // ── EL VEREDICTO, QUE ES LO QUE SE PEGA EN `verificado` ──────────────
      decir('VEREDICTO');
      decir('─'.repeat(78));
      if (conCaptcha.length > 0) {
        decir('NO GRADUAR: el portal pide captcha. Va por modo asistido.');
      } else if (sinResolver.length > 0) {
        decir(`NO GRADUAR TODAVÍA: ${sinResolver.length} selector(es) que DEBEN estar no resuelven:`);
        for (const s of sinResolver) decir(`     · ${s}`);
        decir('Corrige los candidatos en portales.ts leyendo el INVENTARIO de arriba y vuelve a correr.');
      } else {
        decir('Todos los selectores que deben estar con el formulario en blanco RESUELVEN.');
        decir('Para graduar el portal, pega esto en su `verificado` de portales.ts:');
        decir('');
        decir('  verificado: {');
        decir(`    fecha: '${HOY}',`);
        decir("    arnes: 'pruebas-manuales/guion-prevuelo.prueba.ts',");
        decir(`    resueltos: [${resueltos.map((r) => `'${r}'`).join(', ')}],`);
        decir('  },');
        decir('');
        decir('Y ANTES DE PEGARLO, LÉELO: el botón de emitir y el contenedor del UUID siguen');
        decir('siendo apuestas en la mayoría de estos portales —el primero a veces no existe');
        decir('hasta que hay un consumo encontrado, el segundo no existe hasta que se emitió—.');
        decir('Graduar el portal habilita apretar un botón que crea un CFDI irreversible.');
      }
      decir('');
    },
    { userAgent: UA },
  );
}

const objetivo = QUE_PORTAL === 'todos' ? GUIONES : [guionDe(QUE_PORTAL)].filter((g): g is GuionPortal => g !== null);

test('pre-vuelo de solo lectura contra el portal real del guion', async () => {
  mkdirSync(DIR, { recursive: true });

  if (objetivo.length === 0) {
    // NO se lanza: no haber elegido portal no es un fallo del código, es una
    // invocación incompleta. Se dice qué hay y se sale.
    decir(`No hay guion para PORTAL="${QUE_PORTAL}".`);
    decir(`Los que hay: ${GUIONES.map((g) => g.comercio).join(', ')}  (o PORTAL=todos)`);
    return;
  }

  for (const g of objetivo) await volar(g);

  const salida = join(DIR, `guion-prevuelo-${QUE_PORTAL || 'sin-portal'}.txt`);
  writeFileSync(salida, `${renglones.join('\n')}\n`, 'utf8');
  console.log(`\nReporte escrito en ${salida}`);
}, 300_000);
