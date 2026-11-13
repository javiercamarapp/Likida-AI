/**
 * Ayudas del REGISTRO DE VIAJES (/dashboard/viajes) tras el rediseño F26: la fila ya no lleva un enlace «Ver» directo a la liquidación;
 * lleva «Vista rápida» (`?ver=<id>`), que abre un cajón, y el cajón cierra con «Abrir viaje», que lleva a la ficha de la liquidación.
 * El contrato que estas pruebas cuidan no cambió: desde el registro se llega, por la UI y sin teclear URLs, al detalle de la liquidación.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** Desde `/dashboard/viajes` abre el detalle de la liquidación del viaje `folio` (fila → «Vista rápida» → «Abrir viaje»). */
export async function abrirDetalleDeViaje(page: Page, folio: string): Promise<void> {
  await page.locator('tr', { hasText: folio }).getByRole('link', { name: 'Vista rápida' }).click();
  const cajon = page.getByRole('dialog', { name: folio });
  await expect(cajon).toBeVisible();
  await cajon.getByRole('link', { name: 'Abrir viaje', exact: true }).click();
}

/** El estado del registro es un segmentado de enlaces (`<nav aria-label="Estado">`), no un menú desplegable. */
export function filtroEstado(page: Page, rotulo: string) {
  return page.getByRole('navigation', { name: 'Estado' }).getByRole('link', { name: rotulo, exact: true });
}

/**
 * «Nuevo viaje» en Despacho: el formulario vive en un cajón lateral (`CajonAlta`, F26) que abre el botón primario de la cabecera. Devuelve el
 * formulario YA visible. El clic se reintenta hasta que el cajón abre: antes de hidratar, el botón no hace nada.
 */
export async function abrirNuevoViaje(page: Page): Promise<Locator> {
  const cajon = page.getByRole('dialog', { name: 'Nuevo viaje' });
  await expect(async () => {
    if (!(await cajon.isVisible())) await page.getByRole('button', { name: 'Nuevo viaje', exact: true }).click({ timeout: 2_000 });
    await expect(cajon).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return page.locator('form:has(button:has-text("Crear viaje"))');
}

/** «Importar desde tu TMS»: ya no es un plegable `<summary>`, es un botón de la cabecera que abre un cajón (`CajonAlta`, F26) con el mismo formulario de importación. */
export async function abrirImportarTms(page: Page): Promise<void> {
  const cajon = page.getByRole('dialog', { name: 'Importar desde tu TMS' });
  await expect(async () => {
    if (!(await cajon.isVisible())) await page.getByRole('button', { name: 'Importar desde tu TMS', exact: true }).click({ timeout: 2_000 });
    await expect(cajon).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
