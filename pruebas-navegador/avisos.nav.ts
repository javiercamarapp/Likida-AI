/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EL CENTRO DE AVISOS DE PUNTA A PUNTA — superadmin (/admin/notificaciones) y dueño de flota (/dashboard/notificaciones).
 *
 * Nació de la queja del dueño en producción: «sale que tenemos notificaciones y no me salen, no me deja quitarlas». Cada caso de abajo
 * es una promesa del centro nuevo, probada en el navegador real contra la base local CON la migración 1002 aplicada:
 *   (a) el número de «Avisos» del pie ES el de «No leídas»;     (b) cada aviso trae origen, hora y un enlace que lleva a su pantalla;
 *   (c) marcar leído lo mueve y baja el pie sin recargar y tras recargar (persistencia en la base);   (d) marcar no leído lo regresa;
 *   (e) «Marcar todo» deja No leídas vacía salvo lo que no se puede silenciar (y lo explica);   (f) filtros por tipo y severidad;
 *   (g) apagar un tipo en la configuración lo oculta de lista y conteo (salvo no silenciables) y persiste; el horario de silencio se guarda;
 *   (h) aislamiento entre flotas y respecto de la consola;   (i) móvil: avisos-movil.nav.ts;   (j) cero errores de consola.
 *
 * Las condiciones que producen avisos se siembran en `apoyo/avisos-datos.ts` (y se limpian al terminar). La interfaz se fija en v2 para la flota
 * A: es la que usa el producto por omisión y la única con el pie «Avisos».
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect } from './apoyo/fixture';
import { CORREOS, ESTADOS } from './apoyo/sesion';
import {
  fijarVersionUi, leidasEnBase, limpiarCondiciones, preferenciasEnBase, reiniciarEstado, sembrarCondiciones, silencioEnBase, TENANT_A, TENANT_B, usuarioId,
} from './apoyo/avisos-datos';
import {
  abrir, botonLeido, conteoPestana, esFija, esperarAviso, filas, irAPestana, listaLista, numeroPie, selectSeveridad, selectTipo, titulos, vigilarConsola,
} from './apoyo/avisos-ui';

interface Identidad {
  nombre: string;
  estado: string;
  correo: string;
  ruta: string;
  /** Un aviso sembrado que debe aparecer. */
  sembrado: RegExp;
  /** Un tipo con al menos un aviso silenciable sembrado, y su etiqueta en la matriz. */
  tipoSilenciable: { etiqueta: string; valor: string };
  /** Pantalla a la que se vuelve para leer el pie en otra página. */
  otraPantalla: string;
  /** ¿La identidad tiene avisos que no se pueden silenciar? (la consola sí: ARCO, SLA, crons). */
  tieneFijos: boolean;
}

const IDENTIDADES: Identidad[] = [
  {
    nombre: 'superadmin', estado: ESTADOS.superadmin, correo: CORREOS.superadmin, ruta: '/admin/notificaciones', sembrado: /ARCO/i,
    tipoSilenciable: { etiqueta: 'Escalaciones', valor: 'escalaciones' }, otraPantalla: '/admin', tieneFijos: true,
  },
  {
    nombre: 'dueño de flota', estado: ESTADOS.duena, correo: CORREOS.duena, ruta: '/dashboard/notificaciones', sembrado: /comprobantes? lleg/i,
    tipoSilenciable: { etiqueta: 'Dinero', valor: 'dinero' }, otraPantalla: '/dashboard', tieneFijos: false,
  },
];

let versionAnterior: 'v1' | 'v2' | null = null;
let versionAnteriorB: 'v1' | 'v2' | null = null;

test.beforeAll(async () => {
  await sembrarCondiciones();
  versionAnterior = await fijarVersionUi(TENANT_A, 'v2');
  versionAnteriorB = await fijarVersionUi(TENANT_B, 'v2');
});

test.afterAll(async () => {
  await limpiarCondiciones();
  for (const c of [CORREOS.superadmin, CORREOS.duena, CORREOS.intrusa]) await reiniciarEstado(await usuarioId(c));
  if (versionAnterior) await fijarVersionUi(TENANT_A, versionAnterior);
  if (versionAnteriorB) await fijarVersionUi(TENANT_B, versionAnteriorB);
});

for (const id of IDENTIDADES) {
  test.describe(`avisos · ${id.nombre}`, () => {
    test.describe.configure({ mode: 'serial' });
    test.use({ storageState: id.estado });

    let userId = '';
    let consola: { errores: string[] };

    test.beforeAll(async () => { userId = await usuarioId(id.correo); });
    test.beforeEach(async ({ page }) => {
      await reiniciarEstado(userId);
      consola = vigilarConsola(page);
    });
    test.afterEach(() => {
      // (j) Ninguna prueba termina con errores de consola ni excepciones de página.
      expect(consola.errores, 'errores de consola o de página').toEqual([]);
    });

    test('(a) el número del pie es EXACTAMENTE el de «No leídas», aquí y en otra pantalla', async ({ page }) => {
      await esperarAviso(page, id.ruta, id.sembrado);
      await listaLista(page);
      const noLeidas = await conteoPestana(page, 'No leídas');
      expect(noLeidas).toBeGreaterThan(0);
      expect(await numeroPie(page)).toBe(noLeidas);
      // Y la lista pinta tantas filas sin leer como dice el número.
      await irAPestana(page, 'No leídas');
      await expect(filas(page)).toHaveCount(noLeidas);
      await expect(page.locator('li.av-fila[data-leido="no"]')).toHaveCount(noLeidas);
      // Mismo número en otra pantalla (el pie sale de la misma bandeja, no de una segunda cuenta).
      await page.goto(id.otraPantalla);
      expect(await numeroPie(page)).toBe(noLeidas);
    });

    test('(b) cada aviso trae origen, hora y un enlace que lleva a SU pantalla', async ({ page }) => {
      await esperarAviso(page, id.ruta, id.sembrado);
      await irAPestana(page, 'Todas');
      const total = await filas(page).count();
      expect(total).toBeGreaterThan(0);
      const destinos: string[] = [];
      for (let i = 0; i < total; i++) {
        const fila = filas(page).nth(i);
        const meta = fila.locator('.av-meta');
        const metaTexto = ((await meta.textContent()) ?? '').trim();
        // Origen legible: ni vacío ni el comodín «Otro origen» (señal de una fuente sin rotular).
        expect(metaTexto, `fila ${i}: sin origen`).not.toMatch(/Otro origen/);
        // Hora: un <time> con fecha ISO y texto «Desde …» o «Medido a las …».
        const hora = fila.locator('time');
        await expect(hora).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
        expect(((await hora.textContent()) ?? '').trim(), `fila ${i}: sin hora`).toMatch(/\d{1,2}:\d{2}/);
        // Enlace: «Abrir» con href, o la nota explícita de que no hay pantalla.
        const enlace = abrir(fila);
        if (await enlace.count()) {
          const href = (await enlace.getAttribute('href')) ?? '';
          expect(href, `fila ${i}: enlace vacío`).toMatch(/^\//);
          destinos.push(href);
        } else {
          await expect(fila).toContainText('Sin pantalla donde resolverlo');
        }
      }
      expect(destinos.length, 'ningún aviso lleva a una pantalla').toBeGreaterThan(0);
      // Cada destino distinto abre SU pantalla: no rebota al inicio, al login ni a un error.
      for (const href of [...new Set(destinos)]) {
        const ruta = new URL(href, 'http://x').pathname;
        const r = await page.goto(href);
        expect(r?.status(), `${href} respondió error`).toBeLessThan(400);
        await expect(page, `${href} rebotó a otra pantalla`).toHaveURL(new RegExp(`${ruta.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')}`));
        await expect(page.locator('body')).not.toContainText(/Application error|Algo salió mal/i);
      }
    });

    test('(c)(d) marcar leído lo mueve a «Leídas» y baja el pie en 1 sin recargar y tras recargar; marcar no leído lo regresa', async ({ page }) => {
      await esperarAviso(page, id.ruta, id.sembrado);
      await irAPestana(page, 'No leídas');
      const antes = await conteoPestana(page, 'No leídas');
      expect(await numeroPie(page)).toBe(antes);

      // Un aviso silenciable (con botón); su título lo identifica a través de pestañas.
      const candidata = filas(page).filter({ has: page.getByRole('button', { name: 'Marcar leído' }) }).first();
      await expect(candidata).toBeVisible();
      const titulo = ((await candidata.locator('.av-titulo').textContent()) ?? '').trim();
      await botonLeido(candidata).click();

      // SIN recargar: sale de «No leídas», el conteo y el pie bajan en 1.
      await expect(filas(page).filter({ hasText: titulo })).toHaveCount(0);
      await expect.poll(() => conteoPestana(page, 'No leídas')).toBe(antes - 1);
      await expect.poll(() => numeroPie(page), { message: 'el pie no bajó sin recargar' }).toBe(antes - 1);
      await irAPestana(page, 'Leídas');
      await expect(filas(page).filter({ hasText: titulo })).toHaveCount(1);
      await expect(filas(page).filter({ hasText: titulo }).first()).toHaveAttribute('data-leido', 'si');

      // En la BASE, no solo en la pantalla.
      await expect.poll(async () => (await leidasEnBase(userId)).length).toBe(1);

      // Tras recargar sigue leído y el pie sigue en antes-1.
      await page.reload();
      await listaLista(page);
      expect(await numeroPie(page)).toBe(antes - 1);
      expect(await conteoPestana(page, 'No leídas')).toBe(antes - 1);
      await irAPestana(page, 'Leídas');
      await expect(filas(page).filter({ hasText: titulo })).toHaveCount(1);

      // (d) Marcar como no leído lo regresa, también en la base.
      await botonLeido(filas(page).filter({ hasText: titulo }).first()).click();
      await expect(filas(page).filter({ hasText: titulo })).toHaveCount(0);
      await expect.poll(() => numeroPie(page), { message: 'el pie no subió al desmarcar' }).toBe(antes);
      await expect.poll(async () => (await leidasEnBase(userId)).length).toBe(0);
      await irAPestana(page, 'No leídas');
      await expect(filas(page).filter({ hasText: titulo })).toHaveCount(1);
      await page.reload();
      expect(await numeroPie(page)).toBe(antes);
    });

    test('(e) «Marcar todo como leído» deja «No leídas» sin nada que se pueda quitar, y explica lo que no', async ({ page }) => {
      await esperarAviso(page, id.ruta, id.sembrado);
      await irAPestana(page, 'No leídas');
      const antes = await conteoPestana(page, 'No leídas');
      await page.getByRole('button', { name: 'Marcar todo como leído' }).click();

      // Lo que queda sin leer es exactamente lo fijo (plazo legal, SLA vencido, fuente ciega, sistema caído).
      await expect.poll(async () => {
        const n = await filas(page).count();
        for (let i = 0; i < n; i++) if (!(await esFija(filas(page).nth(i)))) return -1;
        return n;
      }, { message: 'quedaron avisos silenciables sin leer' }).toBeGreaterThanOrEqual(0);
      const quedan = await filas(page).count();
      expect(await conteoPestana(page, 'No leídas')).toBe(quedan);
      await expect.poll(() => numeroPie(page)).toBe(quedan);

      if (id.tieneFijos) {
        expect(quedan, 'la consola tiene ARCO y SLA vencido: no pueden desaparecer').toBeGreaterThan(0);
        expect(quedan).toBeLessThan(antes);
        for (let i = 0; i < quedan; i++) {
          const fila = filas(page).nth(i);
          await expect(fila).toContainText('no se puede marcar como leído');
          await expect(botonLeido(fila)).toHaveCount(0);
        }
        await expect(filas(page).filter({ hasText: /ARCO/i })).not.toHaveCount(0);
      } else {
        expect(quedan).toBe(0);
        await expect(page.getByText('No hay avisos sin leer.')).toBeVisible();
        expect(await numeroPie(page)).toBe(0);
      }

      // Persistió: tras recargar es lo mismo.
      await page.reload();
      await listaLista(page);
      expect(await conteoPestana(page, 'No leídas')).toBe(quedan);
      expect(await numeroPie(page)).toBe(quedan);
      expect((await leidasEnBase(userId)).length).toBe(antes - quedan);
    });

    test('(f) los filtros por tipo y por severidad recortan de verdad y suman el total', async ({ page }) => {
      await esperarAviso(page, id.ruta, id.sembrado);
      await irAPestana(page, 'Todas');
      const total = await filas(page).count();
      const todosTitulos = await titulos(page);
      expect(total).toBeGreaterThan(1);

      // Por severidad: cada fila filtrada lleva SU chip, y la suma de las tres es el total.
      let suma = 0;
      for (const [valor, rotulo] of [['critica', 'Crítico'], ['atencion', 'Atención'], ['info', 'Informativo']] as const) {
        await selectSeveridad(page).selectOption(valor);
        const n = await filas(page).count();
        suma += n;
        for (let i = 0; i < n; i++) await expect(filas(page).nth(i).locator('.av-meta')).toContainText(rotulo);
        if (n === 0) await expect(page.getByText('Ningún aviso coincide con los filtros.')).toBeVisible();
      }
      expect(suma, 'las severidades no suman el total').toBe(total);
      await selectSeveridad(page).selectOption('todas');

      // Por tipo: lo mismo con las categorías del panel.
      const valores = await selectTipo(page).locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== 'todas'));
      expect(valores.length).toBeGreaterThan(1);
      let sumaTipos = 0;
      const vistos: string[] = [];
      for (const v of valores) {
        await selectTipo(page).selectOption(v);
        const n = await filas(page).count();
        sumaTipos += n;
        vistos.push(...(await titulos(page)));
        if (v === id.tipoSilenciable.valor) expect(n, `el tipo ${v} debería traer lo sembrado`).toBeGreaterThan(0);
      }
      expect(sumaTipos, 'los tipos no suman el total').toBe(total);
      expect([...vistos].sort()).toEqual([...todosTitulos].sort());

      // «Limpiar filtros» restaura todo.
      await selectTipo(page).selectOption(id.tipoSilenciable.valor);
      await page.getByRole('button', { name: 'Limpiar filtros' }).click();
      await expect(filas(page)).toHaveCount(total);
    });

    test('(g) apagar un tipo lo oculta de la lista y del conteo (salvo lo fijo) y persiste; el horario de silencio se guarda', async ({ page }) => {
      await esperarAviso(page, id.ruta, id.sembrado);
      await irAPestana(page, 'Todas');

      // Cuántos avisos del tipo son silenciables y cuántos fijos, ANTES.
      await selectTipo(page).selectOption(id.tipoSilenciable.valor);
      const delTipo = await filas(page).count();
      let fijos = 0;
      for (let i = 0; i < delTipo; i++) if (await esFija(filas(page).nth(i))) fijos += 1;
      const silenciables = delTipo - fijos;
      expect(silenciables, 'hace falta un aviso silenciable de este tipo para probar el apagado').toBeGreaterThan(0);
      await selectTipo(page).selectOption('todas');
      const totalAntes = await filas(page).count();
      const pieAntes = await numeroPie(page);
      const noLeidasAntes = await conteoPestana(page, 'No leídas');

      // Apagar el tipo «en la app».
      await page.goto(`${id.ruta}?seccion=configuracion`);
      const casilla = page.getByRole('checkbox', { name: `${id.tipoSilenciable.etiqueta} · En la app` });
      await expect(casilla).toBeChecked();
      await casilla.uncheck();
      await expect(page.getByText('Preferencia guardada.')).toBeVisible();
      await expect.poll(async () => (await preferenciasEnBase(userId)).filter((p) => p.categoria === id.tipoSilenciable.valor && p.canal === 'app' && !p.activo).length).toBe(1);

      // La lista y el conteo pierden SOLO los silenciables de ese tipo.
      await page.goto(id.ruta);
      await listaLista(page);
      await irAPestana(page, 'Todas');
      await expect(filas(page)).toHaveCount(totalAntes - silenciables);
      expect(await conteoPestana(page, 'No leídas')).toBe(noLeidasAntes - silenciables);
      expect(await numeroPie(page)).toBe((pieAntes ?? 0) - silenciables);
      await selectTipo(page).selectOption(id.tipoSilenciable.valor);
      await expect(filas(page)).toHaveCount(fijos);
      for (let i = 0; i < fijos; i++) await expect(filas(page).nth(i)).toContainText('no se puede marcar como leído');

      // Persiste tras recargar la sesión del navegador.
      await page.reload();
      await listaLista(page);
      expect(await numeroPie(page)).toBe((pieAntes ?? 0) - silenciables);
      await page.goto(`${id.ruta}?seccion=configuracion`);
      await expect(page.getByRole('checkbox', { name: `${id.tipoSilenciable.etiqueta} · En la app` })).not.toBeChecked();

      // Volver a encenderlo regresa los avisos.
      await page.getByRole('checkbox', { name: `${id.tipoSilenciable.etiqueta} · En la app` }).check();
      await expect(page.getByText('Preferencia guardada.')).toBeVisible();
      await page.goto(id.ruta);
      await irAPestana(page, 'Todas');
      await expect(filas(page)).toHaveCount(totalAntes);

      // Horario de silencio: se guarda en la base y se relee.
      await page.goto(`${id.ruta}?seccion=configuracion`);
      const interruptor = page.getByRole('switch', { name: /No avisar por correo ni WhatsApp/ });
      await expect(interruptor).not.toBeChecked();
      await interruptor.check({ force: true }); // la pista visual cubre al input: el clic real cae en el <label>
      await page.getByLabel('Desde', { exact: true }).fill('21:30');
      await page.getByLabel('Hasta', { exact: true }).fill('06:45');
      await page.getByRole('switch', { name: /Dejar pasar los avisos críticos/ }).uncheck({ force: true });
      await page.getByRole('button', { name: 'Guardar horario' }).click();
      await expect(page.getByText('Horario guardado.')).toBeVisible();
      await expect.poll(() => silencioEnBase(userId)).toMatchObject({ activo: true, permite_criticos: false, desde: expect.stringMatching(/^21:30/), hasta: expect.stringMatching(/^06:45/) });
      await page.reload();
      await expect(page.getByRole('switch', { name: /No avisar por correo ni WhatsApp/ })).toBeChecked();
      await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('21:30');
      await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('06:45');
      await expect(page.getByRole('switch', { name: /Dejar pasar los avisos críticos/ })).not.toBeChecked();

      // Un horario vacío (desde = hasta) se rechaza y lo dice.
      await page.getByLabel('Hasta', { exact: true }).fill('21:30');
      await page.getByRole('button', { name: 'Guardar horario' }).click();
      await expect(page.getByText('El horario no es válido')).toBeVisible();
      expect((await silencioEnBase(userId))?.hasta).toMatch(/^06:45/);
    });

    test('(g2) las casillas de la matriz caen bajo la cabecera de su columna', async ({ page }) => {
      await page.goto(`${id.ruta}?seccion=configuracion`);
      const cabeceras = page.locator('table.av-matriz thead th');
      await expect(cabeceras).toHaveCount(4);
      const centros: number[] = [];
      for (let c = 1; c < 4; c++) {
        const b = (await cabeceras.nth(c).boundingBox())!;
        centros.push(b.x + b.width / 2);
      }
      const filasMatriz = page.locator('table.av-matriz tbody tr');
      const n = await filasMatriz.count();
      expect(n).toBeGreaterThan(0);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < 3; c++) {
          const caja = (await filasMatriz.nth(r).locator('td').nth(c).locator('input[type="checkbox"]').boundingBox())!;
          expect(Math.abs(caja.x + caja.width / 2 - centros[c]), `fila ${r}, columna ${c + 1}: la casilla no cae bajo su cabecera`).toBeLessThanOrEqual(6);
        }
      }
    });

    test('(k) hay UN solo nivel de pestañas de sección en la pantalla de avisos', async ({ page }) => {
      for (const url of [id.ruta, `${id.ruta}?seccion=configuracion`]) {
        await page.goto(url);
        await expect(page.getByRole('navigation', { name: /^Secciones de/ })).toHaveCount(1);
      }
      // Y desde la pantalla se llega a la otra sección y se vuelve.
      await page.goto(id.ruta);
      await listaLista(page);
      const cuerpo = page.locator('#contenido-principal');
      await cuerpo.getByRole('link', { name: 'Configuración', exact: true }).click();
      await expect(page).toHaveURL(/seccion=configuracion/);
      await expect(page.getByRole('button', { name: 'Guardar horario' })).toBeVisible();
      await page.locator('#contenido-principal').getByRole('link', { name: /^Avisos/ }).last().click();
      await listaLista(page);
    });

    test('(j) lista y configuración se abren sin errores de consola', async ({ page }) => {
      await page.goto(id.ruta);
      await listaLista(page);
      await page.goto(`${id.ruta}?seccion=configuracion`);
      await expect(page.getByRole('button', { name: 'Guardar horario' })).toBeVisible();
      await page.goto(id.otraPantalla);
      await numeroPie(page);
    });
  });
}

test.describe('avisos · aislamiento (h)', () => {
  test.describe.configure({ mode: 'serial' });

  test('la dueña de la flota A y la intrusa de la B solo ven lo suyo, y ninguna ve lo de la consola', async ({ browser }) => {
    const lectura = async (estado: string, ruta: string) => {
      const ctx = await browser.newContext({ storageState: estado, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' });
      const page = await ctx.newPage();
      await esperarAviso(page, ruta, /comprobantes? lleg/i);
      const ts = await titulos(page);
      const pie = await numeroPie(page);
      const noLeidas = await conteoPestana(page, 'No leídas');
      await ctx.close();
      return { ts, pie, noLeidas };
    };
    const duena = await lectura(ESTADOS.duena, '/dashboard/notificaciones');
    const intrusa = await lectura(ESTADOS.intrusa, '/dashboard/notificaciones');

    // A tiene 2 huérfanos y 1 viaje escalado; B solo 1 huérfano y ningún escalado.
    expect(duena.ts.join(' | ')).toMatch(/2 comprobantes llegaron sin viaje/);
    expect(duena.ts.join(' | ')).toMatch(/viaje escalado/);
    expect(intrusa.ts.join(' | ')).toMatch(/1 comprobante llegó sin viaje/);
    expect(intrusa.ts.join(' | ')).not.toMatch(/2 comprobantes|escalado/);
    expect(duena.ts.join(' | ')).not.toMatch(/1 comprobante llegó/);
    // Nadie del cliente ve cosas de la consola (ARCO, SLA, crons, costos de IA, flotas).
    for (const lista of [duena.ts, intrusa.ts]) expect(lista.join(' | ')).not.toMatch(/\bARCO\b|\bSLA\b|\bcrons?\b|costo de IA|proveedor de IA|Solicitudes|Tickets? de soporte/i);
    // El pie de cada quien es el de SU bandeja.
    expect(duena.pie).toBe(duena.noLeidas);
    expect(intrusa.pie).toBe(intrusa.noLeidas);
    expect(duena.noLeidas).not.toBe(intrusa.noLeidas);
  });

  test('un usuario de flota no abre /admin/notificaciones', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ESTADOS.duena, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' });
    const page = await ctx.newPage();
    await page.goto('/admin/notificaciones');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('body')).not.toContainText(/Solicitudes ARCO/);
    await ctx.close();
  });

  test('«Ver como» del superadmin muestra los avisos de ESA flota y el pie no trae el conteo de otra', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ESTADOS.superadmin, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' });
    const page = await ctx.newPage();
    await esperarAviso(page, `/dashboard/notificaciones?tenant=${TENANT_B}`, /comprobantes? lleg/i);
    const ts = (await titulos(page)).join(' | ');
    expect(ts).toMatch(/1 comprobante llegó sin viaje/);
    expect(ts).not.toMatch(/2 comprobantes|escalado|ARCO/);
    // El pie del panel con «ver como» no lleva cifra (o, si la lleva, es la de la flota que se mira, nunca la de otra).
    const etiqueta = (await page.locator('a.rv-ps-avisos').first().getAttribute('aria-label')) ?? '';
    expect(etiqueta).not.toMatch(/\b[2-9]\d* pendientes/);
    // Y con la flota A se ven SUS avisos, no los de B.
    await esperarAviso(page, `/dashboard/notificaciones?tenant=${TENANT_A}`, /comprobantes? lleg/i);
    const ta = (await titulos(page)).join(' | ');
    expect(ta).toMatch(/2 comprobantes llegaron sin viaje/);
    expect(ta).not.toMatch(/1 comprobante llegó/);
    await ctx.close();
  });
});
