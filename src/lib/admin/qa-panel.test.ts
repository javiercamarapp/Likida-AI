// ═══════════════════════════════════════════════════════════════════════════
// LAS REDES DEL PANEL DE QA — lo que NO puede aflojarse sin que truene aquí:
//
//  1. `mediaDataUrlQA` es INALCANZABLE desde el webhook real — la verificación
//     del encargo de Fase A ("grep -rn mediaDataUrlQA src/app/api/webhook →
//     CERO líneas"), convertida en prueba permanente.
//  2. El gancho en processor.ts conserva su forma exacta de fallback
//     (`msg.mediaDataUrlQA ?? await downloadMediaAsDataUrl(...)`) en los 3
//     sitios: si alguien lo convierte en camino primario o lo borra, esto lo
//     dice antes que producción.
//  3. Las identidades sintéticas del motor respetan los guards del ejército
//     (nombre 'ZZZ ', teléfono imposible, prefijo ZZZQA-).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { nombreTenantQa, telefonoQa, prefijoMensajes, TECHO_CORRIDA_MS } from './qa-motor';
import { PREFIJO_QA } from '../../../scripts/qa-agentes/config.qa';
import { INVARIANTES, filaDesdeVeredicto } from './qa-oraculos';

const REPO = process.cwd();

function archivosDe(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta));
    else salida.push(ruta);
  }
  return salida;
}

describe('mediaDataUrlQA — el gancho de QA no toca el webhook real', () => {
  test('CERO menciones bajo src/app/api/webhook (verificación del encargo, permanente)', () => {
    const conMencion = archivosDe(join(REPO, 'src/app/api/webhook'))
      .filter((f) => readFileSync(f, 'utf8').includes('mediaDataUrlQA'));
    expect(conMencion).toEqual([]);
  });

  test('processor.ts lo usa SOLO como fallback, en exactamente 3 sitios', () => {
    const fuente = readFileSync(join(REPO, 'src/lib/likida/processor.ts'), 'utf8');
    const forma = /msg\.mediaDataUrlQA \?\? await downloadMediaAsDataUrl\(msg\.mediaId\)/g;
    expect(fuente.match(forma) ?? []).toHaveLength(3);
    // Ninguna descarga de media quedó SIN el gancho (una cuarta llamada
    // directa dejaría al panel ciego en ese camino).
    expect(fuente.match(/await downloadMediaAsDataUrl\(msg\.mediaId\)/g) ?? []).toHaveLength(3);
  });

  test('fuera del motor de QA y processor, nadie construye el campo en src/', () => {
    const permitidos = new Set([
      join(REPO, 'src/lib/likida/processor.ts'),   // la interfaz y el fallback
      join(REPO, 'src/lib/admin/qa-motor.ts'),     // el ÚNICO productor
      join(REPO, 'src/lib/admin/qa-panel.test.ts'),
    ]);
    const fuera = archivosDe(join(REPO, 'src'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !permitidos.has(f))
      .filter((f) => readFileSync(f, 'utf8').includes('mediaDataUrlQA'));
    expect(fuera).toEqual([]);
  });
});

describe('las identidades sintéticas respetan los guards del ejército', () => {
  const id = 'deadbeef-1234-4abc-8def-001122334455';

  test('el tenant SIEMPRE se llama ZZZ … (la llave de exigirTenantZZZ)', () => {
    expect(nombreTenantQa(id)).toBe('ZZZ QA deadbeef');
    expect(nombreTenantQa(id).startsWith('ZZZ ')).toBe(true);
  });

  test('el teléfono cae en el rango imposible 5215559xxxxxx, sub-rango 1–8 (ni carga-15k ni ejército)', () => {
    for (const uuid of [id, '00000000-0000-4000-8000-000000000000', 'ffffffff-ffff-4fff-8fff-ffffffffffff']) {
      const tel = telefonoQa(uuid);
      expect(tel).toMatch(/^5215559\d{6}$/);
      const sufijo = Number(tel.slice(7));
      expect(sufijo).toBeGreaterThanOrEqual(100_000); // fuera de 000001..000200 (ZZZ CARGA)
      expect(sufijo).toBeLessThan(900_000);           // fuera de 9xxxxx (ejército Fase 1)
    }
  });

  test('determinista por corrida — la reproducción usa el mismo chofer', () => {
    expect(telefonoQa(id)).toBe(telefonoQa(id));
  });

  test('el SEGUNDO chofer tiene teléfono propio, y sigue dentro del rango imposible', () => {
    // El ataque de dedup necesita dos operadores del mismo tenant. Si el
    // segundo reusara el número del primero, `resolveOperador` los cruzaría y
    // la foto repetida entraría por el MISMO viaje: el pre-check la pararía y
    // el índice de la base —lo único que este escenario vino a probar— nunca
    // se ejercitaría.
    for (const uuid of [id, '00000000-0000-4000-8000-000000000000', 'ffffffff-ffff-4fff-8fff-ffffffffffff']) {
      const uno = telefonoQa(uuid, 0);
      const dos = telefonoQa(uuid, 1);
      expect(dos).not.toBe(uno);
      expect(dos).toMatch(/^5215559\d{6}$/);
      const sufijo = Number(dos.slice(7));
      expect(sufijo).toBeGreaterThanOrEqual(100_000);
      expect(sufijo).toBeLessThan(900_000);
    }
  });

  test('los waMessageId van bajo el PREFIJO_QA del ejército, con id de corrida propio', () => {
    const p = prefijoMensajes(id);
    expect(p.startsWith(PREFIJO_QA)).toBe(true);
    expect(p).toContain('deadbeef');
  });

  test('el techo de tiempo queda DEBAJO del maxDuration de la ruta (120 s)', () => {
    expect(TECHO_CORRIDA_MS).toBeLessThan(120_000);
  });
});

describe('qa-oraculos — la metadata calca la del orquestador', () => {
  test('los 5 invariantes traen línea y severidad del diseño', () => {
    expect(Object.keys(INVARIANTES)).toHaveLength(5);
    expect(INVARIANTES['cuadre_balancea (#1)'].severidad).toBe('CRÍTICO');
    expect(INVARIANTES['dedup_comprobante (#3)'].severidad).toBe('ALTO');
    expect(INVARIANTES['huerfano_post_cierre (#4)'].severidad).toBe('ALTO');
    expect(INVARIANTES['cifras_con_fuente (#5)'].severidad).toBe('MEDIO');
    expect(INVARIANTES['bitacora_registro (#8)'].severidad).toBe('MEDIO');
    // Y son LOS MISMOS valores que INVARIANTE_DE del orquestador (no se puede
    // importar de ahí: es un archivo de vitest) — se compara contra la fuente.
    const orq = readFileSync(join(REPO, 'scripts/qa-agentes/orquestador.qa.ts'), 'utf8');
    for (const [oraculo, meta] of Object.entries(INVARIANTES)) {
      expect(orq).toContain(`'${oraculo}': { linea: '${meta.linea}', severidad: '${meta.severidad}' }`);
    }
  });

  test('filaDesdeVeredicto conserva el estado sin traducirlo (no_verificado ≠ ok)', () => {
    const fila = filaDesdeVeredicto({ oraculo: 'cuadre_balancea (#1)', estado: 'no_verificado', esperado: 'x', real: 'y' });
    expect(fila.estado).toBe('no_verificado');
    expect(fila.invariante).toContain('#1');
    expect(fila.severidad).toBe('CRÍTICO');
  });
});
