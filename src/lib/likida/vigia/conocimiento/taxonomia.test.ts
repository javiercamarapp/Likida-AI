import { describe, it, expect } from 'vitest';
import { detectarSolicitudes, detectarUrgencia, etiquetasDeLectura, tiposDePeticion, TIPOS_SOLICITUD, META_SOLICITUD, type TipoSolicitud } from './taxonomia';
import { tiposDeSolicitud } from '../peticion';

// Frases sintéticas con el habla real de los grupos (telegráfico, sin acentos, abreviaturas, errores). Nada de nombres reales.
const CASOS: ReadonlyArray<readonly [TipoSolicitud, readonly string[]]> = [
  ['ficha_unidad', ['me apoyas con datos de las unidades de hoy pls', 'tendrán datos?', 'datos plis', 'me ayudan con los datos de las dos cajitas de hoy', 'me faltan teléfono del operador y licencia',
    'necesito los datos de estas referencias', 'datos de la 2da unidad', 'me ayudas con el segundo apellido', 'nos confirman el número de caja', 'DATOS DE LA UNIDAD DE HOY']],
  ['eta', ['que eta tenemos?', 'me ayudas con eta actualizado plis', 'mismo eta?', 'se mantiene eta de 11?', 'a q hr llego xfas', 'cuál es el nuevo eta', 'ya llegó?', 'ya son las 10!!!',
    'pq cambió mucho el ETA?', 'apóyame con status cada media hora', 'ETA cada 2 hrs', 'hr de salida de las cargas de hoy', 'cuando llega?']],
  ['cuenta_espejo', ['me apoyan con la cuenta espejo de la unidad 4', 'el link ya expiró', 'CE de omnitracs', 'me pasan cuenta espejo', 'la que teníamos expiró']],
  ['ccp', ['me ayudan con la ccp caja 12', 'nos ayudan con cp de cruce de favor', 'CCP actualizado', 'nuevo folio fiscal', 'falta el timbrado', 'me urge ccp', 'carta porte de la caja 3']],
  ['sello_foto', ['nos confirman el sellos pls', 'falta foto del candado satelital y foto del otro sello', 'falta la foto del tablero display y el nivel de combustible', 'cuál es el número de sello?', 'nos ayudan con el nvo sello']],
  ['autorizacion_salida', ['nos apoyan con salida de favor', 'me apoyan con salida team', 'nos ayudan con luz verde pf', 'adelante con el viaje', 'ocupan autorización para salir a ruta', 'ya puedo salir?']],
  ['estatus_planta_ingreso', ['nos ayudan con ingreso', 'ya nos dieron acceso?', 'seguimos sin rampa', 'ayuda con status de cada caja que ya está en embarcador', 'chicos como vamos']],
  ['estatus_cruce', ['como van los cruces de expo?', 'cómo va el cruce?', 'ya estamos en inspeccion?', 'caja 12 en aduana mexicana, modulando', 'Me confirmas qué cajas cruzaron ayer?', 'el doda sigue vigente?']],
  ['estatus_ruta_detencion', ['me aparece detenida, me apoyan con reinicio', 'la unidad se esta desviando', 'no está autorizado', 'se visualiza detención', 'paro total a la altura de la caseta', 'me apoyan con motivo de detención unidad 4']],
  ['caja_vacia_colocacion', ['me ayudas colocando por favor 3 cajas vacías hoy?', 'podemos posicionar 4 cajas?', 'tendrán caja vacía en la frontera?', 'nos deben dos', 'ya quedó colocada??', 'nos falta la caja vacía']],
  ['pool_programa', ['Comparto programa actualizado para mañana', 'me ayudas programando 1 caja seca', 'no tendremos programa?', 'me ayudas con el POOL', 'me ayudas con el inventario por favor', 'forecast de mañana']],
  ['prealerta_acceso', ['no tienen prealerta', 'le comentan al op que no hay pre alerta', 'operador sin ingreso']],
  ['qr_acceso', ['nos apoyan con QR para ingreso', 'nos ayudan con qr de acceso por favor', 'no viene el tracto en el QR', 'QR para retiro de caja 8']],
  ['pod_doda', ['me apoyan con el POD de la caja 4 (DODA firmado)', 'nos urgen los POD', 'ocupamos el DODA como POD', 'no aceptamos carta porte como POD', 'necesitamos el ticket de pesaje']],
  ['facturacion_documentos', ['nos urge facturar', 'falta la póliza de seguro', 'mandan la fianza?', 'me pasan la tarjeta de circulación']],
  ['cancelacion_falso', ['se cancela la de las 13 hrs', 'No enviar la de hoy, reprograman a martes', 'Se queda de drop porfa', 'favor de no enviar las unidades', 'retiren con todo y caja o drop', 'habrá cargo por el falso?', 'envíen el monto de demoras']],
  ['cambio_instruccion', ['entregar en otro destino, es importante', 'cambio de destino para mañana', 'nueva dirección de entrega']],
  ['cambio_unidad_operador', ['cambio de caja por filtración', 'se cambió el tracto', 'cambiaron al operador', 'cambio de unidad a última hora']],
  ['incidencia', ['llanta suelta posición 8', 'alto total por accidente', 'falla el secador', 'caja con bolsas dañadas', 'hay filtración', 'bisagras rotas', 'el candado electrónico no marca cerrado']],
  ['datos_operador', ['me das el teléfono del operador de la caja 12?', 'dame el celular del chofer', 'donde esta el operador']],
  ['candado_gps_stock', ['lleven 2 candados y 2 gps', 'cuántos candados hay en stock de candados']],
  ['custodia', ['se presentan 2 custodias por la caja 8, es la correcta?', 'las custodias ya están en patio']],
  ['urgencia', ['meurgen', 'me urge porfa', 'URGEN!!', 'ASAP', '???', 'equipo?', 'alguien en turno?', 'CHICOOOOS', 'Necesitamos respuesta en 15 min', 'tengo al cliente presionando']],
];

describe('detectarSolicitudes: vocabulario real, varias etiquetas a la vez', () => {
  for (const [tipo, frases] of CASOS) {
    for (const f of frases) {
      it(`${tipo} ← «${f}»`, () => { expect(detectarSolicitudes(f)).toContain(tipo); });
    }
  }
});

describe('combinaciones y exclusiones', () => {
  it('una petición suele llevar varios tipos', () => {
    const t = detectarSolicitudes('me ayudan con la ccp de la caja 4 y hora de salida, me urge');
    expect(t).toEqual(expect.arrayContaining(['ccp', 'eta', 'urgencia']));
  });
  it('«qr de acceso» no es un estatus de planta; «cp de cruce» no es un estatus de cruce', () => {
    expect(detectarSolicitudes('nos ayudan con qr de acceso')).not.toContain('estatus_planta_ingreso');
    expect(detectarSolicitudes('nos ayudan con cp de cruce')).not.toContain('estatus_cruce');
    expect(detectarSolicitudes('nos ayudan con cp de cruce')).toContain('ccp');
  });
  it('«como vamos con el sello» es del sello, no un estatus genérico de planta', () => {
    const t = detectarSolicitudes('como vamos con el sello?');
    expect(t).toContain('sello_foto');
    expect(t).not.toContain('estatus_planta_ingreso');
  });
  it('lo que no se reconoce es «otro» y nunca vacío', () => {
    for (const x of ['gracias', 'ok', 'buen día', '', '   ', 'jajaja', '👍']) expect(detectarSolicitudes(x)).toEqual(['otro']);
    expect(detectarSolicitudes(undefined as unknown as string)).toEqual(['otro']);
  });
  it('urgencia es un modificador y no cuenta como petición', () => {
    expect(tiposDePeticion(['ccp', 'urgencia'])).toEqual(['ccp']);
    expect(tiposDePeticion(['urgencia'])).toEqual([]);
    expect(detectarUrgencia('???')).toBe(true);
    expect(detectarUrgencia('buenas tardes')).toBe(false);
  });
  it('el orden de salida sigue el de TIPOS_SOLICITUD y no repite', () => {
    const t = detectarSolicitudes('datos de la unidad, eta, ccp, qr, urgente');
    expect(new Set(t).size).toBe(t.length);
    const idx = t.map((x) => TIPOS_SOLICITUD.indexOf(x));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
  it('un texto enorme no cuelga el clasificador (sin retroceso exponencial)', () => {
    const t0 = Date.now();
    detectarSolicitudes('datos '.repeat(5000) + 'unidad ' + 'a'.repeat(20000));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('metadatos y puente con las etiquetas de lectura previas', () => {
  it('todos los tipos tienen definición y ventana', () => {
    for (const t of TIPOS_SOLICITUD) {
      expect(META_SOLICITUD[t].definicion.length).toBeGreaterThan(10);
      expect(META_SOLICITUD[t].ventanaTipica.length).toBeGreaterThan(3);
    }
    expect(META_SOLICITUD.urgencia.modificador).toBe(true);
  });
  it('lo que reconocía peticion.ts también lo reconoce el clasificador experto', () => {
    const frases = ['nos ayudan con cp de cruce', 'hora de salida de la caja 3', 'me ayudan con los datos de las cajitas', 'qr para ingreso', 'como vamos', 'ya cruzo?', 'foto del sello', 'el pod de la caja 4', 'me urge', 'programa de mañana', 'cajas vacias para colocar'];
    for (const f of frases) {
      const lectura = etiquetasDeLectura(f);
      expect(tiposDeSolicitud(f).length, f).toBeGreaterThan(0);
      expect(detectarSolicitudes(f).some((t) => lectura.includes(t)), `${f} → ${detectarSolicitudes(f)} vs ${lectura}`).toBe(true);
    }
  });
});
