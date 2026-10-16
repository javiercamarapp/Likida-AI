import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { CampoValor, Extraccion } from './campos';
import { catalogoVacio, type CatalogoCliente, type ParteCat } from './catalogo_cliente';
import { leerPlantillaTms } from './lector_plantilla_tms';
import { plantillaNormalRealLlena, VALORES_LLENA } from './evaluacion/plantilla_normal_real.fixture';
import { NOTA_COMPLETADO, validarEntradaPlantilla, type DistanciaCat } from './validacion_entrada_plantilla';

const TENANT = 'tenant-sintetico';
const CLIENTE = 'cliente-sintetico';
const contexto = { tenantId: TENANT, clienteId: CLIENTE };

/** Libro A sintético: el llenado de la fixture al que se le vacían celdas (hoja → coordenadas). */
function libroA(vaciar: Record<string, string[]> = {}): Extraccion {
  const bytes = plantillaNormalRealLlena();
  const wb = XLSX.read(bytes, { type: 'array' });
  for (const [hoja, coords] of Object.entries(vaciar)) {
    const nombre = wb.SheetNames.find((n) => n.toLowerCase() === hoja.toLowerCase()) as string;
    for (const c of coords) delete wb.Sheets[nombre][c];
  }
  const out = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  const lectura = leerPlantillaTms(out);
  expect(lectura).not.toBeNull();
  return lectura!.extraccion;
}

const parteRemitente = (o: Partial<ParteCat> = {}): ParteCat => ({
  tenantId: TENANT, clienteId: CLIENTE, rol: 'remitente', alias: 'Embarcador Sintetico SA', razonSocial: 'Embarcador Sintetico SA',
  rfc: String(VALORES_LLENA.remitente.C12), idFiscalExtranjero: null, calle: 'Calle Uno', numExt: '10', numInt: '2', coloniaClave: '0001', colonia: 'Colonia Uno',
  cp: '44100', localidadClave: '01', localidad: 'Localidad Uno', municipioClave: '039', municipio: 'Municipio Uno', estado: 'JAL', pais: 'MEX',
  contacto: null, telefono: null, correo: null, ...o,
});

const catalogo = (o: Partial<CatalogoCliente> = {}): CatalogoCliente => ({
  ...catalogoVacio(),
  numero: { tenantId: TENANT, clienteId: CLIENTE, numeroInterno: '000777', numeroPagador: null, activo: true },
  partes: [parteRemitente()],
  ...o,
});

const distancias = (km = 912.4): DistanciaCat[] => [{ tenantId: TENANT, clienteId: CLIENTE, destinoRfc: '58-7654321', destinoNombre: null, km }];

const cv = (valor: string | null, origen: CampoValor['origen'] = 'perfil'): CampoValor => ({ valor, confianza: 0.97, evidencia: null, origen });

/** Todo lo que el cliente trae en `antes` sigue con el mismo valor en `despues`. */
function conservaTodo(antes: Extraccion, despues: Extraccion): void {
  for (const [k, v] of Object.entries(antes.campos)) {
    if (v.valor === null || v.valor === '') continue;
    expect(despues.campos[k]?.valor, `campos.${k}`).toBe(v.valor);
  }
  antes.mercancias.forEach((fila, i) => {
    for (const [k, v] of Object.entries(fila)) {
      if (v.valor === null || v.valor === '') continue;
      expect(despues.mercancias[i][k]?.valor, `mercancias.${i}.${k}`).toBe(v.valor);
    }
  });
}

describe('validarEntradaPlantilla · formato A (libro sintético)', () => {
  it('cliente interno vacío y distancia faltante: se completan desde los catálogos con la marca «completado»', () => {
    const ext = libroA({ RemintenteDestinatario: ['B7', 'B50'] });
    expect(ext.campos.numero_cliente_interno).toBeUndefined();
    expect(ext.campos.distancia_km).toBeUndefined();

    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo(), contexto, distancias: distancias() });

    expect(r.extraccion.campos.numero_cliente_interno.valor).toBe('000777');
    expect(r.extraccion.campos.numero_cliente_interno.origen).toBe('catalogo');
    expect(r.extraccion.campos.numero_cliente_interno.notas).toContain(NOTA_COMPLETADO);
    expect(r.extraccion.campos.distancia_km.valor).toBe('912.4');
    expect(r.extraccion.campos.distancia_km.notas).toContain(NOTA_COMPLETADO);
    expect(r.completados.map((c) => c.campo)).toEqual(expect.arrayContaining(['numero_cliente_interno', 'distancia_km']));
    expect(r.completados.find((c) => c.campo === 'distancia_km')?.fuente).toBe('catalogo_distancias');
    expect(r.faltantes).toEqual([]);
    conservaTodo(ext, r.extraccion);
  });

  it('claves de domicilio faltantes se completan desde el catálogo; el resto del remitente queda intacto', () => {
    const ext = libroA({ RemintenteDestinatario: ['C17', 'C20', 'C22'] });
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo(), contexto, distancias: distancias() });
    expect(r.extraccion.campos.origen_colonia_clave.valor).toBe('0001');
    expect(r.extraccion.campos.origen_localidad_clave.valor).toBe('01');
    expect(r.extraccion.campos.origen_municipio_clave.valor).toBe('039');
    expect(r.completados.filter((c) => c.campo.endsWith('_clave'))).toHaveLength(3);
    expect(r.faltantes).toEqual([]);
    conservaTodo(ext, r.extraccion);
  });

  it('valor del cliente distinto al del catálogo: aviso visible y se respeta lo del cliente', () => {
    const ext = libroA();
    const r = validarEntradaPlantilla({
      formato: 'A', extraccion: ext, contexto, distancias: distancias(500),
      catalogo: catalogo({ partes: [parteRemitente({ cp: '44999', calle: 'Calle Otra' })], numero: { tenantId: TENANT, clienteId: CLIENTE, numeroInterno: '000999', numeroPagador: null, activo: true } }),
    });
    expect(r.extraccion.campos.origen_cp.valor).toBe('44100');
    expect(r.extraccion.campos.origen_calle.valor).toBe('Calle Uno');
    expect(r.extraccion.campos.numero_cliente_interno.valor).toBe('000123');
    expect(r.extraccion.campos.distancia_km.valor).toBe('874.11');
    const dif = r.avisos.filter((a) => a.tipo === 'diferencia_catalogo');
    expect(dif.map((a) => a.campo)).toEqual(expect.arrayContaining(['origen_cp', 'origen_calle', 'numero_cliente_interno', 'distancia_km']));
    expect(dif.find((a) => a.campo === 'origen_cp')?.mensaje).toContain('44999');
    expect(dif.find((a) => a.campo === 'origen_cp')?.mensaje).toContain('44100');
    expect(r.completados.find((c) => c.campo === 'origen_cp')).toBeUndefined();
    conservaTodo(ext, r.extraccion);
  });

  it('un valor del cliente con confianza baja tampoco se sobrescribe: se avisa', () => {
    const ext = libroA();
    ext.campos.origen_cp = { ...cv('44100'), confianza: 0.4 };
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, contexto, distancias: distancias(), catalogo: catalogo({ partes: [parteRemitente({ cp: '44999' })] }) });
    expect(r.extraccion.campos.origen_cp.valor).toBe('44100');
    expect(r.avisos.some((a) => a.campo === 'origen_cp')).toBe(false); // la nota del catálogo no aplica a confianza baja…
    conservaTodo(ext, r.extraccion); // …pero el valor nunca cambia
  });

  it('sin catálogo: bloqueo «falta dato», nunca un valor inventado', () => {
    const ext = libroA({ RemintenteDestinatario: ['B7', 'B8', 'B50', 'C17'] });
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: null, contexto });
    const campos = r.faltantes.map((f) => f.campo);
    expect(campos).toEqual(expect.arrayContaining(['numero_cliente_interno', 'caja_numero', 'distancia_km', 'origen_colonia_clave']));
    expect(r.faltantes.every((f) => f.bloqueante)).toBe(true);
    expect(r.extraccion.campos.numero_cliente_interno).toBeUndefined();
    expect(r.extraccion.campos.caja_numero).toBeUndefined();
    expect(r.extraccion.campos.distancia_km).toBeUndefined();
    expect(r.completados).toEqual([]);
    conservaTodo(ext, r.extraccion);
  });

  it('catálogo de otro cliente o de otra flota no completa nada', () => {
    const ext = libroA({ RemintenteDestinatario: ['B7', 'B50'] });
    const ajeno = catalogo({ numero: { tenantId: 'otra-flota', clienteId: CLIENTE, numeroInterno: '000555', numeroPagador: null, activo: true } });
    const r = validarEntradaPlantilla({
      formato: 'A', extraccion: ext, catalogo: ajeno, contexto,
      distancias: [{ tenantId: 'otra-flota', clienteId: CLIENTE, destinoRfc: '58-7654321', destinoNombre: null, km: 10 }],
    });
    expect(r.extraccion.campos.numero_cliente_interno).toBeUndefined();
    expect(r.extraccion.campos.distancia_km).toBeUndefined();
    expect(r.faltantes.map((f) => f.campo)).toEqual(expect.arrayContaining(['numero_cliente_interno', 'distancia_km']));
  });

  it('distancias distintas para el mismo destino: ambiguo, no se aplica ninguna y falta el dato', () => {
    const ext = libroA({ RemintenteDestinatario: ['B50'] });
    const dobles: DistanciaCat[] = [...distancias(100), ...distancias(200)];
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo(), contexto, distancias: dobles });
    expect(r.extraccion.campos.distancia_km).toBeUndefined();
    expect(r.avisos.some((a) => a.tipo === 'ambiguo' && a.campo === 'distancia_km')).toBe(true);
    expect(r.faltantes.some((f) => f.campo === 'distancia_km')).toBe(true);
  });

  it('el libro completo del cliente pasa sin cambios: nada se completa y todo se conserva', () => {
    const ext = libroA();
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo({ partes: [parteRemitente()], numero: { tenantId: TENANT, clienteId: CLIENTE, numeroInterno: '000123', numeroPagador: null, activo: true } }), contexto, distancias: distancias(874.11) });
    expect(r.completados).toEqual([]);
    expect(r.faltantes).toEqual([]);
    expect(r.extraccion.campos).toEqual(ext.campos);
    expect(r.extraccion.mercancias).toEqual(ext.mercancias);
    expect(r.conservados).toBeGreaterThan(20);
  });

  it('la extracción de entrada no se muta', () => {
    const ext = libroA({ RemintenteDestinatario: ['B7'] });
    const copia = structuredClone(ext);
    validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo(), contexto, distancias: distancias() });
    expect(ext).toEqual(copia);
  });
});

describe('validarEntradaPlantilla · coherencia con el régimen (Guía de llenado)', () => {
  it('embalaje lleno con peligroso NO en exportación: aviso de la Guía, sin tocar el valor', () => {
    const ext = libroA();
    // La mercancía 1 de la fixture es peligrosa «NO»; el cliente le puso embalaje.
    ext.mercancias[0].embalaje = cv('4G');
    ext.mercancias[0].embalaje_descripcion = cv('Caja de carton');
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo(), contexto, distancias: distancias() });
    const guia = r.avisos.filter((a) => a.tipo === 'guia' && a.renglon === 0);
    expect(guia.map((a) => a.campo)).toContain('embalaje');
    expect(r.hallazgosGuia.some((h) => h.codigo === 'guia_embalaje_sin_peligroso' && h.renglon === 0)).toBe(true);
    expect(r.extraccion.mercancias[0].embalaje.valor).toBe('4G');
  });

  it('pedimento en una exportación: aviso de la Guía; la mercancía peligrosa con embalaje no avisa', () => {
    const ext = libroA();
    const r = validarEntradaPlantilla({ formato: 'A', extraccion: ext, catalogo: catalogo(), contexto, distancias: distancias() });
    // Fixture: régimen EXD con pedimento en la mercancía 1.
    expect(r.hallazgosGuia.some((h) => h.codigo.includes('pedimento') && h.renglon === 0)).toBe(true);
    expect(r.hallazgosGuia.some((h) => h.codigo === 'guia_embalaje_sin_peligroso' && h.renglon === 1)).toBe(false);
    expect(r.extraccion.mercancias[0].pedimento.valor).toBe(ext.mercancias[0].pedimento.valor);
  });
});

describe('validarEntradaPlantilla · formato B (extracción de la plantilla «nueva»; su lector llega con T-A3-44)', () => {
  const base = (): Extraccion => ({
    campos: {
      origen_nombre: cv('Embarcador Sintetico SA'), origen_rfc: cv(String(VALORES_LLENA.remitente.C12)), origen_pais: cv('MEX'),
      origen_cp: cv('44100'), origen_colonia_clave: cv('0001'), origen_localidad_clave: cv('01'), origen_municipio_clave: cv('039'),
      destino_nombre: cv('Destino Sintetico LLC'), destino_rfc: cv('58-7654321'), destino_pais: cv('USA'),
      caja_numero: cv('CAJA-B-01'), regimen_aduanero: cv('EXD'),
    },
    mercancias: [{ bienes_transp: cv('43211500'), descripcion: cv('Mercancia sintetica'), material_peligroso: cv('false'), embalaje: cv('4G'), regimen_aduanero: cv('EXD') }],
  });

  it('cliente vacío y distancia faltante: completados con marca; embalaje sin peligroso: aviso', () => {
    const r = validarEntradaPlantilla({ formato: 'B', extraccion: base(), catalogo: catalogo(), contexto, distancias: distancias() });
    expect(r.extraccion.campos.numero_cliente_interno.valor).toBe('000777');
    expect(r.extraccion.campos.numero_cliente_interno.notas).toContain(NOTA_COMPLETADO);
    expect(r.extraccion.campos.distancia_km.valor).toBe('912.4');
    expect(r.faltantes).toEqual([]);
    expect(r.avisos.some((a) => a.tipo === 'guia' && a.campo === 'embalaje')).toBe(true);
  });

  it('segundo destino: se completa su distancia y no se confunde con el primero', () => {
    const ext = base();
    ext.campos.distancia_km = cv('300');
    ext.campos.destino_2_nombre = cv('Destino Dos SA');
    ext.campos.destino_2_rfc = cv('58-1112223');
    ext.campos.destino_2_pais = cv('USA');
    const dist: DistanciaCat[] = [{ tenantId: TENANT, clienteId: CLIENTE, destinoRfc: '58-1112223', destinoNombre: null, km: 77 }];
    const r = validarEntradaPlantilla({ formato: 'B', extraccion: ext, catalogo: catalogo(), contexto, distancias: dist });
    expect(r.extraccion.campos.distancia_km.valor).toBe('300');
    expect(r.extraccion.campos.destino_2_distancia_km.valor).toBe('77');
    expect(r.faltantes).toEqual([]);
  });

  it('sin catálogo ni distancias: falta dato en cliente interno y distancia', () => {
    const r = validarEntradaPlantilla({ formato: 'B', extraccion: base(), catalogo: undefined, contexto });
    expect(r.faltantes.map((f) => f.campo).sort()).toEqual(['distancia_km', 'numero_cliente_interno']);
  });
});
