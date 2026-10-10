import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { CONECTORES, resumenHonesto } from './registro';
import { CAPACIDADES_SIN_EJECUTOR, capacidadesConEjecutor, type Capacidad } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// OLA 9 · HALLAZGO 29 DE LA AUDITORÍA OLA 1 — «Integración ERP api_en_vivo (SAP B1,
// Oracle Fusion, Odoo) solo implementa la prueba de login; las capacidades de
// escritura están declaradas y nadie las consume».
//
// El arreglo honesto sin una instancia real es DECIR lo que hay (fichas y resumen)
// y poner una prueba de contrato que obligue a mantenerlo cierto: una capacidad
// sin ejecutor no se vende como hecha, y el día que alguien construya el ejecutor
// tiene que quitarla de CAPACIDADES_SIN_EJECUTOR (o esta prueba falla).
// ═══════════════════════════════════════════════════════════════════════════

const ESCRITURA: Capacidad[] = ['escribir_asiento', 'escribir_factura_proveedor'];

function fuentes(dir: string): string[] {
  const salida: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) salida.push(...fuentes(ruta));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|fixture)\./.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** Archivos de producción que NOMBRAN la capacidad fuera del catálogo y su tipo. */
function consumidores(capacidad: string): string[] {
  const catalogo = /^src\/lib\/likida\/conectores\/(tipos|erp|registro|peaje|gps|portales_facturacion|posiciones)\.ts$/;
  return fuentes('src')
    .filter((f) => !catalogo.test(f))
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    .filter((f) => readFileSync(f, 'utf8').includes(`'${capacidad}'`));
}

describe('capacidades declaradas vs ejecutores reales (hallazgo 29)', () => {
  it('ninguna capacidad sin ejecutor tiene un consumidor en el código: si lo tiene, se saca de la lista', () => {
    for (const k of CAPACIDADES_SIN_EJECUTOR) {
      expect(consumidores(k), `'${k}' ya tiene un consumidor: quítala de CAPACIDADES_SIN_EJECUTOR y verifica la ficha`).toEqual([]);
    }
  });

  it('toda capacidad de ESCRITURA declarada por una ficha está en la lista de las que no tienen ejecutor (o tiene consumidor real)', () => {
    for (const c of CONECTORES) {
      for (const k of c.capacidades.filter((x) => ESCRITURA.includes(x))) {
        const tiene = consumidores(k).length > 0;
        expect(tiene || CAPACIDADES_SIN_EJECUTOR.includes(k), `${c.id} declara '${k}' sin ejecutor y sin listarla como no construida`).toBe(true);
      }
    }
  });

  it('el ERP «api_en_vivo» no promete en lo que puede vender HOY ninguna escritura', () => {
    const erps = CONECTORES.filter((c) => c.categoria === 'ERP y contabilidad' && c.formaDeConectar === 'api_en_vivo');
    expect(erps.map((c) => c.id).sort()).toEqual(['odoo', 'oracle_fusion', 'sap_b1']);
    for (const c of erps) {
      expect(capacidadesConEjecutor(c).filter((k) => ESCRITURA.includes(k)), c.id).toEqual([]);
    }
  });

  it('la ficha de cada uno lo dice con todas sus letras y no afirma que la escritura ya existe', () => {
    for (const id of ['sap_b1', 'oracle_fusion', 'odoo']) {
      const c = CONECTORES.find((k) => k.id === id)!;
      expect(c.comoConectaHoy, id).toMatch(/solo comprueba que tu credencial sirve/);
      expect(c.comoConectaHoy, id).toMatch(/NO está construido/);
      expect(c.paraSubirDeEscalon, `${id} dice que ya está en su tope`).not.toBeNull();
      expect(c.queHace + c.comoConectaHoy, id).not.toMatch(/adaptador (está )?completo/i);
    }
    expect(/Deja el asiento/.test(CONECTORES.find((k) => k.id === 'oracle_fusion')!.queHace)).toBe(false);
    expect(/Deja el asiento/.test(CONECTORES.find((k) => k.id === 'odoo')!.queHace)).toBe(false);
  });

  it('el resumen honesto lo dice una vez, sin inflar', () => {
    expect(resumenHonesto()).toMatch(/solo comprueban la credencial/);
  });
});
