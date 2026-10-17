import { describe, expect, it } from 'vitest';
import type { CampoValor, Extraccion } from './campos';
import { catalogoVacio, type CatalogoCliente, type ParteCat, type ProductoCat } from './catalogo_cliente';
import { convertirExtraccion, FORMATOS_CONVERTIBLES, reaplicarMarcas, type EntradaConvertidor, type FormatoConvertible } from './convertidor';
import { RFC } from './documentos_sinteticos.fixture';
import { plantillaNormalRealEnBlanco } from './evaluacion/plantilla_normal_real.fixture';
import { aXlsxPlantillaTms } from './exportacion';
import { leerPlantillaTms } from './lector_plantilla_tms';
import { construirPlantilla } from './plantilla_tms';
import { validarReglasGuia } from './validacion';
import type { DistanciaCat } from './validacion_entrada_plantilla';

const TENANT = 'tenant-sintetico';
const CLIENTE = 'cliente-sintetico';
const contexto = { tenantId: TENANT, clienteId: CLIENTE };

const LEIDOS = ['xml', 'perfil', 'llm', 'humano'];

const cv = (valor: string | null, origen: CampoValor['origen'] = 'llm'): CampoValor => ({ valor, confianza: 0.9, evidencia: 'texto sintético', origen });
const conv = (o: Record<string, string | null>, origen: CampoValor['origen'] = 'llm'): Record<string, CampoValor> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cv(v, origen)]));

const ext = (doc: Record<string, string | null>, ...mercs: Array<Record<string, string | null>>): Extraccion => ({ campos: conv(doc), mercancias: mercs.map((m) => conv(m)) });

const parte = (rol: ParteCat['rol'], alias: string, o: Partial<ParteCat>): ParteCat => ({
  tenantId: TENANT, clienteId: CLIENTE, rol, alias, razonSocial: alias, rfc: null, idFiscalExtranjero: null, calle: 'Calle Sintetica', numExt: '10', numInt: null,
  coloniaClave: null, colonia: 'Colonia Sintetica', cp: '44100', localidadClave: null, localidad: 'Localidad Sintetica', municipioClave: null, municipio: 'Municipio Sintetico',
  estado: 'JAL', pais: 'MEX', contacto: null, telefono: null, correo: null, ...o,
});

const MX = { coloniaClave: '0001', localidadClave: '01', municipioClave: '039' };

const producto = (sku: string): ProductoCat => ({
  tenantId: TENANT, clienteId: CLIENTE, sku, descripcionPatron: null, bienesTransp: '43211500', claveUnidad: 'H87', embalaje: null, fraccion: '8471500100', // grep-limpio:ok
  tipoMateria: '03', materialPeligroso: false, claveMaterialPeligroso: null,
});

const catalogo = (): CatalogoCliente => ({
  ...catalogoVacio(),
  numero: { tenantId: TENANT, clienteId: CLIENTE, numeroInterno: '000777', numeroPagador: null, activo: true },
  partes: [
    parte('remitente', 'Embarcador Sintetico SA', { rfc: RFC.atlas, ...MX }),
    parte('destinatario', 'Destino Sintetico LLC', { rfc: '58-7654321', estado: 'TX', pais: 'USA', cp: '78040' }), // grep-limpio:ok
    parte('remitente', 'Shipper Synthetic Inc', { rfc: '58-1234567', estado: 'TX', pais: 'USA', cp: '78041' }), // grep-limpio:ok
    parte('destinatario', 'Consignee Synthetic SA', { rfc: RFC.boreal, ...MX, cp: '64000', estado: 'NLE' }),
  ],
  productos: ['SKU-C100', 'SKU-D200', 'SKU-E300', 'SKU-F100', 'SKU-F200', 'SKU-F300', 'SKU-G400'].map(producto),
});

const distancias = (): DistanciaCat[] => ['Destino Sintetico LLC', 'Consignee Synthetic SA'].map((n, i) => ({
  tenantId: TENANT, clienteId: CLIENTE, destinoRfc: null, destinoNombre: n, km: 410.5 + i * 100,
}));

/** Extracción común sintética por formato: lo que cada lector deja (análisis 17 §2b), con lo que el documento NO trae vacío. */
const FIXTURES: Record<FormatoConvertible, () => Extraccion> = {
  // C: remisión de planta, exportación: nombre sin claves, sin régimen, sin caja, sin distancia.
  C: () => ext({ folio_cliente: 'REM-C-001', origen_nombre: 'Embarcador Sintetico SA', destino_nombre: 'Destino Sintetico LLC' },
    { descripcion: 'SKU-C100 Pieza sintetica', cantidad: '12', peso_kg: '340.5' }),
  // D: BOL en inglés, importación: el régimen viene en Notes, sin caja.
  D: () => ext({ folio_cliente: 'BOL-D-77', origen_nombre: 'Shipper Synthetic Inc', destino_nombre: 'Consignee Synthetic SA', regimen_aduanero: 'IMD' },
    { descripcion: 'SKU-D200 Synthetic parts', cantidad: '5', peso_kg: '120' }),
  // E: orden del agente aduanal, importación: trae caja, sin régimen ni distancia.
  E: () => ext({ folio_cliente: 'CTRL-E-5', origen_nombre: 'Shipper Synthetic Inc', destino_nombre: 'Consignee Synthetic SA', caja_numero: 'CAJA-E-09' },
    { descripcion: 'SKU-E300 Cartones sinteticos', cantidad: '30', peso_kg: '800' }),
  // F1: correo con tabla «DATOS DE LA MERCANCÍA»: caja del asunto.
  F1: () => ext({ folio_cliente: 'DN-F1', origen_nombre: 'Embarcador Sintetico SA', destino_nombre: 'Destino Sintetico LLC', caja_numero: 'TRL-F1' },
    { descripcion: 'SKU-F100 Pieza sintetica', cantidad: '8', peso_kg: '95.5' }),
  // F2: bloque «Datos para CP:» con régimen y tipo de materia explícitos.
  F2: () => ext({ folio_cliente: 'DN-F2', origen_nombre: 'Embarcador Sintetico SA', destino_nombre: 'Destino Sintetico LLC', caja_numero: 'TRL-F2', regimen_aduanero: 'EXD' },
    { descripcion: 'SKU-F200 Pieza sintetica', cantidad: '3', peso_kg: '45', tipo_materia: '03' }),
  // F3: bloque de rótulos: dirección y teléfono del destino.
  F3: () => ext({ folio_cliente: 'DN-F3', origen_nombre: 'Embarcador Sintetico SA', destino_nombre: 'Destino Sintetico LLC', caja_numero: 'TRL-F3', contacto_destino_telefono: '5550000' },
    { descripcion: 'SKU-F300 Cartones sinteticos', cantidad: '20', peso_kg: '210' }),
  // G: JSON de plataforma: sin número interno (el identificador de la plataforma no es el del TMS).
  G: () => ext({ folio_cliente: 'NE-G-1', origen_nombre: 'Embarcador Sintetico SA', destino_nombre: 'Destino Sintetico LLC', caja_numero: 'TRK-G-01', regimen_aduanero: null },
    { descripcion: 'SKU-G400 Pieza sintetica', cantidad: '2', peso_kg: '15' }),
};

const entrada = (formato: FormatoConvertible, extra: Partial<EntradaConvertidor> = {}): EntradaConvertidor => ({
  formato, extraccion: FIXTURES[formato](), catalogo: catalogo(), contexto, distancias: distancias(), ...extra,
});

/** Una caja capturada por la persona (C y D no la traen y no hay catálogo de cajas). */
const conCaja = (e: Extraccion): Extraccion => ({ ...e, campos: { ...e.campos, caja_numero: cv('CAJA-HUMANA-1', 'humano') } });

const bloqueosDe = (formato: FormatoConvertible, e: Extraccion): string[] =>
  convertirExtraccion(entrada(formato, { extraccion: e })).bloqueos.map((b) => b.campo);

describe('convertirExtraccion · un fixture sintético por formato C–G', () => {
  for (const formato of FORMATOS_CONVERTIBLES) {
    it(`${formato}: sale un borrador válido contra las reglas de la Guía, con los inferidos señalados`, () => {
      const b = convertirExtraccion(entrada(formato, { extraccion: conCaja(FIXTURES[formato]()) }));
      expect(b.estado).toBe('borrador_para_revision');
      expect(b.bloqueos).toEqual([]);
      expect(b.bloqueado).toBe(false);
      expect(b.libro.faltantes).toEqual([]);
      expect(validarReglasGuia(b.extraccion, undefined).filter((h) => h.severidad === 'bloqueo')).toEqual([]);
      // El catálogo completó lo que el documento no trae.
      expect(b.extraccion.campos.numero_cliente_interno.valor).toBe('000777');
      expect(b.extraccion.campos.distancia_km.valor).toBeTruthy();
      expect(b.extraccion.campos.origen_cp.valor).toBeTruthy();
      expect(b.extraccion.campos.regimen_aduanero.valor).toMatch(/^(EXD|IMD)$/);
      expect(b.extraccion.mercancias[0].bienes_transp.valor).toBe('43211500');
      expect(b.inferidos.map((m) => m.campo)).toEqual(expect.arrayContaining(['numero_cliente_interno', 'distancia_km', 'bienes_transp']));
      expect(b.libro.hojas.RemintenteDestinatario.B7.valor).toBe('000777');
    });
  }

  it('nunca se envía solo: ni al TMS ni con aprobación', () => {
    const b = convertirExtraccion(entrada('F2'));
    expect(b.puedeEnviarseAlTms).toBe(false);
    expect(b.aprobadoPorPersona).toBe(false);
  });
});

describe('convertirExtraccion · ningún inferido pasa como leído', () => {
  for (const formato of FORMATOS_CONVERTIBLES) {
    it(`${formato}: todo valor presente es «leído» idéntico al documento o «inferido» con origen y nota`, () => {
      const original = FIXTURES[formato]();
      const snapshot = structuredClone(original);
      const b = convertirExtraccion(entrada(formato, { extraccion: original }));
      expect(original).toEqual(snapshot); // la extracción de entrada no se modifica

      const revisar = (campo: string, renglon: number | null, v: CampoValor, antes: CampoValor | undefined): void => {
        if (v.valor === null || v.valor === '') return;
        const marca = b.marcas.find((m) => m.campo === campo && m.renglon === renglon);
        expect(marca, `${renglon ?? '-'}:${campo} sin marca`).toBeDefined();
        const vinoDelDocumento = antes?.valor === v.valor && antes !== undefined && antes.valor !== null && antes.valor !== '';
        if (vinoDelDocumento) {
          expect(marca!.estado).toBe('leido');
          expect(v.origen).toBe(antes!.origen);
        } else {
          expect(marca!.estado).toBe('inferido');
          expect(marca!.fuente).not.toBeNull();
          expect(LEIDOS).not.toContain(v.origen);
          expect((v.notas ?? []).some((n) => n.startsWith('Inferido'))).toBe(true);
        }
      };
      for (const [k, v] of Object.entries(b.extraccion.campos)) revisar(k, null, v, original.campos[k]);
      b.extraccion.mercancias.forEach((fila, i) => { for (const [k, v] of Object.entries(fila)) revisar(k, i, v, original.mercancias[i]?.[k]); });
    });
  }

  it('lo que el documento sí trae (régimen, caja, folio, descripción) se conserva tal cual y queda «leído»', () => {
    const b = convertirExtraccion(entrada('D'));
    expect(b.extraccion.campos.regimen_aduanero.valor).toBe('IMD');
    expect(b.extraccion.campos.regimen_aduanero.origen).toBe('llm');
    expect(b.marcas.find((m) => m.campo === 'regimen_aduanero')?.estado).toBe('leido');
    expect(b.extraccion.campos.folio_cliente.valor).toBe('BOL-D-77');
    expect(b.extraccion.mercancias[0].descripcion.valor).toBe('SKU-D200 Synthetic parts');
  });

  it('un valor del documento distinto al del catálogo se conserva como leído y solo se avisa', () => {
    const e = FIXTURES.C();
    e.campos.numero_cliente_interno = cv('000999');
    const b = convertirExtraccion(entrada('C', { extraccion: e }));
    expect(b.extraccion.campos.numero_cliente_interno.valor).toBe('000999');
    expect(b.marcas.find((m) => m.campo === 'numero_cliente_interno')?.estado).toBe('leido');
    expect(b.avisos.some((a) => a.includes('000777'))).toBe(true);
  });
});

describe('convertirExtraccion · régimen por tipo de operación', () => {
  it('exportación (origen MEX, destino fuera) sin régimen ⇒ EXD inferido', () => {
    const b = convertirExtraccion(entrada('C'));
    const campo = b.extraccion.campos.regimen_aduanero;
    expect(campo.valor).toBe('EXD');
    expect(campo.origen).toBe('derivado');
    expect(b.marcas.find((m) => m.campo === 'regimen_aduanero')).toMatchObject({ estado: 'inferido', fuente: 'tipo_operacion' });
  });

  it('importación (origen fuera, destino MEX) sin régimen ⇒ IMD inferido', () => {
    const b = convertirExtraccion(entrada('E'));
    expect(b.extraccion.campos.regimen_aduanero.valor).toBe('IMD');
    expect(b.marcas.find((m) => m.campo === 'regimen_aduanero')?.fuente).toBe('tipo_operacion');
  });

  it('sin países que lo decidan no se inventa régimen: queda vacío y el libro lo pide', () => {
    const b = convertirExtraccion(entrada('C', { catalogo: null, distancias: null }));
    expect(b.extraccion.campos.regimen_aduanero?.valor ?? null).toBeNull();
    expect(b.inferidos).toEqual([]);
  });
});

describe('convertirExtraccion · sin catálogo aplicable ⇒ campo vacío y bloqueo, no valor inventado', () => {
  it('sin catálogo: no se completa nada y el borrador queda bloqueado con cada «falta dato»', () => {
    const b = convertirExtraccion(entrada('C', { catalogo: null, distancias: null }));
    expect(b.bloqueado).toBe(true);
    expect(b.extraccion.campos.numero_cliente_interno?.valor ?? null).toBeNull();
    expect(b.extraccion.campos.distancia_km?.valor ?? null).toBeNull();
    expect(b.extraccion.campos.origen_rfc?.valor ?? null).toBeNull();
    expect(b.extraccion.mercancias[0].bienes_transp?.valor ?? null).toBeNull();
    expect(b.inferidos).toEqual([]);
    const campos = b.bloqueos.map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['numero_cliente_interno', 'caja_numero', 'distancia_km']));
    expect(b.bloqueos.every((x) => x.mensaje.length > 0)).toBe(true);
    expect(b.libro.hojas.RemintenteDestinatario.B7.valor).toBeNull();
  });

  it('C y D no traen caja y no hay catálogo de cajas: bloquea hasta que la persona la capture', () => {
    expect(bloqueosDe('C', FIXTURES.C())).toEqual(['caja_numero']);
    expect(bloqueosDe('D', FIXTURES.D())).toEqual(['caja_numero']);
    expect(bloqueosDe('C', conCaja(FIXTURES.C()))).toEqual([]);
  });

  it('distancia sin entrada en el catálogo de distancias: queda vacía y bloquea', () => {
    const b = convertirExtraccion(entrada('F1', { distancias: [] }));
    expect(b.extraccion.campos.distancia_km?.valor ?? null).toBeNull();
    expect(b.bloqueos.map((x) => x.campo)).toContain('distancia_km');
  });

  it('un SKU que no está en el catálogo deja la mercancía sin clave SAT y bloquea', () => {
    const e = ext({ folio_cliente: 'X', origen_nombre: 'Embarcador Sintetico SA', destino_nombre: 'Destino Sintetico LLC', caja_numero: 'CAJA-1' },
      { descripcion: 'SKU-NO-EXISTE Pieza', cantidad: '1', peso_kg: '10' });
    const b = convertirExtraccion(entrada('C', { extraccion: e }));
    expect(b.extraccion.mercancias[0].bienes_transp?.valor ?? null).toBeNull();
    expect(b.bloqueado).toBe(true);
  });
});

describe('convertirExtraccion · plantilla normal o nueva', () => {
  it('una razón social de embarcador ⇒ normal; dos ⇒ nueva con criterio provisional', () => {
    expect(convertirExtraccion(entrada('F1')).eleccion).toMatchObject({ plantilla: 'normal', criterio_provisional: true });
    const dos = FIXTURES.F1();
    dos.campos.origen_2_nombre = cv('Otro Embarcador Sintetico SA');
    const b = convertirExtraccion(entrada('F1', { extraccion: dos }));
    expect(b.eleccion.plantilla).toBe('nueva');
    expect(b.libro.hojas.Origenes).toBeDefined();
    expect(b.libro.criterio_provisional).toBe(true);
    expect(b.avisos.some((a) => a.includes('provisional'))).toBe(true);
    expect(b.puedeEnviarseAlTms).toBe(false);
  });

  it('la elección manual de una persona se respeta', () => {
    const b = convertirExtraccion(entrada('F1', { plantillaManual: 'nueva' }));
    expect(b.eleccion).toMatchObject({ plantilla: 'nueva', origen: 'manual', criterio_provisional: false });
    expect(b.libro.hojas.Datos).toBeDefined();
  });
});

describe('convertirExtraccion · tramo mexicano (T-A3-50, regla inyectada)', () => {
  it('sin regla: se avisa del extremo extranjero y no se cambia nada', () => {
    const b = convertirExtraccion(entrada('C'));
    expect(b.avisos.some((a) => a.includes('T-A3-50'))).toBe(true);
    expect(b.marcas.some((m) => m.fuente === 'tramo_mexicano')).toBe(false);
  });

  it('con regla: llena solo vacíos, los marca «tramo_mexicano» y no pisa lo leído', () => {
    const e = FIXTURES.C();
    e.campos.destino_cp = cv('78040');
    const b = convertirExtraccion(entrada('C', {
      extraccion: e,
      tramoMexicano: (_x, op) => ({ cambios: { destino_estado: 'NLE', destino_cp: '99999' }, evidencia: `Regla sintética (${op})` }),
    }));
    expect(b.extraccion.campos.destino_cp.valor).toBe('78040');
    expect(b.marcas.find((m) => m.campo === 'destino_cp')?.estado).toBe('leido');
    expect(b.avisos.some((a) => a.includes('99999'))).toBe(true);
  });
});

describe('convertirExtraccion · relectura con T-A3-47', () => {
  it('releer el libro del borrador da la misma plantilla y, con las marcas, la misma extracción con sus inferidos', () => {
    const b = convertirExtraccion(entrada('E'));
    expect(b.bloqueado).toBe(false);
    expect(b.eleccion.plantilla).toBe('normal');

    const lectura = leerPlantillaTms(aXlsxPlantillaTms(b.libro, plantillaNormalRealEnBlanco()));
    expect(lectura).not.toBeNull();
    expect(lectura!.llamadasLlm).toBe(0);
    // Misma plantilla celda a celda.
    const ctx = { clienteInterno: null, plantilla: 'normal' as const, uso: 'descarga' as const };
    expect(construirPlantilla(lectura!.extraccion, ctx).hojas).toEqual(b.libro.hojas);
    // Misma extracción (valores) …
    for (const m of b.marcas.filter((x) => x.renglon === null && !['distancia_km', 'origen_estado', 'destino_estado'].includes(x.campo))) {
      expect(lectura!.extraccion.campos[m.campo]?.valor, m.campo).toBe(m.valor);
    }
    // … más las marcas: lo releído sale todo «perfil»; las marcas devuelven el origen de lo inferido.
    const conMarcas = reaplicarMarcas(lectura!.extraccion, b);
    expect(lectura!.extraccion.campos.numero_cliente_interno.origen).toBe('perfil');
    expect(conMarcas.campos.numero_cliente_interno.origen).toBe('catalogo');
    expect(conMarcas.campos.regimen_aduanero.origen).toBe('derivado');
    expect(conMarcas.campos.distancia_km.origen).toBe('catalogo');
    expect(conMarcas.campos.folio_cliente.origen).toBe('perfil'); // lo leído del documento no recibe marca
    for (const m of b.inferidos.filter((x) => x.renglon === null)) {
      expect(LEIDOS, m.campo).not.toContain(conMarcas.campos[m.campo]?.origen);
    }
  });
});
