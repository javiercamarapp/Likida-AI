// ═══════════════════════════════════════════════════════════════════════════
// PRE-VUELO CONTRA EL PORTAL REAL DE CAPUFE. SOLO LEE.
//
//   npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/capufe-prevuelo.prueba.ts
//
// Qué contesta, y por qué hace falta contestarlo ANTES de la primera factura:
// de los 16 selectores de `SELECTORES_CAPUFE`, ocho se verificaron contra el
// DOM el 4-ago-2026 y el resto son APUESTAS del adaptador —los dos botones, la
// tabla, el cuadro de error, el UUID y los dos buscadores—. Una apuesta mala no
// se descubre revisando código: se descubre abriendo el portal. Esto lo abre
// UNA vez y reporta selector por selector.
//
// ── LO QUE ESTE ARCHIVO NO PUEDE HACER, POR CONSTRUCCIÓN ─────────────────
//
// No escribe, no aprieta y no manda nada. Y no es una promesa de comentario:
//
//   1. No se llama a `escribir`, `hacerClic` ni `seleccionar`. Se usan solo los
//      métodos de LECTURA de la misma `PaginaPlaywright` que usa el adaptador
//      (`existe`, `leerTexto`, `opciones`, `captura`) más `evaluate`, que lee
//      el DOM sin tocarlo.
//   2. Se intercepta la red y se ABORTA todo lo que no sea GET/HEAD. Emitir un
//      CFDI es un POST; con esto, aunque alguien meta un clic por error, el
//      formulario no llega a salir. Lo abortado se reporta —es información
//      sobre el portal, no un daño—. Con `PERMITIR_POST=1` se deja pasar, y
//      solo debería usarse sabiendo exactamente por qué.
//
// Emitir en CAPUFE es IRREVERSIBLE ante el SAT y aquí no hay ni datos fiscales
// con qué hacerlo. Este arnés existe justo para no tener que averiguarlo
// emitiendo.
//
// ── UNA VISITA, NO UN BUCLE ──────────────────────────────────────────────
//
// Es un sitio de gobierno. Una navegación por corrida, en serie, con el
// user-agent de un Chrome normal. Si hace falta volver a mirar algo, se mira en
// la captura y en el reporte que esto deja escritos, no volviendo a entrar.
// ═══════════════════════════════════════════════════════════════════════════

import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  conNavegador,
  type PaginaPlaywright,
} from '@/lib/cuadra/facturacion/adaptadores/pagina_playwright';
import {
  SELECTORES_CAPUFE,
  SELECTORES_CAPTCHA,
  URL_CAPUFE_SIN_REGISTRO,
} from '@/lib/cuadra/facturacion/adaptadores/capufe';

const PERMITIR_POST = process.env.PERMITIR_POST === '1';
/**
 * Leer los `.js` del portal que el navegador YA se descargó, para buscar ahí lo
 * que el DOM no puede enseñar: el botón de emitir no existe hasta que hay un
 * código agregado, y agregar un código es escribir. El texto del botón, en
 * cambio, está en la plantilla compilada. NO son peticiones nuevas: se leen los
 * cuerpos de las respuestas que la carga normal de la página ya trajo.
 */
const LEER_BUNDLE = process.env.LEER_BUNDLE === '1';
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
type Espera = 'debe' | 'quiza' | 'no-todavia';

interface Chequeo {
  que: string;
  clave: string;
  selector: string;
  espera: Espera;
  /** Por qué se espera eso. Sin esto, un "falta" se lee como un fallo cuando no lo es. */
  nota?: string;
}

const CHEQUEOS: Chequeo[] = [
  { que: 'RFC', clave: 'rfc', selector: SELECTORES_CAPUFE.rfc, espera: 'debe' },
  { que: 'Nombre o razón social', clave: 'nombre', selector: SELECTORES_CAPUFE.nombre, espera: 'debe' },
  { que: 'Código postal', clave: 'codigoPostal', selector: SELECTORES_CAPUFE.codigoPostal, espera: 'debe' },
  { que: 'Régimen fiscal (select)', clave: 'regimenFiscal', selector: SELECTORES_CAPUFE.regimenFiscal, espera: 'debe' },
  { que: 'Uso del CFDI (select)', clave: 'usoCfdi', selector: SELECTORES_CAPUFE.usoCfdi, espera: 'debe' },
  { que: 'Correo', clave: 'correo', selector: SELECTORES_CAPUFE.correo, espera: 'debe' },
  { que: 'Código del ticket', clave: 'codigo', selector: SELECTORES_CAPUFE.codigo, espera: 'debe' },
  {
    que: 'Checkbox de partidos políticos (NUNCA se marca)',
    clave: 'complementoPartidos',
    selector: SELECTORES_CAPUFE.complementoPartidos,
    espera: 'debe',
    nota: 'Se comprueba para saber que sigue siendo ESE checkbox, no para usarlo. `clicSeguro()` lo prohíbe por nombre.',
  },
  {
    que: 'Buscador del régimen (xpath hacia atrás)',
    clave: 'buscadorRegimen',
    selector: SELECTORES_CAPUFE.buscadorRegimen,
    espera: 'quiza',
    nota: 'Es el camino de respaldo si la página no ofrece `selectOption`. Falta = no hay buscador delante del select.',
  },
  { que: 'Buscador del uso de CFDI (xpath hacia atrás)', clave: 'buscadorUso', selector: SELECTORES_CAPUFE.buscadorUso, espera: 'quiza' },
  { que: 'Botón "Validar Código"', clave: 'botonValidar', selector: SELECTORES_CAPUFE.botonValidar, espera: 'debe', nota: 'APUESTA: se eligió por texto.' },
  { que: 'Botón de emitir', clave: 'botonEmitir', selector: SELECTORES_CAPUFE.botonEmitir, espera: 'debe', nota: 'APUESTA: se eligió por texto ("Facturar").' },
  {
    que: 'Tabla CÓDIGOS AGREGADOS',
    clave: 'tabla',
    selector: SELECTORES_CAPUFE.tabla,
    espera: 'quiza',
    nota: 'Puede no existir hasta que se valida el primer código. Si existe, abajo va el ORDEN REAL de sus columnas.',
  },
  { que: 'Cuadro de error', clave: 'error', selector: SELECTORES_CAPUFE.error, espera: 'no-todavia', nota: 'Con el formulario en blanco no hay error que enseñar. Ausente aquí NO prueba nada.' },
  { que: 'Contenedor del UUID', clave: 'uuid', selector: SELECTORES_CAPUFE.uuid, espera: 'no-todavia', nota: 'Solo aparece DESPUÉS de emitir. No se puede verificar sin emitir un CFDI real.' },
];

test('pre-vuelo de solo lectura contra el portal real de CAPUFE', async () => {
  mkdirSync(DIR, { recursive: true });
  const bloqueadas: string[] = [];
  const fallidas: string[] = [];

  await conNavegador(
    async (_abrirPagina, sesion) => {
      const pagina: PaginaPlaywright = await sesion.fabrica({ directorioCapturas: DIR, capturaCompleta: true, calidadCaptura: 70 })();
      const page = pagina.pagina;

      // ── EL CANDADO. Antes de navegar, o no sirve de nada.
      await page.route('**/*', async (ruta) => {
        const req = ruta.request();
        const metodo = req.method();
        if (metodo === 'GET' || metodo === 'HEAD' || PERMITIR_POST) return ruta.continue();
        bloqueadas.push(`${metodo} ${req.url()}`);
        return ruta.abort();
      });
      page.on('requestfailed', (r) => {
        const f = r.failure()?.errorText ?? '';
        if (f && !f.includes('aborted')) fallidas.push(`${r.method()} ${r.url()} — ${f}`);
      });

      const bundles: Array<Promise<{ url: string; texto: string } | null>> = [];
      if (LEER_BUNDLE) {
        page.on('response', (res) => {
          if (!/javascript/i.test(res.headers()['content-type'] ?? '')) return;
          if (!/facturacioncapufe|quadrum/i.test(res.url())) return; // solo lo suyo
          bundles.push(res.text().then((texto) => ({ url: res.url(), texto })).catch(() => null));
        });
      }

      const t0 = Date.now();
      let abrio = true;
      try {
        await pagina.abrir(URL_CAPUFE_SIN_REGISTRO);
      } catch (e) {
        abrio = false;
        decir(`❌ NO ABRIÓ: ${e instanceof Error ? e.message : String(e)}`);
      }
      const ms = Date.now() - t0;

      decir('═'.repeat(78));
      decir('PRE-VUELO CAPUFE — SOLO LECTURA');
      decir('═'.repeat(78));
      decir(`URL      ${URL_CAPUFE_SIN_REGISTRO}`);
      decir(`Fecha    ${new Date().toISOString()}`);
      decir(`Abrió    ${abrio ? `sí, en ${ms} ms` : 'NO'}`);
      if (!abrio) {
        decir('');
        decir('Sin página no hay nada que verificar. El portal puede estar caído o bloqueando esta IP.');
        return;
      }
      decir(`Título   ${await page.title()}`);
      decir(`URL real ${page.url()}${page.url() !== URL_CAPUFE_SIN_REGISTRO ? '   ⚠️ HUBO REDIRECCIÓN' : ''}`);

      // ── 1. CAPTCHA ────────────────────────────────────────────────────────
      decir('');
      decir('── 1. ¿HAY CAPTCHA QUE BLOQUEE? ' + '─'.repeat(44));
      let bloquea = false;
      for (const sel of SELECTORES_CAPTCHA) {
        const n = await page.locator(sel).count();
        if (n > 0) bloquea = true;
        decir(`   ${n > 0 ? '🔴' : '  '} ${n > 0 ? `${n} ×` : 'ausente'}  ${sel}`);
      }
      const pistas = await page.evaluate(() => ({
        scripts: [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src).filter((s) => /captcha/i.test(s)),
        iframes: [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, title: f.title })),
        badge: document.querySelectorAll('.grecaptcha-badge').length,
        // v3 mete un token oculto en el formulario. Verlo confirma "invisible",
        // que es distinto de "no hay captcha".
        tokens: [...document.querySelectorAll('input[type=hidden]')].map((i) => (i as HTMLInputElement).name).filter((n) => /captcha|token/i.test(n)),
      }));
      decir(`   scripts de captcha: ${pistas.scripts.length ? pistas.scripts.join(', ') : 'ninguno'}`);
      decir(`   badge v3 (.grecaptcha-badge): ${pistas.badge}`);
      decir(`   campos ocultos con pinta de token: ${pistas.tokens.join(', ') || 'ninguno'}`);
      decir(`   iframes: ${pistas.iframes.length ? pistas.iframes.map((f) => `${f.title || '(sin title)'} ← ${f.src || '(sin src)'}`).join(' | ') : 'ninguno'}`);
      decir(`   ⇒ ${bloquea ? '🔴 HAY UN CAPTCHA VISIBLE: el adaptador abortaría aquí, y hace bien.' : '✅ Ningún captcha bloqueante en pantalla. Si carga v3 invisible, el adaptador NO aborta por eso (a propósito).'}`);

      // ── 2. SELECTOR POR SELECTOR ──────────────────────────────────────────
      decir('');
      decir('── 2. LOS SELECTORES DE `SELECTORES_CAPUFE`, UNO POR UNO ' + '─'.repeat(20));
      const resultado = new Map<string, { n: number; espera: Espera }>();
      for (const c of CHEQUEOS) {
        let n = 0;
        let detalle = '';
        try {
          n = await page.locator(c.selector).count();
          if (n > 0) detalle = await page.locator(c.selector).first().evaluate((el) => {
            const e = el as HTMLElement;
            const attrs = ['type', 'name', 'id', 'maxlength', 'placeholder', 'disabled']
              .map((a) => (e.getAttribute(a) ? `${a}="${e.getAttribute(a)}"` : ''))
              .filter(Boolean)
              .join(' ');
            const txt = (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
            return `<${e.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${txt ? ` "${txt}"` : ''}`;
          });
        } catch (e) {
          detalle = `SELECTOR INVÁLIDO: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
        }
        resultado.set(c.clave, { n, espera: c.espera });
        const marca = n > 0 ? '✅' : c.espera === 'debe' ? '❌' : c.espera === 'quiza' ? '⚠️ ' : '·  ';
        decir(`   ${marca} ${c.que}`);
        decir(`        ${c.selector}`);
        decir(`        casan: ${n}${n > 0 ? `   →  ${detalle}` : ''}`);
        if (c.nota) decir(`        (${c.nota})`);
      }

      // ── 2.5 LOS CATÁLOGOS QUE LLEGAN POR AJAX ────────────────────────────
      //
      // Los dos `<select>` nacen vacíos y el portal los puebla después. Es la
      // parte del adaptador que más se puede quedar esperando (`esperarOpcion`
      // falla el lote entero si el catálogo no trae la clave de la flota), así
      // que aquí se mira QUÉ claves ofrece de verdad. Se pregunta en bucle
      // —igual que el adaptador—, no se duerme un número mágico.
      decir('');
      decir('── 2.5 LOS CATÁLOGOS DE LOS DOS <select> ' + '─'.repeat(35));
      for (const [que, sel, clave] of [
        ['Régimen fiscal', SELECTORES_CAPUFE.regimenFiscal, '601'],
        ['Uso del CFDI', SELECTORES_CAPUFE.usoCfdi, 'G03'],
      ] as const) {
        let ops: string[] = [];
        for (let i = 0; i < 20; i++) {
          ops = await pagina.opciones(sel);
          if (ops.filter(Boolean).length > 1) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const utiles = ops.filter(Boolean);
        decir(`   ${que}: ${utiles.length} opciones con valor`);
        if (utiles.length === 0) decir('      ⚠️  siguió VACÍO — el AJAX que lo puebla no llegó (¿bloqueado por el candado de POST?)');
        else {
          decir(`      claves: ${utiles.slice(0, 40).join(', ')}${utiles.length > 40 ? ` … (+${utiles.length - 40})` : ''}`);
          decir(`      ¿ofrece "${clave}"? ${utiles.includes(clave) ? '✅ sí' : `❌ NO — y esa es la que usa el receptor de ejemplo`}`);
        }
      }

      // Un reCAPTCHA con `render=explicit` se pinta cuando el JS quiere. Se
      // vuelve a mirar DESPUÉS de que el portal terminó de armarse.
      decir('');
      decir('   ¿apareció algún captcha ya con la página armada?');
      for (const sel of SELECTORES_CAPTCHA) {
        const n = await page.locator(sel).count();
        if (n > 0) decir(`      🔴 ${n} × ${sel}`);
      }

      // ── 3. INVENTARIO DEL DOM ─────────────────────────────────────────────
      // Lo que hace falta para PROPONER el selector bueno cuando uno falla. Se
      // lee todo de una vez: una sola pasada por el DOM, sin volver a la red.
      const inv = await page.evaluate(() => {
        const limpio = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        return {
          botones: [...document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button]')].map((b) => {
            const e = b as HTMLElement;
            const val = (e as HTMLInputElement).value;
            return {
              tag: e.tagName.toLowerCase(),
              texto: limpio(e.textContent) || limpio(val),
              type: e.getAttribute('type') ?? '',
              id: e.id,
              clases: e.className?.toString().slice(0, 70) ?? '',
              oculto: !(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
              deshabilitado: (e as HTMLButtonElement).disabled === true,
            };
          }),
          tablas: [...document.querySelectorAll('table')].map((t) => {
            const enc = [...t.querySelectorAll('thead th, thead td')].map((c) => limpio(c.textContent));
            const primera = enc.length ? [] : [...(t.querySelector('tr')?.children ?? [])].map((c) => limpio(c.textContent));
            return {
              id: t.id,
              clases: t.className?.toString().slice(0, 70) ?? '',
              encabezados: enc.length ? enc : primera,
              filasCuerpo: t.querySelectorAll('tbody tr').length,
              // El texto de alrededor: es como se sabe si ESTA es la de
              // "CÓDIGOS AGREGADOS" o la de otra cosa.
              contexto: limpio(t.closest('div, section, form')?.textContent).slice(0, 120),
            };
          }),
          selects: [...document.querySelectorAll('select')].map((s) => {
            const prev = s.previousElementSibling as HTMLElement | null;
            return {
              name: s.getAttribute('name') ?? '',
              id: s.id,
              opciones: s.options.length,
              primera: limpio(s.options[0]?.textContent),
              hermanoPrevio: prev ? `<${prev.tagName.toLowerCase()} type="${prev.getAttribute('type') ?? ''}" class="${(prev.className?.toString() ?? '').slice(0, 40)}">` : '(ninguno)',
            };
          }),
          // Candidatos a cuadro de error y a contenedor de UUID. Se buscan por
          // lo que suele llamarse, no por lo que uno quiere que se llame.
          posiblesError: [...document.querySelectorAll('[class*=alert], [class*=error], [class*=invalid], [class*=message], [class*=danger], [role=alert]')]
            .map((e) => `<${e.tagName.toLowerCase()} class="${(e.className?.toString() ?? '').slice(0, 60)}"> ${limpio(e.textContent).slice(0, 50)}`)
            .slice(0, 12),
          posiblesUuid: [...document.querySelectorAll('[class*=uuid], [id*=uuid], [class*=folio], [id*=folio], [class*=fiscal]')]
            .map((e) => `<${e.tagName.toLowerCase()} id="${e.id}" class="${(e.className?.toString() ?? '').slice(0, 60)}">`)
            .slice(0, 12),
          diceCodigosAgregados: /c[óo]digos\s+agregados/i.test(document.body.innerText),
          diceFacturacionRapida: /facturaci[óo]n\s+r[áa]pida/i.test(document.body.innerText),
          totalInputs: document.querySelectorAll('input').length,
          textoPlano: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1400),
        };
      });

      decir('');
      decir('── 3. LO QUE HAY DE VERDAD EN LA PÁGINA ' + '─'.repeat(37));
      decir(`   inputs: ${inv.totalInputs} · selects: ${inv.selects.length} · tablas: ${inv.tablas.length} · botones: ${inv.botones.length}`);
      decir(`   ¿aparece "CÓDIGOS AGREGADOS"? ${inv.diceCodigosAgregados ? 'sí' : 'NO (con el formulario en blanco puede ser normal)'}`);
      decir('');
      decir('   BOTONES (el texto REAL, que es lo que casa `:has-text`):');
      for (const b of inv.botones) {
        decir(`     · "${b.texto}"  <${b.tag}${b.type ? ` type=${b.type}` : ''}${b.id ? ` id=${b.id}` : ''}>${b.oculto ? '  [OCULTO]' : ''}${b.deshabilitado ? '  [deshabilitado]' : ''}`);
        if (b.clases) decir(`         class="${b.clases}"`);
      }
      decir('');
      decir('   TABLAS (y el ORDEN REAL de sus columnas):');
      if (inv.tablas.length === 0) decir('     (ninguna — la de CÓDIGOS AGREGADOS solo se pinta al validar el primer código)');
      for (const t of inv.tablas) {
        decir(`     · <table${t.id ? ` id=${t.id}` : ''} class="${t.clases}"> filas en tbody: ${t.filasCuerpo}`);
        decir(`       columnas: ${t.encabezados.length ? t.encabezados.map((h, i) => `${i + 1}=${h || '(vacía)'}`).join(' | ') : '(sin encabezados)'}`);
        decir(`       contexto: ${t.contexto}`);
      }
      decir('');
      decir('   SELECTS (y qué tienen delante — el patrón del buscador):');
      for (const s of inv.selects) {
        decir(`     · name="${s.name}" id="${s.id}" opciones=${s.opciones} primera="${s.primera}"`);
        decir(`       hermano previo: ${s.hermanoPrevio}`);
      }
      decir('');
      decir('   CANDIDATOS A CUADRO DE ERROR:');
      for (const e of inv.posiblesError) decir(`     · ${e}`);
      if (!inv.posiblesError.length) decir('     (ninguno visible con el formulario en blanco)');
      decir('');
      decir('   CANDIDATOS A CONTENEDOR DE UUID/FOLIO:');
      for (const e of inv.posiblesUuid) decir(`     · ${e}`);
      if (!inv.posiblesUuid.length) decir('     (ninguno — se pinta al emitir, no antes)');

      // ── 3.5 LO QUE EL DOM NO ENSEÑA, EN LA PLANTILLA COMPILADA ───────────
      if (LEER_BUNDLE) {
        const leidos = (await Promise.all(bundles)).filter((b): b is { url: string; texto: string } => b !== null);
        decir('');
        decir('── 3.5 EL BOTÓN DE EMITIR, BUSCADO EN LOS .js DEL PORTAL ' + '─'.repeat(19));
        decir(`   ${leidos.length} archivo(s) de JS del portal, ${(leidos.reduce((s, b) => s + b.texto.length, 0) / 1048576).toFixed(1)} MB`);
        const buscar = (re: RegExp, titulo: string) => {
          const vistos = new Set<string>();
          for (const b of leidos) for (const m of b.texto.matchAll(re)) vistos.add(m[0].replace(/\s+/g, ' ').trim());
          decir(`   ${titulo}: ${vistos.size ? [...vistos].slice(0, 25).map((v) => `"${v}"`).join(', ') : '(nada)'}`);
        };
        buscar(/[>"'][^<>"']{0,25}(?:Facturar|FACTURAR)[^<>"']{0,25}["'<]/g, 'con "Facturar"');
        buscar(/[>"'][^<>"']{0,25}(?:Emitir|EMITIR|Timbrar|Generar factura)[^<>"']{0,25}["'<]/g, 'con "Emitir"/"Timbrar"/"Generar factura"');
        buscar(/sinregistro\/[a-zA-Z_]+/g, 'endpoints /sinregistro/');
        buscar(/capufe-quadrum-backend\/[a-zA-Z0-9/_-]+/g, 'endpoints del backend');
        buscar(/(?:regimen|uso)[A-Za-z]*\/[a-zA-Z_]+/gi, 'endpoints de catálogos');
      }

      // ── 4. LA RED, QUE ES LA PRUEBA DE QUE NO SE MANDÓ NADA ──────────────
      decir('');
      decir('── 4. RED ' + '─'.repeat(66));
      decir(`   peticiones NO-GET abortadas: ${bloqueadas.length}`);
      for (const b of bloqueadas.slice(0, 15)) decir(`     · ${b}`);
      if (fallidas.length) {
        decir(`   peticiones fallidas (no por nosotros): ${fallidas.length}`);
        for (const f of fallidas.slice(0, 8)) decir(`     · ${f}`);
      }

      // ── 5. VEREDICTO ─────────────────────────────────────────────────────
      decir('');
      decir('── 5. VEREDICTO ' + '─'.repeat(60));
      const rotos = CHEQUEOS.filter((c) => c.espera === 'debe' && (resultado.get(c.clave)?.n ?? 0) === 0);
      const dudosos = CHEQUEOS.filter((c) => c.espera === 'quiza' && (resultado.get(c.clave)?.n ?? 0) === 0);
      const ambiguos = CHEQUEOS.filter((c) => (resultado.get(c.clave)?.n ?? 0) > 1);

      if (rotos.length === 0) decir('   ✅ Todos los selectores que DEBEN estar, están.');
      else {
        decir(`   ❌ ${rotos.length} selector(es) que el adaptador da por seguros NO existen:`);
        for (const c of rotos) decir(`      · ${c.que} → \`${c.selector}\``);
        decir('      Se corrigen sin tocar lógica: `OpcionesCapufe.selectores` los sobrescribe uno por uno.');
      }
      if (dudosos.length) {
        decir(`   ⚠️  ${dudosos.length} de respaldo no están (no es fatal, pero se pierde ese camino):`);
        for (const c of dudosos) decir(`      · ${c.que} → \`${c.selector}\``);
      }
      if (ambiguos.length) {
        decir(`   ⚠️  ${ambiguos.length} casan con MÁS DE UN elemento (se usa el primero del documento):`);
        for (const c of ambiguos) decir(`      · ${c.que} casa ${resultado.get(c.clave)?.n} veces → \`${c.selector}\``);
      }
      decir('   · El cuadro de error y el UUID NO se pueden verificar aquí: el primero necesita un');
      decir('     error del portal y el segundo un CFDI emitido. Quedan pendientes a propósito.');

      decir('');
      decir('── TEXTO DE LA PÁGINA (recorte) ' + '─'.repeat(44));
      decir(inv.textoPlano);

      const jpg = await pagina.captura();
      decir('');
      decir(`captura: ${jpg}`);
      // La pestaña se cierra aquí y no en el `finally` del navegador: si no,
      // `portal.lote_cerrado` reporta una página suelta y eso es justo la señal
      // que sirve para detectar fugas de pestañas en producción.
      await pagina.cerrar();
    },
    { pagina: { directorioCapturas: DIR }, userAgent: UA },
  );

  const destino = join(DIR, PERMITIR_POST ? 'capufe-prevuelo-con-post.txt' : 'capufe-prevuelo.txt');
  writeFileSync(destino, renglones.join('\n'), 'utf8');
  console.log(`\nreporte: ${destino}\n`);
}, 180_000);
