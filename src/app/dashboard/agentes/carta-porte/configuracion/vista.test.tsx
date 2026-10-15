import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import { CONFIG_SALIDA_ARRANQUE, type ConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { VistaConfiguracionSalida } from './vista';

const ACC = { guardar: async () => null, probar: async () => null };
const PERSONAS = [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02', nombre: 'Ana Ejemplo' }];
const pintar = (over: Partial<Parameters<typeof VistaConfiguracionSalida>[0]> = {}, config: ConfigSalida = { ...CONFIG_SALIDA_ARRANQUE }) =>
  renderToStaticMarkup(<VistaConfiguracionSalida config={config} esArranque personas={PERSONAS} conector={{ hay: false, puedeProbar: false }} acciones={ACC} {...over} />);

describe('Pantalla «Configuración de la salida»', () => {
  it('pinta los valores de arranque rotulados, con la vista previa de la ficha', () => {
    const html = pintar();
    expect(html).toContain('Configuración de la salida');
    expect(html).toContain('No definidos por el cliente: valores de arranque');
    expect(html).toContain('name="reintentosMax" value="6"');
    expect(html).toContain('name="frecuenciaMin" value="60"');
    expect(html).toContain('Si el requerimiento no existe: reintento cada 60 min, hasta 6 veces, luego aviso a el jefe de tráfico.');
    expect(html).toContain('Guardar configuración');
  });

  it('con configuración ya guardada no la rotula como arranque y refleja lo guardado', () => {
    const html = pintar({ esArranque: false }, { ...CONFIG_SALIDA_ARRANQUE, reintentosMax: 3, frecuenciaMin: 15, destinatarioAlertaCorreo: 'avisos@ejemplo.test' });
    expect(html).not.toContain('valores de arranque');
    expect(html).toContain('reintento cada 15 min, hasta 3 veces, luego aviso a avisos@ejemplo.test.');
  });

  it('el modo API aparece deshabilitado y explicado mientras no haya conector; con conector se puede elegir', () => {
    const sin = pintar();
    expect(sin).toMatch(/<option value="api" disabled=""/);
    expect(sin).toContain('El modo API se activa cuando haya una conexión probada');
    const con = pintar({ conector: { hay: true, puedeProbar: false } });
    expect(con).not.toMatch(/<option value="api" disabled=""/);
    expect(con).not.toContain('El modo API se activa cuando haya una conexión probada');
  });

  it('«Probar conexión» solo existe con un conector que sabe probar', () => {
    expect(pintar()).not.toContain('Probar conexión');
    expect(pintar({ conector: { hay: true, puedeProbar: false } })).not.toContain('Probar conexión');
    expect(pintar({ conector: { hay: true, puedeProbar: true } })).toContain('Probar conexión');
  });

  it('valores inválidos muestran el mensaje en español junto al campo y avisan en la vista previa', () => {
    const html = pintar({}, { ...CONFIG_SALIDA_ARRANQUE, reintentosMax: 99, frecuenciaMin: 1 });
    expect(html).toContain('Reintentos: el máximo es 50.');
    expect(html).toContain('Frecuencia: el mínimo es 5 minutos.');
    expect(html).toContain('Corrige los reintentos y la frecuencia');
  });

  it('lista las personas de la flota como destinatarios, nunca pide ni muestra credenciales, y propaga el «ver como»', () => {
    const html = pintar({ ver: { tenant: 'abc', rol: 'flota_admin' } });
    expect(html).toContain('Ana Ejemplo');
    expect(html).not.toMatch(/token|contraseña|password|api[_ -]?key|secret/i);
    expect(html).toContain('name="tenant" value="abc"');
    expect(html).toContain('name="rol" value="flota_admin"');
  });
});
