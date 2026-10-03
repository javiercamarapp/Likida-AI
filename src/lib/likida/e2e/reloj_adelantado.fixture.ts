import { afterAll, beforeAll, vi } from 'vitest';

// GUARDIA DEL RELOJ DE LA CORRIDA. Los e2e simulan "ahora" con fechas fijas (AHORA) y el último
// entrante de cada contacto en torno a esa fecha. Un llamador de `enviarConFallback` /
// `ventanaDeContacto` que omita `ahora` cae a `new Date()`: con el reloj real pasaba mientras la
// fecha simulada seguía a <24 h y reventaba cuando CI corría días después (plantilla en vez de
// texto, cuerpo ''). Aquí el reloj del PROCESO queda 30 días adelante: si algún camino omite el
// `ahora` de la corrida, la ventana sale cerrada y la prueba falla HOY, no el día que se acaban
// las 24 h. Solo se falsea `Date`; los temporizadores siguen reales.
const TREINTA_DIAS = 30 * 86_400_000;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + TREINTA_DIAS });
});
afterAll(() => {
  vi.useRealTimers();
});
