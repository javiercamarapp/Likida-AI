import { chromium, type Browser } from 'playwright';

// Las pruebas de comportamiento real corren en Chromium. SIN Chromium NO se dan por buenas: el lanzamiento FALLA con un
// mensaje claro. Solo `UI2_SIN_NAVEGADOR=1` las omite, de forma explícita (vitest las marca «skipped», nunca verdes).
export const SIN_NAVEGADOR = process.env.UI2_SIN_NAVEGADOR === '1';

export async function lanzarNavegador(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (e) {
    throw new Error(`Sin Chromium de Playwright (npx playwright install chromium). UI2_SIN_NAVEGADOR=1 las omite a propósito. Causa: ${String(e).slice(0, 200)}`);
  }
}
