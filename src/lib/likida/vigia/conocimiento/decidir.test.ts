import { describe, it, expect } from 'vitest';
import { decidirAccion, violacionesDeBorrador, type EntradaDecision } from './decidir';
import { MATRIZ, CONSERVADURIA, AUTOENVIABLES_MAXIMO, NUNCA_DECIR_GENERAL } from './matriz_accion';
import { TIPOS_SOLICITUD, type TipoSolicitud } from './taxonomia';
import { evaluarEta } from './politica_eta';
import { evaluarEscalamiento } from './escalamiento';
import { mezclarReglas, REGLAS_POR_OMISION } from './reglas_cliente';

const TODOS_LOS_DATOS = ['linea', 'numeroCaja', 'placasCaja', 'estadoCaja', 'eco', 'placaTracto', 'operadorNombre', 'ref', 'cita', 'cuentaEspejo', 'sello', 'estatusPlanta', 'hitoCruce', 'posicionGps', 'cajaVaciaConfirmada',
  'inventarioConfirmado', 'documentoPod', 'documentoVigenteRegistrado', 'existenciasCandadosGps', 'color', 'anio', 'modelo', 'marca', 'lineaTransportista', 'fotosCompletas', 'estadoCcp', 'hitoCruce'];
const d = (texto: string, datos: readonly string[] = [], extra: Partial<EntradaDecision> = {}): ReturnType<typeof decidirAccion> => decidirAccion({ texto, datosDisponibles: datos, ...extra });

const BASE = Date.parse('2026-11-23T00:00:00.000Z');
const t = (h: string): string => new Date(BASE + (Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))) * 60_000).toISOString();
const etaOk = evaluarEta({ ahoraMs: Date.parse(t('09:00')), citaIso: t('10:00'), historial: [{ etaIso: t('09:50'), actualizadoIso: t('08:50'), punto: 'planta', fuente: 'persona', causa: null }], config: { zonaHoraria: 'Centro' } });

describe('la matriz cubre todos los tipos y nunca afloja lo prohibido', () => {
  it('hay una regla por tipo, con el tipo correcto', () => {
    for (const x of TIPOS_SOLICITUD) expect(MATRIZ[x].tipo).toBe(x);
  });
  it('los tipos duros (CCP, salida, cancelación, cambios, daño, custodia, operador) jamás responden con datos', () => {
    for (const x of ['ccp', 'autorizacion_salida', 'cancelacion_falso', 'cambio_instruccion', 'cambio_unidad_operador', 'incidencia', 'datos_operador', 'custodia'] as TipoSolicitud[]) {
      expect(MATRIZ[x].conDatos, x).not.toBe('responder_con_datos');
      expect(MATRIZ[x].sinDatos, x).not.toBe('responder_con_datos');
    }
  });
  it('con TODOS los datos disponibles, esos tipos tampoco se contestan con datos', () => {
    for (const x of ['ccp', 'autorizacion_salida', 'cancelacion_falso', 'cambio_instruccion', 'cambio_unidad_operador', 'incidencia', 'datos_operador', 'custodia'] as TipoSolicitud[]) {
      const r = d('texto', TODOS_LOS_DATOS, { tipos: [x], contexto: { solicitanteVerificado: true, emisor: 'equipo' } });
      expect(r.accion, x).not.toBe('responder_con_datos');
    }
  });
  it('autoenviables como máximo son estatus simples, nunca ficha, CCP, POD ni operador', () => {
    for (const x of ['ficha_unidad', 'ccp', 'pod_doda', 'datos_operador', 'autorizacion_salida', 'sello_foto', 'qr_acceso', 'cancelacion_falso'] as TipoSolicitud[]) expect(AUTOENVIABLES_MAXIMO).not.toContain(x);
  });
  it('conservaduría: prohibido > escalar > solo_registrar > avisar > pedir > responder', () => {
    expect(CONSERVADURIA.prohibido).toBeGreaterThan(CONSERVADURIA.escalar_gerente);
    expect(CONSERVADURIA.escalar_gerente).toBeGreaterThan(CONSERVADURIA.solo_registrar);
    expect(CONSERVADURIA.solo_registrar).toBeGreaterThan(CONSERVADURIA.avisar_encargado);
    expect(CONSERVADURIA.avisar_encargado).toBeGreaterThan(CONSERVADURIA.pedir_dato_a_persona);
    expect(CONSERVADURIA.pedir_dato_a_persona).toBeGreaterThan(CONSERVADURIA.responder_con_datos);
  });
});

describe('PROHIBIDOS', () => {
  it('autorizar la salida: quien se lo pide al agente recibe «prohibido»; la autorización del cliente solo se registra', () => {
    expect(d('ya puedo salir?', [], { contexto: { emisor: 'operador' } }).accion).toBe('prohibido');
    expect(d('ya puedo salir?', [], { contexto: { emisor: 'equipo' } }).accion).toBe('prohibido');
    const cliente = d('adelante con el viaje', [], { contexto: { emisor: 'cliente' } });
    expect(cliente.accion).toBe('solo_registrar');
    expect(cliente.nivelAviso).toBe('N1');
    expect(d('adelante con el viaje', [], { contexto: { emisor: 'operador' } }).accion).toBe('prohibido');
  });
  it('cotizar o negar falsos y demoras: siempre a gerencia, sin respuesta con cifras', () => {
    for (const x of ['habrá cargo por el falso?', 'cuánto cuesta la demora?', 'nos cotizan la estadía', 'cuál es la tarifa del extraordinario']) {
      const r = d(x);
      expect(r.accion, x).toBe('escalar_gerente');
      expect(r.nivelAviso, x).toBe('N2');
    }
  });
  it('datos del operador: sin solicitante verificado se registra y se avisa a seguridad; aun verificado decide una persona', () => {
    const desconocido = d('me das el teléfono del operador?', ['operadorNombre'], { contexto: { solicitanteVerificado: false } });
    expect(desconocido.accion).toBe('solo_registrar');
    expect(desconocido.nivelAviso).toBe('N2');
    expect(d('me das el teléfono del operador?', ['operadorNombre']).accion).toBe('solo_registrar'); // sin verificar = no verificado
    expect(d('me das el teléfono del operador?', ['operadorNombre'], { contexto: { solicitanteVerificado: true } }).accion).toBe('avisar_encargado');
  });
  it('tocar CCP/POD/DODA/sellos: nunca los emite; la CCP se avisa o se registra la corrección', () => {
    expect(d('me ayudan con la ccp', TODOS_LOS_DATOS).accion).toBe('avisar_encargado');
    expect(d('la ccp tiene mal el peso', TODOS_LOS_DATOS).accion).toBe('solo_registrar');
    expect(d('la ccp lleva 90 min', [], { contexto: { ccpMinSinTimbrar: 90 } , tipos: ['ccp'] }).accion).toBe('escalar_gerente');
    expect(d('mándame el pod', [], { contexto: { soloHayCartaPorteSellada: true } }).camposFaltantes).toEqual(['documentoPod']);
    expect(d('cual es el sello?', []).accion).toBe('pedir_dato_a_persona');
    expect(d('cual es el sello?', ['sello']).accion).toBe('responder_con_datos');
  });
  it('inventar datos: sin dato confirmado nunca responde con datos; pide y lista lo que falta', () => {
    for (const [txt, falta] of [['cuenta espejo por favor', 'cuentaEspejo'], ['cual es el sello?', 'sello'], ['cruzó la caja 4?', 'hitoCruce'], ['me mandan el pod?', 'documentoPod'], ['ya le dieron acceso?', 'estatusPlanta'], ['me ayudas colocando una caja vacía', 'cajaVaciaConfirmada']] as const) {
      const r = d(txt, []);
      expect(r.accion, txt).toBe('pedir_dato_a_persona');
      expect(r.camposFaltantes, txt).toContain(falta);
      expect(r.nivelAviso, txt).toBe('N1');
    }
  });
  it('lo no reconocido va a una persona; nunca se contesta algo que no se entiende', () => {
    for (const x of ['jajaja', 'gracias', '']) {
      const r = d(x);
      expect(r.accion, x).toBe('avisar_encargado');
      expect(r.tipos).toEqual(['otro']);
    }
  });
});

describe('borradores: frases prohibidas', () => {
  it('detecta promesa de ETA, autorización, cobros, culpa, disponibilidad y acuses vacíos', () => {
    expect(violacionesDeBorrador('Llego a las 10 sin falta')).toContain('promesa_de_eta');
    expect(violacionesDeBorrador('te aseguro que llega')).toContain('promesa_de_eta');
    expect(violacionesDeBorrador('Adelante con el viaje')).toContain('autoriza_salida');
    expect(violacionesDeBorrador('ya puedes salir')).toContain('autoriza_salida');
    expect(violacionesDeBorrador('no habrá cargo por el falso')).toContain('cotiza_o_niega_cobro');
    expect(violacionesDeBorrador('son 120 USD')).toContain('cotiza_o_niega_cobro');
    expect(violacionesDeBorrador('es culpa de la planta')).toContain('culpa_a_terceros');
    expect(violacionesDeBorrador('no hay unidad para mañana')).toContain('disponibilidad_por_decision_propia');
    expect(violacionesDeBorrador('reviso y te digo')).toContain('acuse_vacio');
  });
  it('afirmar «ya cruzó», «ya está timbrada» o un sello sin registro es violación; con registro, no', () => {
    expect(violacionesDeBorrador('ya cruzó la caja')).toContain('cruce_sin_registro');
    expect(violacionesDeBorrador('ya cruzó la caja', ['hitoCruce'])).not.toContain('cruce_sin_registro');
    expect(violacionesDeBorrador('la ccp ya está timbrada')).toContain('documento_sin_registro');
    expect(violacionesDeBorrador('la ccp ya está timbrada', ['estadoCcp'])).not.toContain('documento_sin_registro');
    expect(violacionesDeBorrador('el sello es 49085')).toContain('sello_sin_registro');
    expect(violacionesDeBorrador('el sello es 49085', ['sello'])).not.toContain('sello_sin_registro');
  });
  it('un borrador limpio con dato y plazo pasa; uno con frase prohibida convierte la decisión en «prohibido»', () => {
    expect(violacionesDeBorrador('Aún no hay ETA para R-1/12. Ya avisé a encargado; te escribo a más tardar 08:45.')).toEqual([]);
    const r = d('eta?', [], { contexto: { borrador: 'Llegamos a las 10 sin falta' } });
    expect(r.accion).toBe('prohibido');
    expect(r.motivo).toContain('promesa_de_eta');
  });
});

describe('señales que solo endurecen', () => {
  it('ETA: el agente solo retransmite el vigente; sin él pide; si cambió sin causa se retiene', () => {
    expect(d('eta?', [], { contexto: { eta: etaOk } }).accion).toBe('responder_con_datos');
    expect(d('eta?', []).accion).toBe('pedir_dato_a_persona');
    const cambio = evaluarEta({ ahoraMs: Date.parse(t('11:30')), citaIso: t('14:00'), config: { zonaHoraria: 'Centro' },
      historial: [{ etaIso: t('13:00'), actualizadoIso: t('11:10'), punto: 'planta', fuente: 'persona', causa: null }, { etaIso: t('13:30'), actualizadoIso: t('11:25'), punto: 'planta', fuente: 'persona', causa: null }] });
    const r = d('eta?', [], { contexto: { eta: cambio } });
    expect(r.accion).toBe('avisar_encargado');
    expect(r.nuncaDecir.join(' ')).toMatch(/en breve/);
  });
  it('repregunta, urgencia y ráfaga solo suben el aviso o la acción, nunca la bajan', () => {
    const base = d('cual es el sello?', ['sello']);
    expect(base).toMatchObject({ accion: 'responder_con_datos', nivelAviso: null });
    const rep = d('cual es el sello?', ['sello'], { contexto: { repreguntas: 1, minutosEsperando: 12 } });
    expect(rep.nivelAviso).toBe('N1');
    expect(CONSERVADURIA[rep.accion]).toBeGreaterThanOrEqual(CONSERVADURIA[base.accion]);
    expect(d('cual es el sello? me urge', ['sello']).nivelAviso).toBe('N1');
    const raf = d('cual es el sello?', ['sello'], { contexto: { rafaga: true } });
    expect(raf).toMatchObject({ accion: 'escalar_gerente', nivelAviso: 'N2' });
    expect(d('cual es el sello?', [], { contexto: { repreguntas: 1, minutosEsperando: 5 } }).nivelAviso).toBe('N1');
  });
  it('un nivel N2/N3 del escalamiento sube la acción a escalar_gerente', () => {
    const esc = evaluarEscalamiento({ ahoraMs: 0, mensajes: [], desvioDeRuta: true });
    expect(d('cual es el sello?', ['sello'], { contexto: { escalamiento: esc } })).toMatchObject({ accion: 'escalar_gerente', nivelAviso: 'N2' });
    const n3 = evaluarEscalamiento({ ahoraMs: 0, mensajes: [], operadorEsperandoMin: 700 });
    const solo = d('cancelen la de mañana', [], { contexto: { escalamiento: n3 } });
    expect(solo).toMatchObject({ accion: 'escalar_gerente', nivelAviso: 'N3' });
  });
  it('discrepancias (V1-V21) retienen la respuesta y avisan', () => {
    const r = d('cual es el sello?', ['sello'], { contexto: { discrepancias: ['V9'] } });
    expect(r.accion).toBe('avisar_encargado');
    expect(r.motivo).toContain('V9');
  });
  it('solicitante no verificado: se registra y se avisa, no se responde', () => {
    const r = d('cual es el sello?', ['sello'], { contexto: { solicitanteVerificado: false } });
    expect(r.accion).toBe('solo_registrar');
  });
  it('varias solicitudes en un mensaje: gana la acción más conservadora y se juntan los faltantes', () => {
    const r = d('me ayudan con los datos de la unidad y la ccp, y el sello', ['sello']);
    expect(r.tipos).toEqual(expect.arrayContaining(['ficha_unidad', 'ccp', 'sello_foto']));
    expect(r.accion).toBe('avisar_encargado');
    expect(r.camposFaltantes).toContain('operadorNombre');
    expect(r.desglose.length).toBe(r.tipos.length);
  });
});

describe('ficha y datos sensibles', () => {
  it('con la ficha completa responde (con aprobación); con campos pendientes manda lo confirmado y pide el resto', () => {
    const completa = d('datos de la unidad', REGLAS_POR_OMISION.camposFichaObligatorios);
    expect(completa).toMatchObject({ accion: 'responder_con_datos', plantillaId: 'ficha_unidad', requiereAprobacion: true, envioParcial: false });
    const parcial = d('datos de la unidad', ['linea', 'numeroCaja', 'ref']);
    expect(parcial).toMatchObject({ accion: 'pedir_dato_a_persona', envioParcial: true, plantillaId: 'ficha_unidad' });
    const nada = d('datos de la unidad', []);
    expect(nada).toMatchObject({ accion: 'pedir_dato_a_persona', envioParcial: false, plantillaId: 'falta_dato' });
  });
  it('los campos obligatorios son configuración del cliente', () => {
    const reglas = mezclarReglas(REGLAS_POR_OMISION, { camposFichaObligatorios: ['linea', 'numeroCaja'] });
    expect(d('datos', ['linea', 'numeroCaja'], { config: { reglas } }).accion).toBe('responder_con_datos');
    expect(d('datos', ['linea'], { config: { reglas } }).camposFaltantes).toEqual(['numeroCaja']);
  });
  it('si la flota muestra datos del operador, solo a un solicitante verificado', () => {
    const datos = REGLAS_POR_OMISION.camposFichaObligatorios;
    expect(d('datos de la unidad', datos, { config: { mostrarDatosOperador: true } }).accion).toBe('avisar_encargado');
    expect(d('datos de la unidad', datos, { config: { mostrarDatosOperador: true }, contexto: { solicitanteVerificado: true } }).accion).toBe('responder_con_datos');
  });
});

describe('aprobación humana y autoenvío', () => {
  it('por omisión nada se autoenvía', () => {
    for (const x of TIPOS_SOLICITUD) expect(d('texto', TODOS_LOS_DATOS, { tipos: [x], contexto: { eta: etaOk, solicitanteVerificado: true } }).requiereAprobacion, x).toBe(true);
  });
  it('solo un estatus simple, autorizado expresamente por la flota y sin ninguna señal, puede salir sin aprobación', () => {
    const e = { contexto: { eta: etaOk }, config: { autoenvioPermitido: ['eta' as const] } };
    expect(d('eta?', [], e).requiereAprobacion).toBe(false);
    expect(d('eta?', [], { ...e, contexto: { eta: etaOk, repreguntas: 1, minutosEsperando: 20 } }).requiereAprobacion).toBe(true);
    expect(d('eta? me urge', [], e).requiereAprobacion).toBe(true);
  });
  it('un tipo fuera de la lista corta no se autoenvía aunque la flota lo pida', () => {
    expect(d('datos de la unidad', REGLAS_POR_OMISION.camposFichaObligatorios, { config: { autoenvioPermitido: ['ficha_unidad'] } }).requiereAprobacion).toBe(true);
    expect(d('cual es el sello?', ['sello'], { config: { autoenvioPermitido: ['sello_foto'] } }).requiereAprobacion).toBe(true);
  });
});

describe('forma de la decisión', () => {
  it('siempre incluye la lista general de lo que nunca se dice y el desglose por tipo', () => {
    const r = d('eta?', []);
    for (const x of NUNCA_DECIR_GENERAL) expect(r.nuncaDecir).toContain(x);
    expect(r.desglose[0]).toMatchObject({ tipo: 'eta', accion: 'pedir_dato_a_persona' });
  });
  it('es determinista y no muta la entrada', () => {
    const entrada: EntradaDecision = { texto: 'datos de la unidad y eta', datosDisponibles: ['linea'], contexto: { eta: etaOk } };
    const copia = JSON.stringify(entrada);
    expect(decidirAccion(entrada)).toEqual(decidirAccion(entrada));
    expect(JSON.stringify(entrada)).toBe(copia);
  });
  it('un programa publicado se registra y no se mezcla con «drop» o «vivo»', () => {
    const r = d('programa de mañana: 08:00 1 en vivo; 12:00 1 en drop', [], { contexto: { programaRecibido: true } });
    expect(r).toMatchObject({ accion: 'solo_registrar', tipos: ['pool_programa'], plantillaId: 'confirmacion_programa' });
  });
});
