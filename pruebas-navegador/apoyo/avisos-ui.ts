/**
 * Ayudas de la suite de avisos: leer el número del pie, las pestañas y las filas SIN asumir el shell, y esperar por condición
 * (nada de `waitForTimeout`). El número del pie solo existe en la UI v2; por eso la suite fija v2 antes de empezar.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const PIE = 'a.rv-ps-avisos';

/** El pie «Avisos»: en escritorio vive en el sidebar; en el teléfono, dentro de la hoja «Más». */
export function pie(page: Page): Locator {
  return page.locator(PIE).first();
}

/** El número del pie (el total de su etiqueta accesible); «nada pendiente» = 0; «sin dato» = null (nunca se confunde con 0). */
export async function numeroPie(page: Page): Promise<number | null> {
  const enlace = pie(page);
  await expect(enlace).toBeAttached();
  const etiqueta = (await enlace.getAttribute('aria-label')) ?? '';
  if (/sin dato/i.test(etiqueta)) return null;
  // El pie es un punto de no leídos (sin cifra): el total vive en la etiqueta accesible («Avisos: 5 pendientes…»).
  const m = /(\d+)\s+pendiente/i.exec(etiqueta);
  if (!m) {
    expect(etiqueta, 'sin total en la etiqueta, el pie debe decir que no hay nada pendiente').toMatch(/nada pendiente/i);
    return 0;
  }
  return Number.parseInt(m[1], 10);
}

export type Pestana = 'No leídas' | 'Leídas' | 'Todas';

/** El botón (radio) de una pestaña del segmentado. */
export function pestana(page: Page, nombre: Pestana): Locator {
  return page.getByRole('radio', { name: new RegExp(`^${nombre}`) });
}

export async function conteoPestana(page: Page, nombre: Pestana): Promise<number> {
  const texto = (await pestana(page, nombre).locator('.rv-seg__conteo').textContent()) ?? '';
  return Number.parseInt(texto.trim(), 10);
}

export async function irAPestana(page: Page, nombre: Pestana): Promise<void> {
  await pestana(page, nombre).click();
  await expect(pestana(page, nombre)).toHaveAttribute('aria-checked', 'true');
}

export function filas(page: Page): Locator {
  return page.locator('ul.av-lista > li.av-fila');
}

/** Títulos de las filas visibles, en orden. */
export async function titulos(page: Page): Promise<string[]> {
  return (await filas(page).locator('.av-titulo').allTextContents()).map((t) => t.trim());
}

/** Espera a que la lista termine de cargar (hay filas, o el estado vacío). */
export async function listaLista(page: Page): Promise<void> {
  await expect(page.locator('ul.av-lista, [data-estado="vacio"], .rv-estado, :text("No hay")').first()).toBeVisible();
  await expect(pestana(page, 'No leídas')).toBeVisible();
}

export function selectTipo(page: Page): Locator {
  return page.getByLabel('Tipo', { exact: true });
}

export function selectSeveridad(page: Page): Locator {
  return page.getByLabel('Severidad', { exact: true });
}

/** Los avisos del servidor viven 45 s en caché: espera (recargando) a que aparezca un título. */
export async function esperarAviso(page: Page, url: string, titulo: RegExp, ms = 75_000): Promise<void> {
  await expect(async () => {
    await page.goto(url);
    await irAPestana(page, 'Todas');
    await expect(filas(page).filter({ hasText: titulo }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: ms, intervals: [3_000] });
}

/** El enlace «Abrir» y el botón de marcar de una fila. */
export const abrir = (fila: Locator): Locator => fila.getByRole('link', { name: 'Abrir' });
export const botonLeido = (fila: Locator): Locator => fila.getByRole('button', { name: /^Marcar (no )?leído$/ });

/** ¿La fila es de las que NO se pueden marcar leídas? (lleva la nota fija y no tiene botón). */
export async function esFija(fila: Locator): Promise<boolean> {
  return (await fila.locator('.av-nota', { hasText: 'no se puede marcar como leído' }).count()) > 0;
}

/** Errores de consola y de página durante un tramo de la prueba. Se ignora el ruido del proxy local de Next (HMR no existe en start). */
export function vigilarConsola(page: Page): { errores: string[] } {
  const errores: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  return { errores };
}

/** La versión de interfaz se lee con caché de 30 s (perfil_tenant): tras fijar v2 en la base, espera a que el chrome ya sea v2. */
export async function esperarChromeV2(page: Page, ruta = '/dashboard'): Promise<void> {
  await expect.poll(async () => {
    await page.goto(ruta);
    return page.locator('[data-ui="v2"]').count();
  }, { message: 'el chrome v2 no llegó (caché de la versión de interfaz)', timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0);
}
