import { describe, expect, it } from 'vitest';
import {
  CAMPOS_DOC, CAMPOS_DOC_LLM, CAMPOS_MERCANCIA, CAMPOS_MERCANCIA_LLM, CLAVES_DOC, CLAVES_MERCANCIA, campoDoc, campoMercancia,
} from './campos';
import { SalidaLlmSchema, construirSistema } from './extractor';
import { ROTULO_ORIGEN } from './presentacion';

/** Largo de `construirSistema()` antes de ampliar los campos del complemento (T-A3-06). */
const LARGO_PROMPT_BASE = 3498;
/** T-A3-46: 6 campos aduaneros y una regla de extracción. */
const LARGO_PROMPT_ADUANA = LARGO_PROMPT_BASE + 490; // el prompt real mide 3981 (T-A3-46)
/** T-A3-68: regla del peso bruto, regla de cifras con separadores y tope de «notas» (el prompt real mide 4467). */
const LARGO_PROMPT_PESO = LARGO_PROMPT_ADUANA + 490;

const NUEVOS_DOC = [
  'origen_calle', 'origen_num_ext', 'origen_num_int', 'origen_colonia_clave', 'origen_colonia', 'origen_localidad_clave',
  'origen_localidad', 'origen_municipio_clave', 'origen_municipio', 'origen_pais',
  'destino_calle', 'destino_num_ext', 'destino_num_int', 'destino_colonia_clave', 'destino_colonia', 'destino_localidad_clave',
  'destino_localidad', 'destino_municipio_clave', 'destino_municipio', 'destino_pais',
  'destino_id_fiscal', 'contacto_destino_nombre', 'contacto_destino_telefono', 'contacto_destino_correo',
  'piezas_total', 'volumen_total', 'numero_cliente_interno',
];
const NUEVOS_MERC = ['rfc_agente_aduanal', 'unidad_descripcion', 'embalaje_descripcion', 'volumen'];
/** T-A3-46: salieron de `soloEnriquecimiento`; el documento sí los trae (ver aduana.test.ts). */
const ADUANEROS_MERC = ['pedimento', 'regimen_aduanero', 'tipo_materia', 'clave_material_peligroso', 'rfc_importador'];

describe('campos del complemento', () => {
  it('las claves no se repiten', () => {
    expect(new Set(CLAVES_DOC).size).toBe(CLAVES_DOC.length);
    expect(new Set(CLAVES_MERCANCIA).size).toBe(CLAVES_MERCANCIA.length);
  });

  it('existen los campos nuevos y todos son solo de enriquecimiento', () => {
    for (const k of NUEVOS_DOC) expect(campoDoc(k)?.soloEnriquecimiento, k).toBe(true);
    for (const k of NUEVOS_MERC) expect(campoMercancia(k)?.soloEnriquecimiento, k).toBe(true);
  });

  it('los campos aduaneros y la caja se le piden al modelo', () => {
    for (const k of ADUANEROS_MERC) expect(CAMPOS_MERCANCIA_LLM.some((c) => c.clave === k), k).toBe(true);
    expect(CAMPOS_DOC_LLM.some((c) => c.clave === 'caja_numero')).toBe(true);
    const sistema = construirSistema();
    for (const k of [...ADUANEROS_MERC, 'caja_numero']) expect(sistema.includes(`- ${k}:`), k).toBe(true);
  });

  it('se conservan las claves anteriores', () => {
    for (const k of ['origen_domicilio', 'destino_domicilio', 'origen_cp', 'destino_estado', 'peso_bruto_total']) expect(campoDoc(k), k).toBeDefined();
    for (const k of ['descripcion', 'bienes_transp', 'embalaje', 'material_peligroso']) expect(campoMercancia(k), k).toBeDefined();
  });

  it('ningún campo nuevo bloquea la aprobación mientras nada los rellene (T-A3-20)', () => {
    const criticos = [...CAMPOS_DOC, ...CAMPOS_MERCANCIA].filter((c) => c.soloEnriquecimiento && c.critico);
    expect(criticos).toEqual([]);
  });

  it('el esquema y el prompt del modelo no incluyen campos de solo enriquecimiento', () => {
    const solo = [...NUEVOS_DOC, ...NUEVOS_MERC];
    const sistema = construirSistema();
    for (const k of solo) expect(sistema.includes(`- ${k}:`), k).toBe(false);
    for (const k of solo) {
      const doc = SalidaLlmSchema.safeParse({ campos: [{ clave: k, valor: 'x', confianza: 1, evidencia: 'x' }], mercancias: [], notas: null });
      const merc = SalidaLlmSchema.safeParse({ campos: [], mercancias: [{ campos: [{ clave: k, valor: 'x', confianza: 1, evidencia: 'x' }] }], notas: null });
      expect(doc.success && merc.success, k).toBe(false);
    }
    expect(CAMPOS_DOC_LLM.some((c) => c.soloEnriquecimiento)).toBe(false);
    expect(CAMPOS_MERCANCIA_LLM.some((c) => c.soloEnriquecimiento)).toBe(false);
  });

  it('el prompt no crece', () => {
    expect(construirSistema().length).toBeLessThanOrEqual(LARGO_PROMPT_PESO);
  });

  it('el origen «catalogo» tiene rótulo', () => {
    expect(ROTULO_ORIGEN.catalogo).toBe('Catálogo');
  });
});
