// ═══════════════════════════════════════════════════════════════════════════
// LA MATRIZ ESPERADA (campo × muestra) — congelada.
//
// Sale de `08 §2` («qué trae cada muestra de lo que necesita el CCP»): ✔ → `ok`, ◐ → `revisar`, ✗ → `falta`.
// Los VALORES son inventados con la misma forma que los de las muestras: aquí no hay un solo dato real.
//
// Cómo leer una celda:
//   · `estado` es lo que ESTA forma de documento da con el módulo tal como está. Si cambia (alguien rompe una conversión,
//     un perfil deja de leer una ruta, el modelo empieza a inventar), la prueba falla y dice qué campo.
//   · En las celdas `revisar` el `valor` es el que el módulo debe CONSERVAR para que una persona lo confirme (p. ej.
//     una cifra ambigua que NO cuadra con la suma de las mercancías no se adivina; la que sí cuadra se resuelve CON NOTA (T-A3-68 b)).
//   · `brecha` anota dónde `08 §2` marcaba ◐ y el módulo hoy da ✔ o ✗ (lo que todavía no distingue).
//
// Renglones de mercancía: se evalúa el renglón 0 (`mercancias[0].…`) y el número de renglones (`n_mercancias`).
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoEsperado } from './evaluar';
import type { IdMuestra } from './dorado.fixture';
import { JSON_M1, M2, M3, M4, M5, RFC_DORADO } from './dorado.fixture';

const ok = (campo: string, valor: string): CampoEsperado => ({ campo, valor, estado: 'ok' });
const rev = (campo: string, valor: string): CampoEsperado => ({ campo, valor, estado: 'revisar' });
const falta = (campo: string, valor: string | null = null, brecha?: string): CampoEsperado => ({ campo, valor, estado: 'falta', ...(brecha ? { brecha } : {}) });
const conBrecha = (c: CampoEsperado, brecha: string): CampoEsperado => ({ ...c, brecha });

const m0 = (clave: string): string => `mercancias[0].${clave}`;

/** Lo que el módulo no sabe distinguir aún: el embalaje que es de otro catálogo (sin c_TipoEmbalaje cargado). */
const BRECHA_EMBALAJE_M5 = '08 §2 marca ◐: «XBX» es una clave de unidad, no de embalaje. El módulo valida la forma (2-3 caracteres), no el catálogo c_TipoEmbalaje.';

export const MATRIZ_DORADA: Readonly<Record<IdMuestra, ReadonlyArray<CampoEsperado>>> = Object.freeze({
  M1: [
    ok('folio_cliente', JSON_M1.folio),
    ok('origen_rfc', RFC_DORADO.m1Remitente),
    falta('destino_rfc'),
    falta('distancia_km'),
    ok('peso_bruto_total', '12690'),
    ok(m0('bienes_transp'), '24112100'),
    ok(m0('descripcion'), 'Estructura metálica tipo A'),
    ok(m0('cantidad'), '52'),
    ok(m0('clave_unidad'), 'H87'),
    ok(m0('peso_kg'), '9210'),
    ok(m0('fraccion_arancelaria'), '7308900100'), // grep-limpio:ok
    ok(m0('embalaje'), 'Z01'),
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '2'),
  ],
  M2: [
    falta('folio_cliente', null, '08 §2 marca ◐ («Load/Pro Number» vacío): la celda viene vacía, así que no hay nada que leer.'),
    ok('origen_rfc', RFC_DORADO.m2Remitente),
    rev('destino_rfc', '58-1234567'), // ID fiscal de EE. UU. con su guion (T-A3-49); sin país declarado en la hoja sigue el rigor mexicano y se bloquea por forma
    rev('distancia_km', '812.35'), // «812,35 km»: coma decimal y unidad pegada
    ok('peso_bruto_total', '13020'),
    ok(m0('bienes_transp'), M2.clave),
    ok(m0('descripcion'), M2.descripcion),
    ok(m0('cantidad'), M2.cantidad),
    ok(m0('clave_unidad'), M2.unidad),
    ok(m0('peso_kg'), M2.kilos),
    ok(m0('fraccion_arancelaria'), '8471500100'), // grep-limpio:ok
    rev(m0('embalaje'), M2.embalaje), // «5H4» (sacos) con racks: 08 §2 lo marca ◐; desde T-A3-24 el módulo pide confirmarlo
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '1'),
  ],
  M3: [
    ok('folio_cliente', M3.remision),
    rev('fecha_salida', '2026-10-07'), // 07/10/2026: día/mes o mes/día, el documento no lo dice
    falta('origen_rfc', RFC_DORADO.m3Remitente), // sin catálogo no hay RFC; con catálogo del cliente sí (ver MATRIZ_M3_CON_CATALOGO)
    falta('destino_rfc'),
    falta('distancia_km'),
    rev('peso_bruto_total', '14029'), // T-A3-68 b: «14.029» (punto de MILES junto a renglones con punto DECIMAL) se resuelve CONTRA LA SUMA de los renglones, con nota, y sigue ◐ (una persona la confirma); antes quedaba «14.029»
    falta(m0('bienes_transp'), '25172500'),
    ok(m0('descripcion'), 'LLANTA RADIAL LL-C01 TL'),
    ok(m0('cantidad'), '80'),
    rev(m0('clave_unidad'), 'H87'), // «PZA» traducido a H87
    ok(m0('peso_kg'), '1275.36'),
    falta(m0('fraccion_arancelaria'), '4011100100'), // grep-limpio:ok
    falta(m0('embalaje'), '1A'),
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '14'),
  ],
  M4: [
    ok('folio_cliente', M4.bol),
    ok('fecha_salida', '2026-10-12'),
    rev('origen_rfc', RFC_DORADO.m4Remitente), // en «Notes», el RFC del fiscal: no es seguro que sea el del remitente
    falta('destino_rfc'),
    falta('distancia_km'),
    ok('peso_bruto_total', '6577.997'), // suma de renglones YA convertidos a kg
    rev(m0('bienes_transp'), '39231003'),
    ok(m0('descripcion'), M4.descripcion),
    ok(m0('cantidad'), M4.piezas),
    rev(m0('clave_unidad'), '20'), // «20» no es una clave c_ClaveUnidad
    rev(m0('peso_kg'), '6577.997'), // 14 502 lb × 0.45359237
    rev(m0('fraccion_arancelaria'), '3923100301'), // grep-limpio:ok
    rev(m0('embalaje'), '1'),
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '1'),
  ],
  M5: [
    ok('folio_cliente', M5.delivery),
    ok('fecha_salida', '2026-10-14'), // 10/14/2026 con el perfil mes/día
    ok('origen_rfc', RFC_DORADO.m5Remitente),
    ok('destino_rfc', RFC_DORADO.m5DestinatarioFisica),
    falta('distancia_km'),
    ok('peso_bruto_total', '17132.9'),
    ok(m0('bienes_transp'), M5.productos[0].clave),
    ok(m0('descripcion'), M5.productos[0].descripcion),
    ok(m0('cantidad'), M5.productos[0].cantidad),
    ok(m0('clave_unidad'), M5.productos[0].unidad),
    ok(m0('peso_kg'), M5.productos[0].kilos),
    ok(m0('fraccion_arancelaria'), M5.productos[0].fraccion),
    conBrecha(ok(m0('embalaje'), M5.productos[0].embalaje), BRECHA_EMBALAJE_M5),
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '2'),
  ],
});

/** M3 con el catálogo sintético del cliente cargado: el RFC del remitente y lo que el catálogo sabe del SKU pasan de ✗ a ✔. */
export const MATRIZ_M3_CON_CATALOGO: ReadonlyArray<CampoEsperado> = Object.freeze(
  MATRIZ_DORADA.M3.map((c): CampoEsperado => (
    ['origen_rfc', m0('bienes_transp'), m0('fraccion_arancelaria'), m0('embalaje')].includes(c.campo) ? { ...c, estado: 'ok' } : c
  )),
);
