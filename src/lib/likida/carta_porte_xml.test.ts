import { describe, it, expect } from 'vitest';
import { generarXmlCcp, escaparXml } from './carta_porte_xml';
import { armarBorrador, checklistCcp, necesitaCartaPorte, generarIdCcp, type DatosChecklist } from './carta_porte';
import type { ViajeCcp } from './carta_porte_datos';
import { fechaHoraSat } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// FASE D (export XML): el generador produce el XML del borrador VALIDADO y de
// nada más. Las pruebas cubren el round-trip (lo que entra es lo que el XML
// afirma), el escapado, los candados (sin SICT → atributo ausente; borrador
// inválido → cero XML) y el formato de fecha del SAT.
// ═══════════════════════════════════════════════════════════════════════════

/** Un viaje COMPLETO que arma y valida — la base de la que cada prueba quita
 *  lo que necesita romper. El `&`, `<` y `"` van a propósito en los textos. */
function datosCompletos(): DatosChecklist {
  return {
    viaje: { origen: 'Mérida', destino: 'Cancún', fechaInicio: '2026-08-27T15:00:00+00:00', kmRecorridos: 320 },
    clienteRfc: 'AAA010101AAA',
    unidad: {
      placas: 'ABC1234', anio: 2020, configVehicular: 'C2', pesoBrutoTon: 17.5,
      aseguradoraRc: 'Qualitas & Cía', polizaRcNumero: 'POL-99',
      permisoSictTipo: 'TPAF01', permisoSictNumero: '123456',
    },
    operador: { nombre: 'Juan "El Rayo" Pérez', rfc: 'PEPJ800101AAA', licencia: 'LIC123456' },
    ccpViaje: {
      origenCp: '97000', destinoCp: '77500', origenEstado: 'YUC', destinoEstado: 'ROO',
      rfcDestinatario: 'BBB010101BB8', transpInternac: false,
    },
    mercancias: [
      { descripcion: 'Cemento <gris> & arena', bienesTransp: '01010101', cantidad: 10, claveUnidad: 'XBX', pesoKg: 900.5, materialPeligroso: false },
      { descripcion: 'Varilla', bienesTransp: '02020202', cantidad: 2.5, claveUnidad: 'KGM', pesoKg: 99.5, materialPeligroso: null },
    ],
  };
}

function viajeDe(datos: DatosChecklist, extras?: Partial<ViajeCcp>): ViajeCcp {
  const cc = datos.ccpViaje ?? {
    origenCp: null, destinoCp: null, origenEstado: null, destinoEstado: null,
    rfcDestinatario: null, transpInternac: null,
  };
  return {
    viajeId: '11111111-2222-4333-8444-555555555555',
    folio: 'F-123',
    origen: datos.viaje.origen, destino: datos.viaje.destino,
    estatus: 'abierto', unidadEconomico: 'T-07',
    operadorNombre: datos.operador?.nombre ?? null,
    clienteNombre: 'Choco & Asociados',
    declarado: { pisaFederal: true, radioKm: null },
    decision: necesitaCartaPorte({ pisaTramoFederal: true, configVehicular: datos.unidad?.configVehicular ?? null, radioFederalKm: null, materiaExcluida: false }),
    checklist: checklistCcp(datos),
    datosCliente: cc,
    mercancias: (datos.mercancias ?? []).map((m, i) => ({ ...m, id: `m-${i}` })),
    borrador: armarBorrador(datos),
    datos,
    ...extras,
  };
}

const ID = generarIdCcp();

describe('generarXmlCcp — el XML del borrador validado', () => {
  it('round-trip: lo capturado es lo que el XML afirma, con la fecha en hora de México', () => {
    const r = generarXmlCcp(viajeDe(datosCompletos()), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const x = r.xml;

    expect(x).toContain('Version="4.0" TipoDeComprobante="I" Folio="F-123"');
    expect(x).toContain(`IdCCP="${ID}"`);
    expect(x).toContain('TranspInternac="No"');
    expect(x).toContain('TotalDistRec="320"');
    // 15:00Z = 09:00 en México (UTC−6 fijo) — el estándar no lleva offset.
    expect(x).toContain('FechaHoraSalidaLlegada="2026-08-27T09:00:00"');
    expect(x).toContain('RFCRemitenteDestinatario="AAA010101AAA"');
    expect(x).toContain('RFCRemitenteDestinatario="BBB010101BB8" DistanciaRecorrida="320"');
    expect(x).toContain('PesoBrutoTotal="1000" UnidadPeso="KGM" NumTotalMercancias="2"');
    expect(x).toContain('BienesTransp="01010101"');
    expect(x).toContain('PesoEnKg="900.5"');
    expect(x).toContain('Cantidad="2.5"');
    expect(x).toContain('PermSCT="TPAF01" NumPermisoSCT="123456"');
    expect(x).toContain('PlacaVM="ABC1234"');
    expect(x).toContain('AnioModeloVM="2020"');
    expect(x).toContain('PesoBrutoVehicular="17.5"');
    expect(x).toContain('PolizaRespCivil="POL-99"');
    expect(x).toContain('TipoFigura="01"');
    expect(x).toContain('NumLicencia="LIC123456"');
    expect(x).toContain('RFCFigura="PEPJ800101AAA"');
    // Domicilios con lo capturado; Pais MEX solo porque se declaró NO internacional.
    expect(x).toContain('Estado="YUC" Pais="MEX" CodigoPostal="97000"');
    expect(x).toContain('Estado="ROO" Pais="MEX" CodigoPostal="77500"');
    expect(r.nombreArchivo).toBe('carta-porte-F-123.xml');
  });

  it('escapa los cinco reservados y no deja & crudos en todo el archivo', () => {
    const r = generarXmlCcp(viajeDe(datosCompletos()), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toContain('Descripcion="Cemento &lt;gris&gt; &amp; arena"');
    expect(r.xml).toContain('Nombre="Juan &quot;El Rayo&quot; Pérez"');
    expect(r.xml).toContain('AseguraRespCivil="Qualitas &amp; Cía"');
    // Ningún & que no sea entidad — la forma barata de "no está roto".
    expect(r.xml.match(/&(?!amp;|lt;|gt;|quot;|apos;)/)).toBeNull();
  });

  it('MaterialPeligroso: declarado sale ("No"), sin declarar NO sale — jamás un "No" supuesto', () => {
    const r = generarXmlCcp(viajeDe(datosCompletos()), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const renglones = r.xml.split('\n').filter((l) => l.includes('<cartaporte31:Mercancia '));
    expect(renglones[0]).toContain('MaterialPeligroso="No"');
    expect(renglones[1]).not.toContain('MaterialPeligroso');
  });

  it('sin permiso SICT capturado: el atributo NO existe y el hueco queda dicho en comentario', () => {
    const d = datosCompletos();
    d.unidad = { ...d.unidad!, permisoSictTipo: null, permisoSictNumero: null };
    const r = generarXmlCcp(viajeDe(d), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).not.toContain('PermSCT=');
    expect(r.xml).not.toContain('NumPermisoSCT=');
    expect(r.xml).toContain('PermSCT/NumPermisoSCT: sin capturar');
  });

  it('sin CP ni estado del cliente: el Domicilio no se inventa — comentario y a capturar', () => {
    const d = datosCompletos();
    d.ccpViaje = { ...d.ccpViaje!, origenCp: null, origenEstado: null };
    const r = generarXmlCcp(viajeDe(d), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toContain('Domicilio: CP y estado sin capturar');
  });

  it('borrador que no arma = cero XML, con los faltantes en la cara', () => {
    const d = datosCompletos();
    d.mercancias = [];
    const r = generarXmlCcp(viajeDe(d), ID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(' ')).toContain('mercancía');
  });

  it('borrador con fallas del validador = cero XML, con las fallas en la cara', () => {
    const d = datosCompletos();
    d.unidad = { ...d.unidad!, placas: 'AB-12-34' };  // guiones: el PAC la rechaza seguro
    const r = generarXmlCcp(viajeDe(d), ID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivos.join(' ')).toContain('PlacaVM');
  });

  it('IdCCP con formato inválido no genera', () => {
    const r = generarXmlCcp(viajeDe(datosCompletos()), 'no-es-un-idccp');
    expect(r.ok).toBe(false);
  });

  it('sin folio, el nombre de archivo usa el prefijo del uuid saneado', () => {
    const r = generarXmlCcp(viajeDe(datosCompletos(), { folio: null }), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nombreArchivo).toBe('carta-porte-11111111.xml');
  });

  it('transpInternac sin declarar: el atributo no sale y el hueco queda listado', () => {
    const d = datosCompletos();
    d.ccpViaje = { ...d.ccpViaje!, transpInternac: null };
    const r = generarXmlCcp(viajeDe(d), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).not.toContain('TranspInternac=');
    expect(r.omitidos.join(' ')).toContain('TranspInternac');
    // Y sin la declaración de "no internacional", el país NO se afirma.
    expect(r.xml).not.toContain('Pais="MEX"');
  });
});

describe('escaparXml y fechaHoraSat — las dos herramientas del generador', () => {
  it('escapa exactamente los cinco reservados', () => {
    expect(escaparXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });
  it('fechaHoraSat: hora de México sin offset; inválida = null, jamás inventada', () => {
    expect(fechaHoraSat('2026-12-31T23:30:00-06:00')).toBe('2026-12-31T23:30:00');
    expect(fechaHoraSat('2027-01-01T05:59:59Z')).toBe('2026-12-31T23:59:59');
    expect(fechaHoraSat('no es fecha')).toBeNull();
  });
});
