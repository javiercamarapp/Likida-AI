// ═══════════════════════════════════════════════════════════════════════════
// PRE-VUELO CONTRA EL PORTAL REAL DE G500 SURESTE / MEGASUR. SOLO LEE.
//
//   npx vitest run --config pruebas-manuales/vitest.config.ts \
//     pruebas-manuales/megasur-prevuelo.prueba.ts
//
// ── EN QUÉ SE DIFERENCIA DEL DE CAPUFE ───────────────────────────────────
//
// Aquél VERIFICA una lista: `SELECTORES_CAPUFE` ya existe y el pre-vuelo dice
// cuáles siguen vivos. Aquí no hay lista que verificar —el adaptador de Megasur
// no está escrito— así que esto hace lo anterior: LEVANTA EL INVENTARIO del
// formulario para poder escribirlo con datos y no a ojo.
//
// Es el orden que este repo ya pagó una vez: de los 16 selectores de CAPUFE,
// ocho eran apuestas, y una apuesta mala no se descubre revisando código sino
// abriendo el portal.
//
// ── POR QUÉ NO LO CORRE EL AGENTE ────────────────────────────────────────
//
// La política de egreso del entorno de Claude Code bloquea el host: el proxy
// contesta 403 al CONNECT de `megasur.com.mx:8029` y `g500sureste.com.mx` no
// resuelve. Su README dice reportar el host bloqueado y no rodearlo. Así que
// esto se corre desde una máquina con salida a internet —la Mac— y lo que
// vuelve es el reporte.
//
// ── LO QUE ESTE ARCHIVO NO PUEDE HACER, POR CONSTRUCCIÓN ─────────────────
//
// Mismas dos garantías que el de CAPUFE, y por la misma razón: emitir un CFDI
// es irreversible ante el SAT.
//
//   1. No se llama a `escribir`, `hacerClic` ni `seleccionar`. Solo lectura
//      (`captura`) y `evaluate`, que lee el DOM sin tocarlo.
//   2. Se intercepta la red y se ABORTA todo lo que no sea GET/HEAD. Emitir es
//      un POST; aunque alguien meta un clic por error, el formulario no sale.
//      Lo abortado se reporta: es información sobre el portal, no un daño.
//
// Y una tercera, propia de este portal: NO SE ESCRIBE EL RFC. Megasur entra con
// el RFC y nada más —sin contraseña—, así que teclearlo sería iniciar sesión de
// verdad. El inventario del formulario de entrada se levanta con el formulario
// EN BLANCO, que es como se abre.
//
// ── UNA VISITA, NO UN BUCLE ──────────────────────────────────────────────
//
// Una navegación por corrida, con el user-agent de un Chrome normal. Si hace
// falta volver a mirar algo, se mira en el reporte y en la captura.
// ═══════════════════════════════════════════════════════════════════════════

import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conNavegador, type PaginaPlaywright } from '@/lib/likida/facturacion/adaptadores/pagina_playwright';
import { comercio } from '@/lib/likida/facturacion/comercios';

/** Se deja pasar el POST solo sabiendo exactamente por qué. Igual que en CAPUFE. */
const PERMITIR_POST = process.env.PERMITIR_POST === '1';

const HOY = new Date().toISOString().slice(0, 10);
const DIR = join('pruebas-manuales', 'ensayo', HOY);

/** Un Chrome de escritorio cualquiera. Ni se disfraza ni se anuncia como bot. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const renglones: string[] = [];
const decir = (s = '') => {
  renglones.push(s);
  console.log(s);
};

test('pre-vuelo de solo lectura contra el portal real de Megasur', async () => {
  mkdirSync(DIR, { recursive: true });
  const bloqueadas: string[] = [];
  const fallidas: string[] = [];

  // La URL sale del CATÁLOGO, no de una constante local: si alguien corrige el
  // portal en `comercios.ts`, este pre-vuelo tiene que ir al corregido. Dos
  // opiniones sobre dónde se factura es justo el bug que ya costó una vez.
  const ficha = comercio('megasur');
  const URL = ficha?.portal ?? 'http://megasur.com.mx:8029/';

  decir(`# Pre-vuelo Megasur — ${new Date().toISOString()}`);
  decir();
  decir(`Portal (de \`comercios.ts\`): ${URL}`);
  decir(`Campos que la ficha declara: ${(ficha?.campos ?? []).map((c) => `${c.clave}${c.requerido ? '*' : ''}`).join(', ') || '(ninguno)'}`);
  decir(`POST permitido: ${PERMITIR_POST}`);
  decir();

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
        if (metodo === 'GET' || metodo === 'HEAD' || PERMITIR_POST) return ruta.continue();
        bloqueadas.push(`${metodo} ${req.url()}`);
        return ruta.abort();
      });
      page.on('requestfailed', (r) => {
        const f = r.failure()?.errorText ?? '';
        if (f && !f.includes('aborted')) fallidas.push(`${r.method()} ${r.url()} — ${f}`);
      });

      // `abrir` LANZA si el portal no carga —es lo que hace el adaptador— así
      // que el fallo se atrapa aquí para dejarlo escrito en el reporte en vez
      // de que la corrida muera sin decir por qué.
      let error: string | null = null;
      try {
        await pagina.abrir(URL);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      decir('## Navegación');
      decir(`- cargó: ${error ? 'NO' : 'sí'}`);
      if (error) decir(`- error: ${error}`);
      decir(`- url final: ${page.url()}`);
      decir(`- título: ${await page.title().catch(() => '(sin título)')}`);
      decir();
      if (error) {
        decir('El portal no cargó. Sin DOM no hay inventario que levantar.');
        return;
      }

      // ── EL INVENTARIO. Es el entregable: con esto se escriben los selectores.
      const inv = await page.evaluate(() => {
        const visible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        /** La etiqueta que un humano ve al lado del campo. */
        const etiqueta = (el: Element): string => {
          const id = el.getAttribute('id');
          if (id) {
            const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (l?.textContent?.trim()) return l.textContent.trim();
          }
          const padre = el.closest('label');
          if (padre?.textContent?.trim()) return padre.textContent.trim();
          const previo = el.previousElementSibling;
          return previo?.textContent?.trim() ?? '';
        };
        const campos = [...document.querySelectorAll('input, select, textarea')].map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') ?? '',
          id: el.getAttribute('id') ?? '',
          name: el.getAttribute('name') ?? '',
          placeholder: el.getAttribute('placeholder') ?? '',
          maxlength: el.getAttribute('maxlength') ?? '',
          required: el.hasAttribute('required'),
          etiqueta: etiqueta(el).slice(0, 80),
          visible: visible(el),
          opciones: el.tagName === 'SELECT'
            ? [...(el as HTMLSelectElement).options].slice(0, 8).map((o) => `${o.value}=${o.text}`.slice(0, 60))
            : [],
        }));
        const botones = [...document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button]')].map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.getAttribute('id') ?? '',
          name: el.getAttribute('name') ?? '',
          texto: (el.textContent ?? (el as HTMLInputElement).value ?? '').trim().slice(0, 60),
          visible: visible(el),
        }));
        const formularios = [...document.querySelectorAll('form')].map((f) => ({
          id: f.getAttribute('id') ?? '', action: f.getAttribute('action') ?? '', method: f.getAttribute('method') ?? '',
        }));
        // Un captcha visible es lo que le pone techo a la automatización, y es
        // mejor saberlo ahora que a mitad de un lote.
        const captcha = [...document.querySelectorAll('iframe, div, script')]
          .map((el) => el.getAttribute('src') ?? el.getAttribute('class') ?? '')
          .filter((s) => /recaptcha|hcaptcha|turnstile|captcha/i.test(s))
          .slice(0, 5);
        return {
          campos, botones, formularios, captcha,
          texto: (document.body.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 2500),
        };
      });

      decir('## Campos del formulario');
      decir('(`*` = required. El adaptador escribe por `#id` cuando lo hay, y por `[name=…]` si no.)');
      for (const c of inv.campos) {
        const señas = [
          c.id && `#${c.id}`,
          c.name && `[name="${c.name}"]`,
          c.type && `type=${c.type}`,
          c.maxlength && `maxlength=${c.maxlength}`,
          c.required && '*',
          !c.visible && '(OCULTO)',
        ].filter(Boolean).join(' · ');
        decir(`- ${c.tag}  ${señas}`);
        if (c.etiqueta) decir(`    etiqueta: «${c.etiqueta}»`);
        if (c.placeholder) decir(`    placeholder: «${c.placeholder}»`);
        for (const o of c.opciones) decir(`    opción: ${o}`);
      }
      decir();

      decir('## Botones');
      for (const b of inv.botones) {
        decir(`- ${b.tag} «${b.texto}» ${[b.id && `#${b.id}`, b.name && `[name="${b.name}"]`, !b.visible && '(OCULTO)'].filter(Boolean).join(' · ')}`);
      }
      decir();

      decir('## Formularios');
      for (const f of inv.formularios) decir(`- ${f.id ? `#${f.id}` : '(sin id)'} action="${f.action}" method="${f.method}"`);
      decir();

      decir('## ¿Captcha?');
      decir(inv.captcha.length ? `🔴 ${inv.captcha.join(' · ')}` : '✅ nada que parezca captcha en la carga inicial');
      decir();

      decir('## Texto visible de la página');
      decir('```');
      decir(inv.texto);
      decir('```');
      decir();

      const jpg = await pagina.captura();
      decir('## La pantalla');
      decir(`- ${jpg ?? '(no se pudo capturar)'}`);
      decir();
    },
    { userAgent: UA },
  );

  decir('## Red');
  decir(`- peticiones NO-GET abortadas: ${bloqueadas.length}`);
  for (const b of bloqueadas.slice(0, 20)) decir(`    ${b}`);
  decir(`- peticiones fallidas (no abortadas por nosotros): ${fallidas.length}`);
  for (const f of fallidas.slice(0, 20)) decir(`    ${f}`);

  const destino = join(DIR, 'megasur-prevuelo.txt');
  writeFileSync(destino, renglones.join('\n') + '\n', 'utf8');
  console.log(`\n→ reporte: ${destino}`);
}, 300_000);
