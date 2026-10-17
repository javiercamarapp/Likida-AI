import { describe, expect, it } from 'vitest';
import { cv } from '../documentos_sinteticos.fixture';
import type { Extraccion } from '../campos';
import { claveEmbarque, huellaContenido, limpiarMojibake, metadatosNombre, relacionArchivos } from '../nombre_archivo';
import { TOLERANCIA_CRUCE_PCT, compararFuentes, contrastarNombreConContenido } from '../verificacion_cruzada';
import { PARES } from './pares.fixture';

describe('pares documento ↔ libro: ✔ ◐ ✗ (T-A3-56)', () => {
  it('tabla por par: la marca coincide con lo esperado y las diferencias son exactamente las previstas', () => {
    const filas = PARES.map((p) => {
      const r = compararFuentes(p.documento, p.libro);
      return { id: p.id, esperado: p.esperado, marca: r.marca, diferencias: r.diferencias.map((d) => d.dimension) };
    });
    console.log('\nPAR  MARCA  DIFERENCIAS\n' + filas.map((f) => `${f.id}   ${f.marca}      ${f.diferencias.join(', ') || '—'}`).join('\n'));
    for (const p of PARES) {
      const f = filas.find((x) => x.id === p.id)!;
      expect(f.marca, `${p.id} ${p.forma}`).toBe(p.esperado);
      expect([...f.diferencias].sort()).toEqual([...p.diferencias].sort());
    }
    expect(filas.map((f) => f.marca)).toEqual(['✔', '◐', '✔', '◐', '✗', '✗', '✗']);
  });

  it('los 3 discrepantes marcan fuentes_en_conflicto con bloqueo; los 4 coincidentes no bloquean', () => {
    for (const p of PARES) {
      const r = compararFuentes(p.documento, p.libro);
      const conf = r.hallazgos.filter((h) => h.codigo === 'fuentes_en_conflicto');
      if (p.esperado === '✗') {
        expect(conf, p.id).toHaveLength(1);
        expect(conf[0].severidad).toBe('bloqueo');
        expect(conf[0].mensaje).toMatch(/No se mezclaron los datos/);
      } else {
        expect(conf.every((h) => h.severidad !== 'bloqueo'), p.id).toBe(true);
      }
    }
  });

  it('caja distinta o fracción genérica sola es «confirmar», no bloqueo; y un par igual no genera hallazgo', () => {
    const p2 = compararFuentes(PARES[1].documento, PARES[1].libro);
    expect(p2.hallazgos.map((h) => h.severidad)).toEqual(['confirmar']);
    const p4 = compararFuentes(PARES[3].documento, PARES[3].libro);
    expect(p4.hallazgos.map((h) => h.severidad)).toEqual(['confirmar']);
    expect(p4.diferencias[0].nota).toMatch(/QRST333444/);
    expect(compararFuentes(PARES[0].documento, PARES[0].libro).hallazgos).toEqual([]);
  });

  it('el peso con coma de miles («6,577.99») y el pedimento con espacios se leen como iguales', () => {
    const p2 = compararFuentes(PARES[1].documento, PARES[1].libro);
    expect(p2.diferencias.some((d) => d.dimension === 'peso')).toBe(false);
    const p3 = compararFuentes(PARES[2].documento, PARES[2].libro);
    expect(p3.comparadas).toContain('pedimento');
    expect(p3.diferencias).toEqual([]);
  });

  it('dentro de la tolerancia no hay conflicto; un factor de 1000 sí', () => {
    const base = (peso: string): Extraccion => ({ campos: {}, mercancias: [{ cantidad: cv('10'), peso_kg: cv(peso) }] });
    const f = (e: Extraccion, etiqueta: string) => ({ etiqueta, extraccion: e });
    expect(TOLERANCIA_CRUCE_PCT).toBe(0.01);
    expect(compararFuentes(f(base('1000'), 'uno'), f(base('1005'), 'dos')).marca).toBe('✔');
    expect(compararFuentes(f(base('1000'), 'uno'), f(base('1'), 'dos')).marca).toBe('✗');
    expect(compararFuentes(f(base('1000'), 'uno'), f(base('1020'), 'dos')).marca).toBe('✗');
  });

  it('lo que un documento no trae no se compara ni se inventa: sin peso o piezas el par queda ◐, no ✔', () => {
    const a = { etiqueta: 'uno', extraccion: { campos: {}, mercancias: [{ cantidad: cv('10') }] } satisfies Extraccion };
    const b = { etiqueta: 'dos', extraccion: { campos: {}, mercancias: [{ cantidad: cv('10'), peso_kg: cv('500') }] } satisfies Extraccion };
    const r = compararFuentes(a, b);
    expect(r.marca).toBe('◐');
    expect(r.sinDato).toContain('peso');
    expect(r.hallazgos).toEqual([]);
  });

  it('no mezcla: las extracciones de entrada quedan intactas', () => {
    const p = PARES[4];
    const antes = JSON.stringify([p.documento.extraccion, p.libro.extraccion]);
    compararFuentes(p.documento, p.libro);
    expect(JSON.stringify([p.documento.extraccion, p.libro.extraccion])).toBe(antes);
  });
});

describe('nombre de archivo: tipo, caja, fecha, versión y carácter dañado (T-A3-56)', () => {
  it('interpreta CCP <transportista>-<cliente> IMPO|EXPO <caja> <dd-mm-aa>', () => {
    const m = metadatosNombre('CCP Acme-Zeta EXPO ABCD123456 03-10-26.xlsx');
    expect(m.tipo).toEqual({ valor: 'EXPO', evidencia: 'EXPO' });
    expect(m.caja?.valor).toBe('ABCD123456');
    expect(m.fecha).toEqual({ valor: '2026-10-03', evidencia: '03-10-26' });
    expect(m.version).toBe(1);
    expect(m.versionExplicita).toBe(false);
    expect(m.extension).toBe('xlsx');
  });

  it('versión (3) y carácter dañado «Â» en lugar del espacio se interpretan y se avisa', () => {
    const m = metadatosNombre('CCP Acme-ZetaÂ IMPO QRST333444 05-10-26 (3).xlsx');
    expect(m.version).toBe(3);
    expect(m.versionExplicita).toBe(true);
    expect(m.tipo?.valor).toBe('IMPO');
    expect(m.caja?.valor).toBe('QRST333444');
    expect(m.fecha?.valor).toBe('2026-10-05');
    expect(m.limpio).not.toMatch(/Â/);
    expect(m.avisos.join(' ')).toMatch(/carácter dañado/);
  });

  it('el espacio dañado entre palabras (Â pegada, U+FFFD, espacio duro) no pega los campos', () => {
    for (const sep of ['Â ', '�', ' ', 'Â ']) {
      const m = metadatosNombre(`CCP Acme-Zeta${sep}EXPO${sep}ABCD123456${sep}03-10-26.pdf`);
      expect(m.caja?.valor, JSON.stringify(sep)).toBe('ABCD123456');
      expect(m.tipo?.valor).toBe('EXPO');
    }
    expect(limpiarMojibake('limpio').cambio).toBe(false);
  });

  it('un nombre que no sigue la forma no inventa pistas; una fecha imposible se avisa', () => {
    const m = metadatosNombre('foto.png');
    expect(m.tipo).toBeNull(); expect(m.caja).toBeNull(); expect(m.fecha).toBeNull();
    expect(claveEmbarque(m)).toBeNull();
    expect(metadatosNombre(null).limpio).toBe('');
    const mala = metadatosNombre('CCP A-B EXPO CAJA1 31-02-26.xlsx');
    expect(mala.fecha).toBeNull();
    expect(mala.avisos.join(' ')).toMatch(/no es una fecha real/);
  });

  it('versión e idempotencia por huella: mismo contenido = duplicado; misma clave y otra versión = nueva_version', () => {
    const enc = new TextEncoder();
    const a = { meta: metadatosNombre('CCP A-B IMPO CAJA1 05-10-26.xlsx'), huella: huellaContenido(enc.encode('uno')) };
    const mismoContenidoOtroNombre = { meta: metadatosNombre('CCP A-B IMPO CAJA9 06-10-26 (2).xlsx'), huella: huellaContenido(enc.encode('uno')) };
    const v3 = { meta: metadatosNombre('CCP A-B IMPO CAJA1 05-10-26 (3).xlsx'), huella: huellaContenido(enc.encode('tres')) };
    const mismaVersion = { meta: metadatosNombre('CCP A-B IMPO CAJA1 05-10-26.xlsx'), huella: huellaContenido(enc.encode('otro')) };
    const otraCaja = { meta: metadatosNombre('CCP A-B IMPO CAJA2 05-10-26.xlsx'), huella: huellaContenido(enc.encode('x')) };
    const sinPistas = { meta: metadatosNombre('foto.png'), huella: huellaContenido(enc.encode('y')) };
    expect(relacionArchivos(a, mismoContenidoOtroNombre)).toBe('duplicado');
    expect(relacionArchivos(a, v3)).toBe('nueva_version');
    expect(relacionArchivos(a, mismaVersion)).toBe('mismo_embarque_otro_contenido');
    expect(relacionArchivos(a, otraCaja)).toBe('distinto');
    expect(relacionArchivos(a, sinPistas)).toBe('indeterminado');
    expect(huellaContenido(enc.encode('uno'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el nombre contradice al contenido: IMPO contra régimen de exportación y caja distinta avisan; sin dato no dice nada', () => {
    const e: Extraccion = { campos: { caja_numero: cv('ZZZZ000111'), }, mercancias: [{ regimen_aduanero: cv('EXD') }] };
    const h = contrastarNombreConContenido(metadatosNombre('CCP A-B IMPO ABCD123456 03-10-26.xlsx'), e);
    expect(h.map((x) => x.codigo)).toEqual(['nombre_contradice_contenido', 'nombre_contradice_contenido']);
    expect(h.map((x) => x.campo).sort()).toEqual(['caja_numero', 'regimen_aduanero']);
    expect(contrastarNombreConContenido(metadatosNombre('CCP A-B EXPO ZZZZ000111 03-10-26.xlsx'), e)).toEqual([]);
    expect(contrastarNombreConContenido(metadatosNombre('foto.png'), e)).toEqual([]);
    expect(contrastarNombreConContenido(metadatosNombre('CCP A-B IMPO ABCD123456 03-10-26.xlsx'), { campos: {}, mercancias: [] })).toEqual([]);
  });
});
