import { describe, it, expect } from 'vitest';
import {
  configNoExcedeC2, necesitaCartaPorte, checklistCcp, validarComplemento,
  generarIdCcp, ID_CCP_RE, CAMPOS_CCP, armarBorrador, pesoBrutoDe,
  type EntradaDecision, type DatosChecklist, type ComplementoBorrador,
  type MercanciaCapturada,
} from './carta_porte';

// ═══════════════════════════════════════════════════════════════════════════
// Las reglas fiscales del complemento, fijadas contra la investigación
// verificada (02-carta-porte.md). El principio que gobierna todo: CON HUECOS
// NO SE DECIDE — un "no necesita" adivinado vale una presunción de contrabando.
// ═══════════════════════════════════════════════════════════════════════════

const BASE: EntradaDecision = {
  pisaTramoFederal: true,
  configVehicular: 'T3S2',
  radioFederalKm: null,
  materiaExcluida: false,
};

describe('configNoExcedeC2', () => {
  it('VL y C2 caben; el tractocamión típico no', () => {
    expect(configNoExcedeC2('C2')).toBe(true);
    expect(configNoExcedeC2('VL')).toBe(true);
    expect(configNoExcedeC2('T3S2')).toBe(false);
    expect(configNoExcedeC2('C3')).toBe(false);
  });

  it('una configuración desconocida NO se adivina: null', () => {
    expect(configNoExcedeC2('GPLUTX')).toBeNull();
    expect(configNoExcedeC2(null)).toBeNull();
    expect(configNoExcedeC2('  ')).toBeNull();
  });

  it('el C2 con remolque va del lado seguro: excede', () => {
    // La facilidad del remolque (2.7.7.2.8 segundo párrafo) exige verificar
    // pesos contra la NOM; desde un catálogo no se puede, y el lado seguro es
    // exigir el complemento.
    expect(configNoExcedeC2('C2R2')).toBe(false);
  });
});

describe('necesitaCartaPorte — el árbol de tres entradas', () => {
  it('materia excluida gana sobre todo: hidrocarburos locales llevan complemento', () => {
    const d = necesitaCartaPorte({ ...BASE, pisaTramoFederal: false, materiaExcluida: true });
    expect(d.necesita).toBe('si');
    expect(d.fundamento).toContain('2.7.7.2.4');
  });

  it('sin declarar si pisa federal, NO se decide', () => {
    const d = necesitaCartaPorte({ ...BASE, pisaTramoFederal: null });
    expect(d.necesita).toBe('falta_declarar');
    expect(d.pendientes).toHaveLength(1);
    expect(d.motivo).toContain('plena certeza');
  });

  it('traslado local sin exclusiones: sin complemento, pero el CFDI se emite igual', () => {
    const d = necesitaCartaPorte({ ...BASE, pisaTramoFederal: false });
    expect(d.necesita).toBe('no');
    expect(d.motivo).toContain('78101801');
  });

  it('federal + unidad mayor que C2: complemento, punto', () => {
    const d = necesitaCartaPorte({ ...BASE, radioFederalKm: 5 });
    expect(d.necesita).toBe('si');
    expect(d.motivo).toContain('T3S2');
  });

  it('federal + C2 + radio ≤ 30 km: la excepción aplica y se dice que es un RADIO', () => {
    const d = necesitaCartaPorte({ ...BASE, configVehicular: 'C2', radioFederalKm: 25 });
    expect(d.necesita).toBe('no');
    expect(d.fundamento).toContain('2.7.7.2.8');
  });

  it('federal + C2 + radio de 31 km: no alcanza', () => {
    expect(necesitaCartaPorte({ ...BASE, configVehicular: 'C2', radioFederalKm: 31 }).necesita).toBe('si');
  });

  it('federal + C2 sin radio medido: falta declarar, con la advertencia de que es radio y no odómetro', () => {
    const d = necesitaCartaPorte({ ...BASE, configVehicular: 'C2' });
    expect(d.necesita).toBe('falta_declarar');
    expect(d.pendientes[0]).toContain('RADIO');
  });

  it('federal + configuración desconocida: pide confirmar contra la NOM, no supone', () => {
    const d = necesitaCartaPorte({ ...BASE, configVehicular: 'RARO1', radioFederalKm: 10 });
    expect(d.necesita).toBe('falta_declarar');
    expect(d.pendientes[0]).toContain('NOM-012');
  });
});

describe('los 37 campos del Apéndice 3', () => {
  it('son exactamente 19 del cliente y 18 del transportista', () => {
    expect(CAMPOS_CCP.filter((c) => c.responsable === 'cliente')).toHaveLength(19);
    expect(CAMPOS_CCP.filter((c) => c.responsable === 'transportista')).toHaveLength(18);
  });

  const DATOS: DatosChecklist = {
    viaje: { origen: 'Monterrey', destino: 'Querétaro', fechaInicio: '2026-08-14', kmRecorridos: 700 },
    clienteRfc: 'TME960204P56',
    unidad: {
      placas: 'ABC1234', anio: 2019, configVehicular: 'T3S2', pesoBrutoTon: 17.5,
      aseguradoraRc: 'Qualitas', polizaRcNumero: 'POL-998877',
      permisoSictTipo: 'TPAF01', permisoSictNumero: '1234567890',
    },
    operador: { nombre: 'Juan Pérez', rfc: 'PEPJ800101AAA', licencia: 'LIC123456' },
  };

  it('con todo capturado, el lado del transportista queda listo', () => {
    const c = checklistCcp(DATOS);
    expect(c.faltanTransportista).toBe(0);
    expect(c.transportistaListo).toBe(true);
  });

  it('los campos del cliente sin capturar salen como faltantes DEL CLIENTE, no se esconden', () => {
    const c = checklistCcp(DATOS);
    // Desde la 0204 el peso, las mercancías y los CP SÍ tienen casilla —
    // sin capturar cuentan como FALTA del cliente (`false`), ya no como
    // "sin casilla en Likida" (`null`).
    expect(c.faltanCliente).toBeGreaterThan(10);
    const peso = c.campos.find((x) => x.clave === 'peso_bruto_total');
    expect(peso?.presente).toBe(false);
  });

  it('sin unidad asignada, faltan los 8 datos vehiculares y de permiso', () => {
    const c = checklistCcp({ ...DATOS, unidad: null });
    expect(c.transportistaListo).toBe(false);
    expect(c.faltanTransportista).toBe(8);
  });

  it('un km_recorridos vacío NO es un cero: falta la distancia', () => {
    const c = checklistCcp({ ...DATOS, viaje: { ...DATOS.viaje, kmRecorridos: null } });
    const dist = c.campos.find((x) => x.clave === 'total_dist_rec');
    expect(dist?.presente).toBe(false);
  });

  // ── Los del cliente con casilla desde la 0204 ────────────────────────────

  const MERCANCIA: MercanciaCapturada = {
    descripcion: 'Cajas de aguacate', bienesTransp: '50301700', cantidad: 120,
    claveUnidad: 'XBX', pesoKg: 1200, materialPeligroso: false,
  };
  const CCP_VIAJE = {
    origenCp: '64000', destinoCp: '76000', origenEstado: 'Nuevo León',
    destinoEstado: 'Querétaro', rfcDestinatario: 'DES010101AB1', transpInternac: false,
  };

  it('con mercancía y datos del cliente completos, el lado del cliente queda en cero faltantes', () => {
    const c = checklistCcp({ ...DATOS, ccpViaje: CCP_VIAJE, mercancias: [MERCANCIA] });
    expect(c.faltanCliente).toBe(0);
  });

  it('el país SOLO se deriva con "no internacional" declarado — sin la declaración, ni MEX se supone', () => {
    const sinDeclarar = checklistCcp({ ...DATOS, ccpViaje: { ...CCP_VIAJE, transpInternac: null }, mercancias: [MERCANCIA] });
    expect(sinDeclarar.campos.find((x) => x.clave === 'origen_pais')?.presente).toBe(false);
    const nacional = checklistCcp({ ...DATOS, ccpViaje: CCP_VIAJE, mercancias: [MERCANCIA] });
    expect(nacional.campos.find((x) => x.clave === 'origen_pais')?.valor).toBe('MEX');
  });

  it('una mercancía sin peso tumba el peso bruto TOTAL: una suma parcial no se hace pasar por total', () => {
    const c = checklistCcp({
      ...DATOS, ccpViaje: CCP_VIAJE,
      mercancias: [MERCANCIA, { ...MERCANCIA, pesoKg: null }],
    });
    expect(c.campos.find((x) => x.clave === 'peso_bruto_total')?.presente).toBe(false);
    expect(pesoBrutoDe([MERCANCIA, { ...MERCANCIA, pesoKg: null }])).toBeNull();
    expect(pesoBrutoDe([MERCANCIA, MERCANCIA])).toBe(2400);
  });
});

describe('armarBorrador — el entregable de la Fase C', () => {
  const MERCANCIA: MercanciaCapturada = {
    descripcion: 'Cajas de aguacate', bienesTransp: '50301700', cantidad: 120,
    claveUnidad: 'XBX', pesoKg: 1200, materialPeligroso: false,
  };
  const COMPLETO: DatosChecklist = {
    viaje: { origen: 'Monterrey', destino: 'Querétaro', fechaInicio: '2026-08-14T08:00:00', kmRecorridos: 700 },
    clienteRfc: 'TME960204P56',
    unidad: {
      placas: 'ABC1234', anio: 2019, configVehicular: 'T3S2', pesoBrutoTon: 17.5,
      aseguradoraRc: 'Qualitas', polizaRcNumero: 'POL-998877',
      permisoSictTipo: 'TPAF01', permisoSictNumero: '1234567890',
    },
    operador: { nombre: 'Juan Pérez', rfc: 'PEPJ800101AAA', licencia: 'LIC123456' },
    ccpViaje: {
      origenCp: '64000', destinoCp: '76000', origenEstado: 'Nuevo León',
      destinoEstado: 'Querétaro', rfcDestinatario: 'DES010101AB1', transpInternac: false,
    },
    mercancias: [MERCANCIA],
  };

  it('con todo capturado arma un borrador de INGRESO que pasa el validador del PAC', () => {
    const r = armarBorrador(COMPLETO);
    expect(r.faltantes).toEqual([]);
    expect(r.borrador).not.toBeNull();
    expect(r.borrador?.tipoComprobante).toBe('I');
    expect(r.borrador?.pesoBrutoTotal).toBe(1200);
    expect(r.borrador?.numTotalMercancias).toBe(1);
    expect(r.fallas).toEqual([]);
  });

  it('sin mercancía NO se arma un borrador a medias: null, con el faltante dicho', () => {
    const r = armarBorrador({ ...COMPLETO, mercancias: [] });
    expect(r.borrador).toBeNull();
    expect(r.faltantes.join(' ')).toContain('mercancía');
  });

  it('la clave SAT que el cliente no ha dado JAMÁS se inventa: el borrador no se arma y lo dice', () => {
    const r = armarBorrador({ ...COMPLETO, mercancias: [{ ...MERCANCIA, bienesTransp: null }] });
    expect(r.borrador).toBeNull();
    expect(r.faltantes.join(' ')).toContain('no se inventa');
  });

  it('material peligroso sin declarar NO se supone «no»: advierte, y un «sí» declarado también', () => {
    const sinDeclarar = armarBorrador({ ...COMPLETO, mercancias: [{ ...MERCANCIA, materialPeligroso: null }] });
    expect(sinDeclarar.advertencias.join(' ')).toContain('sin declarar');
    const peligroso = armarBorrador({ ...COMPLETO, mercancias: [{ ...MERCANCIA, materialPeligroso: true }] });
    // Se arma (nada estructural falta) pero el validador marca la póliza de
    // medio ambiente que el PAC exige — la falla se enseña, no se esconde.
    expect(peligroso.borrador).not.toBeNull();
    expect(peligroso.fallas.map((f) => f.campo)).toContain('AseguraMedAmbiente');
  });

  it('sin RFC del destinatario, sin placas o sin operador: faltantes con nombre y dónde capturarlos', () => {
    const r = armarBorrador({
      ...COMPLETO,
      ccpViaje: { ...(COMPLETO.ccpViaje as NonNullable<DatosChecklist['ccpViaje']>), rfcDestinatario: null },
      unidad: null,
      operador: null,
    });
    expect(r.borrador).toBeNull();
    expect(r.faltantes.length).toBeGreaterThanOrEqual(3);
    expect(r.faltantes.join(' ')).toContain('RFC del destinatario');
    expect(r.faltantes.join(' ')).toContain('Placas');
    expect(r.faltantes.join(' ')).toContain('Operador');
  });
});

describe('validarComplemento — lo que el PAC rechaza seguro', () => {
  const OK: ComplementoBorrador = {
    tipoComprobante: 'I',
    totalDistRec: 700,
    pesoBrutoTotal: 24.5,
    numTotalMercancias: 2,
    mercancias: [
      { bienesTransp: '10101500', descripcion: 'Acero', cantidad: 10, claveUnidad: 'KGM', pesoEnKg: 20 },
      { bienesTransp: '10101500', descripcion: 'Lámina', cantidad: 5, claveUnidad: 'KGM', pesoEnKg: 4.5 },
    ],
    ubicaciones: [
      { tipo: 'Origen', rfc: 'TME960204P56', fechaHora: '2026-08-14T08:00:00' },
      { tipo: 'Destino', rfc: 'TME960204P56', fechaHora: '2026-08-14T20:00:00', distanciaRecorrida: 700 },
    ],
    placaVm: 'ABC1234',
    moneda: 'MXN',
    figuras: [{ tipoFigura: '01', nombre: 'Juan Pérez', numLicencia: 'LIC123456' }],
  };

  it('un complemento bien armado pasa sin fallas', () => {
    expect(validarComplemento(OK)).toEqual([]);
  });

  it('el peso bruto que no suma contra las mercancías se atrapa', () => {
    const f = validarComplemento({ ...OK, pesoBrutoTotal: 25 });
    expect(f.some((x) => x.campo === 'PesoBrutoTotal')).toBe(true);
  });

  it('la distancia total que no cuadra con los destinos se atrapa', () => {
    const f = validarComplemento({ ...OK, totalDistRec: 650 });
    expect(f.some((x) => x.campo === 'TotalDistRec')).toBe(true);
  });

  it('una placa con guion se rechaza antes de llegar al PAC', () => {
    const f = validarComplemento({ ...OK, placaVm: 'ABC-123' });
    expect(f.some((x) => x.campo === 'PlacaVM')).toBe(true);
  });

  it('operador sin licencia: falla; y una figura que NO es operador CON licencia: también', () => {
    expect(validarComplemento({ ...OK, figuras: [{ tipoFigura: '01', nombre: 'X' }] })
      .some((x) => x.campo === 'NumLicencia')).toBe(true);
    expect(validarComplemento({
      ...OK,
      figuras: [
        { tipoFigura: '01', nombre: 'X', numLicencia: 'LIC123456' },
        { tipoFigura: '02', nombre: 'Dueño', numLicencia: 'LIC999999', tienePartesTransporte: true },
      ],
    }).some((x) => x.campo === 'NumLicencia')).toBe(true);
  });

  it('material peligroso sin aseguradora de medio ambiente: falla', () => {
    const f = validarComplemento({
      ...OK,
      mercancias: [{ ...OK.mercancias[0], materialPeligroso: true, pesoEnKg: 24.5 }],
      numTotalMercancias: 1,
    });
    expect(f.some((x) => x.campo === 'AseguraMedAmbiente')).toBe(true);
  });

  it('el CFDI de traslado exige valor cero, moneda XXX, mismo RFC y uso S01', () => {
    const f = validarComplemento({
      ...OK,
      tipoComprobante: 'T',
      subTotal: 100, total: 100, moneda: 'MXN',
      rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', usoCfdi: 'G03',
    });
    const campos = f.map((x) => x.campo);
    expect(campos).toContain('SubTotal');
    expect(campos).toContain('Total');
    expect(campos).toContain('Moneda');
    expect(campos).toContain('Receptor.Rfc');
    expect(campos).toContain('UsoCFDI');
  });

  it('en el de ingreso, la moneda XXX es la falla contraria', () => {
    expect(validarComplemento({ ...OK, moneda: 'XXX' }).some((x) => x.campo === 'Moneda')).toBe(true);
  });
});

describe('IdCCP', () => {
  it('36 caracteres, empieza con CCC y cumple el patrón del estándar', () => {
    const id = generarIdCcp();
    expect(id).toHaveLength(36);
    expect(id.startsWith('CCC')).toBe(true);
    expect(ID_CCP_RE.test(id)).toBe(true);
  });

  it('dos generados no se repiten', () => {
    expect(generarIdCcp()).not.toBe(generarIdCcp());
  });
});
