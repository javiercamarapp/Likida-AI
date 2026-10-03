import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderizarDocVerificacion } from './doc_verificacion';
import { GUIONES } from '../facturacion/adaptadores/portales';
import { REGISTRO_VERIFICACIONES } from './registro_verificaciones';
import { huellaDeGuion, sha256Texto } from './verificacion';

const manifiesto = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/likida/facturacion/adaptadores/fixtures/manifest.json'), 'utf8'));

describe('docs/operacion/verificacion-portales.md', () => {
  it('es exactamente el render del estado real (regenerar con npx tsx scripts/generar-doc-verificacion.ts)', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/operacion/verificacion-portales.md'), 'utf8');
    expect(doc).toBe(renderizarDocVerificacion(GUIONES, REGISTRO_VERIFICACIONES, manifiesto));
  });
  it('dice la verdad del estado: hoy 0 de 21 verificados, y una entrada vigente se refleja', () => {
    expect(renderizarDocVerificacion(GUIONES, REGISTRO_VERIFICACIONES, manifiesto)).toContain('0 de 21 guiones verificados');
    const g = GUIONES[0];
    const e = { fecha: '2026-10-02', nivel: 'prevuelo' as const, huellaGuion: huellaDeGuion(g), arnes: 'x', resueltos: ['a'], confirmadoPor: 'Javier', evidencia: { reporte: 'r', sha256: sha256Texto('r') } };
    const doc = renderizarDocVerificacion(GUIONES, { [g.comercio]: e }, manifiesto);
    expect(doc).toContain('1 de 21 guiones verificados');
    expect(doc).toContain('verificado 2026-10-02 (prevuelo, por Javier)');
    expect(renderizarDocVerificacion(GUIONES, { [g.comercio]: { ...e, huellaGuion: 'a'.repeat(64) } }, manifiesto)).toContain('OBSOLETO');
  });
});
