/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio repo */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { armarPasosCincoAgentes, etiquetaGlobal, MOTIVO_MINIMO, RESPONSABLES_POR_OMISION, type SenalesAsistente } from './pasos_cinco_agentes';
import { solicitudParaTi, cartaAutorizacion } from './textos_solicitud';

const vacias: SenalesAsistente = {
  tms: 'sin_credencial', archivosRecibidos: 0, correoPlataforma: true,
  correoDesglose: { activa: false, usaCorreo: false, remitenteCapturado: false },
  operadores: { activos: 0, conCorreo: 0 }, unidadesActivas: 0, patios: 0, coordinadores: 0, supervisores: 0, revisorCartaPorte: false,
};
const caidas: SenalesAsistente = {
  tms: null, archivosRecibidos: null, correoPlataforma: null, correoDesglose: null, operadores: null,
  unidadesActivas: null, patios: null, coordinadores: null, supervisores: null, revisorCartaPorte: null,
};
const por = (r: ReturnType<typeof armarPasosCincoAgentes>, id: string) => [...r.rutaCritica, ...r.despues].find((p) => p.id === id)!;

describe('asistente de puesta en marcha (cinco_agentes)', () => {
  it('la ruta crítica son 6 pasos y «Después» no cuenta', () => {
    const r = armarPasosCincoAgentes(vacias);
    expect(r.rutaCritica.map((p) => p.id)).toEqual(['equipo', 'tms', 'correo', 'catalogos', 'carta_porte', 'simulacro']);
    expect(r.rutaCritica.every((p) => p.cuenta)).toBe(true);
    expect(r.despues.every((p) => !p.cuenta && p.numero === null)).toBe(true);
  });

  it('cuenta vacía: casi todo pendiente, avance 0 y nada listo por cortesía', () => {
    const r = armarPasosCincoAgentes(vacias);
    expect(r.listos).toBe(0);
    expect(r.avance).toBe(0);
    expect(r.listoParaOperar).toBe(false);
    expect(por(r, 'tms').estado).toBe('pendiente');
    expect(por(r, 'catalogos').estado).toBe('pendiente');
    expect(por(r, 'simulacro').estado).toBe('bloqueado');
  });

  it('con la base caída todo lo medible es sin_dato: ni listo ni pendiente (E-10: null no es 0)', () => {
    const r = armarPasosCincoAgentes(caidas);
    for (const id of ['equipo', 'tms', 'correo', 'catalogos', 'carta_porte']) expect(por(r, id).estado, id).toBe('sin_dato');
    expect(r.listos).toBe(0);
  });

  it('el primer renglón del paso TMS es «Entregar archivo de muestra» y un archivo recibido lo cierra', () => {
    const p0 = por(armarPasosCincoAgentes(vacias), 'tms');
    expect(p0.subpasos[0].titulo).toBe('Entregar archivo de muestra');
    expect(p0.accion?.texto).toBe('Entregar archivo de muestra');
    const p1 = por(armarPasosCincoAgentes({ ...vacias, archivosRecibidos: 1 }), 'tms');
    expect(p1.estado).toBe('listo');
    expect(p1.evidencia.tipo).toBe('medido');
  });

  it('la API del TMS: guardada sin probar = en_curso; error = atención con causa; probada = listo', () => {
    const f = (tms: SenalesAsistente['tms']) => por(armarPasosCincoAgentes({ ...vacias, tms }), 'tms');
    expect(f({ activa: true, probadaEn: null, ultimoError: null }).estado).toBe('en_curso');
    const aten = f({ activa: true, probadaEn: null, ultimoError: 'respondió 403 (probable lista de IP permitidas)' });
    expect(aten.estado).toBe('atencion');
    expect(aten.causa).toContain('403');
    expect(aten.faltaDe).toContain('sistemas');
    expect(f({ activa: true, probadaEn: '2026-10-28T10:00:00Z', ultimoError: null }).estado).toBe('listo');
  });

  it('el correo nunca es listo solo porque la plataforma lo configure: pide la prueba y la confirmación', () => {
    const cfg = { activa: true, usaCorreo: true, remitenteCapturado: true };
    const sin = por(armarPasosCincoAgentes({ ...vacias, correoDesglose: cfg }), 'correo');
    expect(sin.estado).toBe('en_curso');
    expect(sin.declara).toBe('correoRecibido');
    const con = por(armarPasosCincoAgentes({ ...vacias, correoDesglose: cfg }, { correoRecibido: true }), 'correo');
    expect(con.estado).toBe('listo');
    expect(con.evidencia.tipo).toBe('declarado');
    const apagado = por(armarPasosCincoAgentes({ ...vacias, correoPlataforma: false }), 'correo');
    expect(apagado.estado).toBe('en_espera');
    expect(apagado.faltaDe).toBe('Falta de Likida');
  });

  it('el simulacro se destraba solo con TMS, correo y catálogos listos; y se cierra por declaración', () => {
    const buenas: SenalesAsistente = {
      ...vacias, archivosRecibidos: 2, correoDesglose: { activa: true, usaCorreo: true, remitenteCapturado: true },
      operadores: { activos: 3, conCorreo: 3 }, unidadesActivas: 4, coordinadores: 1, revisorCartaPorte: true,
    };
    const antes = armarPasosCincoAgentes(buenas, { correoRecibido: true, equipoInvitado: true });
    expect(por(antes, 'simulacro').estado).toBe('pendiente');
    const fin = armarPasosCincoAgentes(buenas, { correoRecibido: true, equipoInvitado: true, simulacroVisto: true });
    expect(fin.avance).toBe(100);
    expect(fin.listoParaOperar).toBe(true);
    expect(fin.siguiente).toBeNull();
  });

  it('omitir exige motivo, queda etiquetado y no cuenta como listo', () => {
    const r = armarPasosCincoAgentes(vacias, { omitidos: { carta_porte: 'La hace otra área' } });
    const p = por(r, 'carta_porte');
    expect(p.estado).toBe('omitido');
    expect(p.evidencia.tipo).toBe('declarado');
    expect(r.listos).toBe(0);
  });

  it('los responsables llevan nombre cuando la cuenta lo da; el código no trae nombres propios', () => {
    const r = armarPasosCincoAgentes(vacias, {}, { ...RESPONSABLES_POR_OMISION, tu_lado: 'Ana', ti_tms: 'Luis (TI)' });
    expect(por(r, 'catalogos').faltaDe).toBe('Falta de tu lado (Ana)');
    const t = solicitudParaTi({ paraTi: 'Luis', gerencia: 'Dirección', flota: 'la flota' });
    expect(t).toContain('SOLO LECTURA');
    expect(cartaAutorizacion({ paraTi: 'Luis', gerencia: 'Dirección', flota: 'la flota' })).toContain('Dirección');
  });

  describe('honestidad de «Todo listo para operar» (H4)', () => {
    const todasDeclaradas = { equipoInvitado: true, correoRecibido: true, simulacroVisto: true } as const;
    const motivos = { equipo: 'x', tms: 'x', correo: 'x', catalogos: 'x', carta_porte: 'x', simulacro: 'x' } as const;

    it('omitir con motivo de 1 letra NO omite nada: el paso sigue pendiente', () => {
      const r = armarPasosCincoAgentes(vacias, { omitidos: motivos });
      expect(r.rutaCritica.some((p) => p.estado === 'omitido')).toBe(false);
      expect(r.listoParaOperar).toBe(false);
    });

    it('seis omisiones con motivo razonable no alcanzan «Todo listo para operar»; se rotulan como omitidas', () => {
      const m = 'lo resuelve otra área';
      expect(m.length).toBeGreaterThanOrEqual(MOTIVO_MINIMO);
      const r = armarPasosCincoAgentes(vacias, { omitidos: { equipo: m, tms: m, correo: m, catalogos: m, carta_porte: m, simulacro: m } });
      expect(r.rutaCritica.every((p) => p.estado === 'omitido')).toBe(true);
      expect(r.listoParaOperar).toBe(false);
      expect(r.listos).toBe(0);
      expect(etiquetaGlobal(r)).toBe('Sin pasos pendientes (6 omitidos)');
    });

    it('solo con declaraciones del navegador (sin nada medido en el servidor) no se llega a «Todo listo»', () => {
      const r = armarPasosCincoAgentes(vacias, todasDeclaradas);
      expect(r.listoParaOperar).toBe(false);
      expect(etiquetaGlobal(r)).not.toBe('Todo listo para operar');
    });

    it('con lo medido listo y lo demás declarado sí, pero lo dice: cuántos pasos los confirmó la persona', () => {
      const buenas: SenalesAsistente = {
        ...vacias, archivosRecibidos: 2, correoDesglose: { activa: true, usaCorreo: true, remitenteCapturado: true },
        operadores: { activos: 3, conCorreo: 3 }, unidadesActivas: 4, coordinadores: 0, revisorCartaPorte: true,
      };
      const r = armarPasosCincoAgentes(buenas, todasDeclaradas);
      expect(r.listoParaOperar).toBe(true);
      expect(r.confirmadosPorTi).toBeGreaterThanOrEqual(2);
      expect(etiquetaGlobal(r)).toBe(`Todo listo para operar (${r.confirmadosPorTi} confirmados por ti)`);
    });
  });

  it('ningún archivo del asistente ni de Puesta en marcha nombra a una persona o cliente (H13)', () => {
    const dirs = ['src/lib/likida/asistente', 'src/app/dashboard/puesta-en-marcha'];
    // Los nombres se arman por pedazos para que esta prueba no sea, ella misma, un archivo que los nombre.
    const nombres = [['ce', 'li'], ['ce', 'linda'], ['innova', 'tivos?'], ['yu', 'carro']].map((p) => p.join(''));
    const prohibidos = new RegExp(`\\b(${nombres.join('|')})\\b`, 'i');
    for (const d of dirs) {
      for (const f of readdirSync(d).filter((x) => /\.(ts|tsx)$/.test(x) && !/\.test\./.test(x))) {
        expect(prohibidos.test(readFileSync(`${d}/${f}`, 'utf8')), `${d}/${f}`).toBe(false);
      }
    }
  });
});
