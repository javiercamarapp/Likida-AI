/**
 * Ayudas para recorrer la NAVEGACIÓN sin asumir qué shell sirve el panel (v1 o v2).
 *
 * En v1 el menú vive en un `<aside>` siempre presente (riel de íconos en el teléfono). En v2, bajo 768 px el aside NO se ve
 * (breakpoints disjuntos: una sola navegación visible) y el árbol completo está en la hoja «Más» de la cabecera móvil.
 * `abrirNavegacion` devuelve el contenedor donde BUSCAR enlaces del menú, abriendo la hoja si hace falta, para que una
 * prueba escrita contra el menú no dependa del shell.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export async function abrirNavegacion(page: Page): Promise<Locator> {
  const aside = page.locator('aside');
  if (await aside.first().isVisible().catch(() => false)) return aside.first();
  // v2 en teléfono: el botón «Más» abre la hoja modal con el árbol completo.
  await page.getByRole('button', { name: /Más/ }).tap();
  const hoja = page.getByRole('dialog', { name: 'Menú completo' });
  await expect(hoja).toBeVisible();
  return hoja;
}
