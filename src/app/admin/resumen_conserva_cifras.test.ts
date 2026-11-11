/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos fuente del propio repo */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admin_inicio } from '@/lib/i18n/es/admin_inicio';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// F2 · P-RES: el Resumen es ahora el Centro de Mando y absorbe lo que enseñaban /admin/ejecutivo y /admin/analitica (que pasan a
// 308). Antes de retirarlas se FIJA aquí que el Resumen conserva: el MRR (`getMrr`) con su sinDato, `esSoloDemo` contra el tenant demo,
// el total histórico de facturas y las facturas por día. Se vigila el FUENTE, mismo patrón que `tenants_reales.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const leer = (r: string) => readFileSync(fileURLToPath(new URL(r, import.meta.url)), 'utf8');
const CONSOLA = leer('./consola.tsx');
const LECTURAS = leer('./resumen-lecturas.ts');
const MANDO = leer('./resumen-mando.tsx');

describe('el Resumen conserva lo de Ejecutivo y Analítica', () => {
  it('MRR: lee getMrr(), con la meta de $1,000,000 y la leyenda de plan sin precio', () => {
    expect(LECTURAS).toMatch(/getMrr\(\)/);
    expect(CONSOLA).toMatch(/mrr\.totalMxn/);
    // Los rótulos viven en el diccionario es (admin_inicio); el código solo apunta a su clave.
    expect(admin_inicio['consola.mrr_meta_1_000']).toMatch(/meta \$1,000,000/);
    expect(admin_inicio['consola.algun_plan_activo_no']).toMatch(/no tiene precio configurado/);
    expect(CONSOLA).toMatch(/consola\.mrr_meta_1_000/);
  });
  it('MRR caído no se pinta como 0: la lectura que falla es una cifra en error', () => {
    expect(CONSOLA).toMatch(/mrr === null\s*\?\s*\{ etiqueta: 'MRR', valor: null, \.\.\.ERROR_CIFRA/);
  });
  it('esSoloDemo se comprueba contra el id real del tenant demo', () => {
    expect(CONSOLA).toMatch(/r\.tenants === 1 && r\.flotas\[0\]\?\.id === tenantDemo\(\)/);
    expect(CONSOLA).toMatch(/\{esSoloDemo && \(/);
  });
  it('facturas: total histórico y por día salen de getResumenNegocio', () => {
    expect(CONSOLA).toMatch(/r\.facturasTotal/);
    expect(CONSOLA).toMatch(/r\.facturasPorDia/);
    expect(LECTURAS).toMatch(/getResumenNegocio\(undefined, VENTANA_FACTURAS_DIAS\)/);
  });
  it('el rótulo de la ventana es verdad: dice los mismos días que se piden', () => {
    expect(admin_inicio['consola.facturas_procesadas_por_dia']).toMatch(/últimos \{VENTANA_FACTURAS_DIAS\} días/);
    expect(CONSOLA).toMatch(/consola\.facturas_procesadas_por_dia', \{ VENTANA_FACTURAS_DIAS \}/);
  });
  it('el costo de IA histórico y por día sigue en el Resumen', () => {
    expect(MANDO).toMatch(/r\.costoIaUsd/);
    expect(CONSOLA).toMatch(/r\.porDia/);
  });
});

describe('cero cifras caídas pintadas como 0, cero kit viejo', () => {
  it('cada lectura cae por su lado a null', () => {
    expect(LECTURAS).toMatch(/sinLanzar/);
  });
  it('sin .card, style=, emojis ni kit viejo en los archivos del Resumen', () => {
    for (const src of [CONSOLA, MANDO]) {
      expect(src).not.toMatch(/className="card/);
      expect(src).not.toMatch(/style=\{\{/);
      expect(src).not.toMatch(/StatCard|StatusPill|TituloSeccion|BarraPagina|admin\/charts|from '\.\/charts'/);
      expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('un solo h1: el de MarcoPagina', () => {
    expect(CONSOLA).not.toMatch(/<h1/);
    expect(MANDO).not.toMatch(/<h1/);
  });
});

// El bloque Notificaciones (campana con punto rojo) salió del Resumen SOLO porque la campana viva («Avisos» del pie) la cubre en toda la consola.
describe('la campana viva cubre el bloque Notificaciones retirado', () => {
  it('el layout entrega el conteo y «Avisos» del pie lo pinta; el Resumen ya no monta la campana vieja', () => {
    const layout = leer('./layout.tsx');
    const pie = leer('./sidebar-nav.tsx');
    expect(layout).toMatch(/obtenerPanoramaAccion\(\)/);
    expect(layout).toMatch(/<ProveedorRequiereAccion valor=\{requiereAccion\}>/);
    expect(pie).toMatch(/href: '\/admin\/notificaciones'/);
    expect(pie).toMatch(/useRequiereAccion\(\)/);
    expect(CONSOLA).not.toMatch(/from '\.\/notificaciones'/);
    expect(CONSOLA).not.toMatch(/calcularAlertas/);
  });
});
