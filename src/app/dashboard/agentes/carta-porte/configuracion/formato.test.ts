import { describe, expect, it } from 'vitest';
import { CONFIG_SALIDA_ARRANQUE, validarConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { entradaDeTexto, erroresEnLinea, esProbable, frasePrevia, nombreDestinatario, textoDeConfig, type CamposTexto } from './formato';

const base = (): CamposTexto => textoDeConfig({ ...CONFIG_SALIDA_ARRANQUE });
const con = (c: Partial<CamposTexto>): CamposTexto => ({ ...base(), ...c });

describe('formato de la pantalla de configuración de la salida', () => {
  it('los valores de arranque no traen errores y la vista previa dice lo de la ficha', () => {
    expect(erroresEnLinea(base())).toEqual({});
    expect(frasePrevia(6, 60, nombreDestinatario('', null))).toBe('Si el requerimiento no existe: reintento cada 60 min, hasta 6 veces, luego aviso a el jefe de tráfico.');
    expect(frasePrevia(1, 30, 'Ana')).toContain('hasta 1 vez,');
    expect(frasePrevia(0, 30, 'Ana')).toContain('no se reintenta');
  });

  it('del texto a la entrada: vacíos a null, números a número, ilegible a NaN', () => {
    const e = entradaDeTexto(con({ ventanaInicio: ' ', destinatarioAlertaCorreo: ' a@ejemplo.test ', reintentosMax: '3', frecuenciaMin: 'x' }));
    expect(e).toMatchObject({ ventanaInicio: null, destinatarioAlertaCorreo: 'a@ejemplo.test', reintentosMax: 3 });
    expect(Number.isNaN(e.frecuenciaMin)).toBe(true);
  });

  it('el destinatario nombra a la persona y/o el correo; sin nadie, el jefe de tráfico', () => {
    expect(nombreDestinatario('a@ejemplo.test', 'Ana')).toBe('Ana y a@ejemplo.test');
    expect(nombreDestinatario('', 'Ana')).toBe('Ana');
    expect(nombreDestinatario('  ', null)).toBe('el jefe de tráfico');
  });

  it('la validación en línea coincide con la del servidor (mismo veredicto y mismo mensaje) en los casos límite', () => {
    const casos: Array<Partial<CamposTexto>> = [
      {}, { reintentosMax: '' }, { reintentosMax: '-1' }, { reintentosMax: '51' }, { reintentosMax: '2.5' }, { reintentosMax: '0' }, { reintentosMax: '50' },
      { frecuenciaMin: '4' }, { frecuenciaMin: '5' }, { frecuenciaMin: '1441' }, { frecuenciaMin: '1440' }, { frecuenciaMin: 'abc' },
      { ventanaInicio: '8:00', ventanaFin: '20:00' }, { ventanaInicio: '08:00' }, { ventanaInicio: '08:00', ventanaFin: '20:00' },
      { destinatarioAlertaCorreo: 'no-es-correo' }, { destinatarioRevisionCorreo: 'a@b' }, { destinatarioAlertaCorreo: 'a@ejemplo.test' },
    ];
    for (const c of casos) {
      const t = con(c);
      const enLinea = Object.values(erroresEnLinea(t));
      let servidor: string | null = null;
      try { validarConfigSalida(entradaDeTexto(t)); } catch (e) { servidor = (e as Error).message; }
      expect(enLinea.length > 0, JSON.stringify(c)).toBe(servidor !== null);
      if (servidor) expect(enLinea, JSON.stringify(c)).toContain(servidor);
    }
  });

  it('esProbable reconoce solo un conector con probar()', () => {
    expect(esProbable({ probar: async () => ({ ok: true, mensaje: '' }) })).toBe(true);
    expect(esProbable({})).toBe(false);
    expect(esProbable(null)).toBe(false);
  });
});
