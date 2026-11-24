import { describe, it, expect } from 'vitest';
import { render, revisarAcuse, hayDato, PLANTILLAS, PENDIENTE, type DatosConfirmados } from './plantillas';
import { esRespuestaVacia } from '../respuesta_vacia';

const FICHA: DatosConfirmados = {
  ref: 'R-001', linea: 'LIN', numeroCaja: '12', placasCaja: 'ABC123', estadoCaja: 'EST', eco: 'E4', placaTracto: 'XYZ987', operadorNombre: 'Operador Uno Dos',
  licencia: 'LIC-000', vigenciaLicencia: '2027-01-01', celular: 'CEL-TEST', sello: 'S-1', tipoTracto: 'regular', accesorios: '2 straps', cuentaEspejo: 'https://ejemplo.test/ce',
  cita: '10:00', eta: '09:20', etaActualizado: '03:58', etaPunto: 'planta',
};

describe('ficha de unidad', () => {
  it('con todo confirmado no deja nada «pendiente»', () => {
    const r = render('ficha_unidad', FICHA);
    expect(r.camposFaltantes).toEqual([]);
    expect(r.texto).not.toContain(PENDIENTE);
    expect(r.texto?.split('\n')[0]).toBe('Ref: R-001 | Caja: LIN 12');
  });
  it('los datos del operador están ocultos por omisión: ni licencia, ni vigencia, ni celular', () => {
    const r = render('ficha_unidad', FICHA);
    expect(r.texto).not.toMatch(/LIC-000|CEL-TEST|2027-01-01|Licencia|Celular/);
    expect(r.camposOcultos).toEqual(expect.arrayContaining(['licencia', 'vigenciaLicencia', 'celular']));
  });
  it('con la opción de privacidad se muestran, y si faltan salen «pendiente de confirmar»', () => {
    const r = render('ficha_unidad', FICHA, { mostrarDatosOperador: true });
    expect(r.texto).toContain('Licencia: LIC-000');
    expect(r.texto).toContain('Celular: CEL-TEST');
    expect(r.camposOcultos).toEqual([]);
    const sin = render('ficha_unidad', { ...FICHA, celular: null }, { mostrarDatosOperador: true });
    expect(sin.texto).toContain(`Celular: ${PENDIENTE}`);
    expect(sin.camposFaltantes).toContain('celular');
  });
  it('lo faltante nunca queda vacío ni inventado: «pendiente de confirmar» y la lista de faltantes', () => {
    const r = render('ficha_unidad', { ref: 'R-001', linea: 'LIN', numeroCaja: '12', operadorNombre: 'Operador Uno Dos' });
    expect(r.texto).toContain(`Placas: ${PENDIENTE}`);
    expect(r.texto).toContain(`Unidad: ${PENDIENTE}`);
    expect(r.camposFaltantes).toEqual(expect.arrayContaining(['placasCaja', 'estadoCaja', 'eco', 'placaTracto', 'cita']));
    expect(r.obligatoriosFaltantes).toEqual(expect.arrayContaining(['placasCaja', 'estadoCaja', 'eco', 'placaTracto', 'cita']));
    expect(r.obligatoriosFaltantes).not.toContain('sello');
    expect(r.camposFaltantes).toContain('sello');
    expect(r.texto).not.toMatch(/:\s*$/m);
  });
  it('cuenta como faltante «pendiente», «N/A», «???», vacío y espacios', () => {
    for (const v of ['pendiente', 'PENDIENTE', 'n/a', '???', '', '   ', 'por confirmar', null, undefined]) expect(hayDato(v), String(v)).toBe(false);
    expect(hayDato('ABC123')).toBe(true);
    expect(hayDato(0)).toBe(true);
    const r = render('ficha_unidad', { ...FICHA, placaTracto: 'pendiente' });
    expect(r.camposFaltantes).toContain('placaTracto');
  });
  it('team y quitapón solo aparecen cuando el servicio los requiere', () => {
    expect(render('ficha_unidad', FICHA).texto).not.toMatch(/Team|Quitapón/);
    const r = render('ficha_unidad', FICHA, { requiereTeam: true, requiereQuitapon: true });
    expect(r.texto).toContain(`Team driver: ${PENDIENTE}`);
    expect(r.texto).toContain(`Quitapón: ${PENDIENTE}`);
    expect(r.camposFaltantes).toEqual(expect.arrayContaining(['teamNombre', 'quitapon']));
  });
  it('una actualización lleva encabezado con el cambio y el motivo', () => {
    const r = render('ficha_unidad', FICHA, { actualizacion: { campo: 'Unidad', de: 'E4', a: 'E7', motivo: 'falla' } });
    expect(r.texto?.split('\n')[0]).toBe('Actualización: Unidad: de E4 a E7; motivo falla.');
  });
  it('limpia saltos de línea de los valores para que no se rompa el formato', () => {
    const r = render('ficha_unidad', { ...FICHA, operadorNombre: 'Operador\nUno   Dos' });
    expect(r.texto).toContain('Operador: Operador Uno Dos');
  });
});

describe('estatus de planta (6 estados)', () => {
  const D = { planta: 'Planta A', linea: 'LIN', numeroCaja: '12', cita: '10:00', eco: 'E4', ref: 'R-001', estatusHora: '09:30', estatusFuente: 'operador' };
  it('acepta solo estados del catálogo', () => {
    const ok = render('estatus_planta', { ...D, estatus: 'En sitio esperando rampa' });
    expect(ok.texto).toContain('Planta A | LIN | 12 | 10:00 | E4 | En sitio esperando rampa');
    const mal = render('estatus_planta', { ...D, estatus: 'ya casi cargado' });
    expect(mal.texto).toBeNull();
    expect(mal.bloqueo).toBe('estado_fuera_de_catalogo');
  });
  it('un catálogo del cliente reemplaza al general', () => {
    expect(render('estatus_planta', { ...D, estatus: 'Estado propio' }, { estadosPlanta: ['Estado propio'] }).texto).toContain('Estado propio');
  });
  it('sin estado ni hora de captura sale pendiente, nunca inventado', () => {
    const r = render('estatus_planta', { ...D, estatus: null, estatusHora: null });
    expect(r.camposFaltantes).toEqual(expect.arrayContaining(['estatus', 'estatusHora']));
  });
});

describe('las demás plantillas', () => {
  it('ETA vigente: hora, actualización y causa solo si hubo cambio', () => {
    const base = { ref: 'R-001', numeroCaja: '12', etaPunto: 'planta', eta: '09:20', zona: 'Centro', etaActualizado: '03:58', posicion: 'tramo 4', posicionHora: '03:50', proximaActualizacion: '06:30' };
    const r = render('eta_vigente', base);
    expect(r.texto).toContain('ETA a planta 09:20 (Centro), actualizado 03:58.');
    expect(r.texto).not.toContain('Cambio vs ETA anterior');
    expect(render('eta_vigente', { ...base, etaAnterior: '09:00', causaCambio: 'diésel' }).texto).toContain('Cambio vs ETA anterior 09:00: diésel.');
    expect(render('eta_vigente', {}).camposFaltantes).toEqual(expect.arrayContaining(['eta', 'etaActualizado', 'zona']));
  });
  it('QR: lista los campos presentes y pide los faltantes', () => {
    const r = render('qr_acceso', { ref: 'R-001', operadorNombre: 'Operador Uno Dos', placaTracto: 'XYZ987', numeroCaja: '12', plazo: '05:10' });
    expect(r.texto).toContain('Datos para QR de R-001: 3/8 campos.');
    expect(r.camposFaltantes).toEqual(['color', 'anio', 'modelo', 'marca', 'lineaTransportista']);
    expect(r.texto).toContain('Pendientes: color, anio, modelo, marca, lineaTransportista');
    const completo = render('qr_acceso', { ref: 'R-001', operadorNombre: 'x', placaTracto: 'x', numeroCaja: 'x', color: 'x', anio: 'x', modelo: 'x', marca: 'x', lineaTransportista: 'x' });
    expect(completo.texto).toContain('8/8');
    expect(completo.camposFaltantes).toEqual([]);
  });
  it('paquete de salida: cuenta fotos y NO autoriza la salida', () => {
    const r = render('paquete_salida', { ref: 'R-001', linea: 'LIN', numeroCaja: '12', fotosRegistradas: 'sellos de la caja con número legible; BOL firmado' });
    expect(r.texto).toContain('Fotos registradas: 2/6.');
    expect(r.texto).toContain('Falta:');
    expect(r.texto).not.toMatch(/adelante|ya puedes salir|autorizad[oa]\b(?! la da)/i);
    const todo = render('paquete_salida', { ref: 'R-001', linea: 'LIN', numeroCaja: '12', fotosRegistradas: ['sellos de la caja con número legible', 'sello de botella', 'número de caja visible', 'candado electrónico marcando cerrado', 'GPS de la caja visible', 'BOL firmado'].join(';') });
    expect(todo.texto).toContain('Checklist de fotos completo. La autorización de salida la da el cliente.');
  });
  it('confirmación de programa: «recibido» no es «confirmado»', () => {
    const r = render('confirmacion_programa', { fecha: '2026-11-24', totalServicios: 4, detalle: '08:00 planta A vivo', rol: 'encargado', plazo: '17:30', cambios: '4→3' });
    expect(r.texto).toContain('Recibido programa 2026-11-24: 4 servicios');
    expect(r.texto).toContain('pendiente de confirmación de encargado; te escribo a más tardar 17:30');
    expect(r.texto).toContain('Cambios vs versión anterior: 4→3.');
  });
  it('actualización de retraso: causa, ETA y próxima actualización', () => {
    const r = render('actualizacion_retraso', { ref: 'R-001', numeroCaja: '12', cita: '10:00', causa: 'falla', causaFuente: 'monitoreo', causaHora: '08:40', etaPunto: 'planta', eta: '11:30', zona: 'Centro', proximaActualizacion: '09:30', rol: 'encargado' });
    expect(r.texto).toContain('se prevé llegada posterior a la cita de 10:00');
    expect(r.camposFaltantes).toEqual([]);
    expect(render('actualizacion_retraso', {}).camposFaltantes).toContain('causa');
  });
  it('colocación: ficha de 4 campos y «ya colocada» solo con registro', () => {
    const base = { ref: 'R-001', ordinal: '1a', linea: 'LIN', numeroCaja: '12', placasCaja: 'ABC123', estadoCaja: 'EST', colocacionEstimada: '11:30', zona: 'frontera' };
    expect(render('colocacion_remolque', base).texto).toContain('Colocación estimada 11:30 (frontera); confirmo cuando quede colocada.');
    const col = render('colocacion_remolque', { ...base, colocadaHora: '11:40' });
    expect(col.texto).toContain('Colocada a las 11:40.');
    expect(col.texto).not.toContain('Colocación estimada');
  });
  it('prealerta, cuenta espejo, cruce y detención', () => {
    expect(render('prealerta', { ref: 'R-001', numeroCaja: '12', enviadoHora: '05:00', pendiente: 'sello' }).texto).toContain('enviados 05:00');
    expect(render('cuenta_espejo', { ref: 'R-001', numeroCaja: '12', enlace: 'https://ejemplo.test/ce', vigenteHasta: '18:00', posicion: 'tramo 4', posicionHora: '10:00' }).texto).toContain('Vigente hasta 18:00');
    expect(render('estatus_cruce', { ref: 'R-001', numeroCaja: '12', rol: 'cruces', plazo: '11:00' }).texto).toContain('sin confirmación de cruce aún');
    expect(render('estatus_cruce', { ref: 'R-001', numeroCaja: '12', hito: 'cruzó', hitoHora: '10:20', fuente: 'cruces' }).texto).toContain('cruzó a las 10:20');
    expect(render('detencion', { numeroCaja: '12', minutos: 40, tramo: 'tramo 5', gpsHora: '03:14', rol: 'monitoreo', plazo: '03:30' }).texto).toContain('Causa: pendiente de confirmar por monitoreo');
    expect(render('aviso_repregunta', { cliente: 'Cliente A', ref: 'R-001', cantidad: 2, tipo: 'sello', desde: '09:00', dato: 'sello', nivel: 'N1' }).texto).toContain('2 solicitudes de sello sin respuesta con dato desde 09:00');
  });
  it('existen todas las plantillas y ninguna lanza con datos vacíos', () => {
    expect(PLANTILLAS.length).toBeGreaterThanOrEqual(9);
    for (const p of PLANTILLAS) {
      const r = render(p, {});
      expect(r.plantilla).toBe(p);
      if (r.texto !== null) expect(r.texto).not.toMatch(/\bundefined\b|\bnull\b|\[object/);
    }
  });
});

describe('falta_dato: nunca sin plazo (política anti-«reviso»)', () => {
  const ok = { dato: 'Sello', ref: 'R-001', numeroCaja: '12', rol: 'encargado', plazo: '09:45', confirmados: 'caja y operador' };
  it('dice qué falta, a quién se avisó y cuándo se vuelve a escribir', () => {
    const r = render('falta_dato', ok);
    expect(r.texto).toBe('Sello de R-001/12 aún no está registrado.\nYa avisé a encargado. Te escribo a más tardar 09:45 (antes si llega).\nLo que sí está confirmado: caja y operador.');
    expect(revisarAcuse(r.texto as string).ok).toBe(true);
  });
  it('sin plazo, sin rol o sin dato se bloquea: no se manda un acuse vacío', () => {
    expect(render('falta_dato', { ...ok, plazo: '' })).toMatchObject({ texto: null, bloqueo: 'sin_plazo' });
    expect(render('falta_dato', { ...ok, rol: null })).toMatchObject({ texto: null, bloqueo: 'sin_rol_avisado' });
    expect(render('falta_dato', { ...ok, dato: undefined })).toMatchObject({ texto: null, bloqueo: 'sin_dato_que_nombrar' });
  });
  it('revisarAcuse rechaza «reviso», «en breve», «ya casi» sin dato ni hora', () => {
    for (const x of ['reviso y te digo', 'validamos y te aviso', 'en breve te confirmo', 'ya casi lo tengo', 'lo estoy trabajando']) {
      const r = revisarAcuse(x);
      expect(r.ok, x).toBe(false);
      expect(r.motivos, x).toContain('frase_vacia');
    }
    expect(revisarAcuse('Ya avisé a encargado; te escribo a las 09:45').ok).toBe(true);
    expect(revisarAcuse('Ya avisé a encargado').motivos).toContain('sin_plazo');
  });
  it('lo que el detector de acuses vacíos del equipo ya considera vacío, aquí tampoco pasa', () => {
    for (const x of ['enterado', 'reviso', 'ok', 'un momento']) { expect(esRespuestaVacia(x)).toBe(true); expect(revisarAcuse(x).ok, x).toBe(false); }
  });
});
