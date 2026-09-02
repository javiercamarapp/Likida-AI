import { describe, it, expect } from 'vitest';
import { renglonRastreo } from './conexiones';

// ═══════════════════════════════════════════════════════════════════════════
// EL RENGLÓN DE RASTREO — la regresión que arregló agosto-2026.
//
// Contaba `rastreo_credencial` (0050), una tabla que NO tiene un solo escritor
// en `src/`: daba cero siempre y decía «sin conectar» siempre, aunque la flota
// tuviera su token capturado. El motor (`sincronizar_gps.ts`) lee
// `conector_credencial` (0094), y ahora el renglón mide ahí.
//
// Lo otro que fija esto es la distinción que hace útil al renglón: tener
// credencial NO es estar conectado. «Listo» exige una posición ASENTADA en una
// unidad (`unidad.gps_visto_en`), que es lo único que prueba que el cron trae
// algo. Y `null` es «no se pudo leer», nunca cero.
// ═══════════════════════════════════════════════════════════════════════════

describe('renglonRastreo — cuatro estados, y ninguno se pinta verde de adorno', () => {
  it('no se pudo leer: lo dice, y NO es «sin conectar»', () => {
    const r = renglonRastreo({ conectores: null, ligadas: null, vistas: null });
    expect(r.detalle).toMatch(/NO SE PUDO LEER/);
    expect(r.falta).toEqual([]);
    // LA PRUEBA QUE FALTABA (auditoría ciclo 7, c7-28). Ésta miraba el
    // `detalle` y NUNCA el `estado`, así que no vio que el renglón devolvía
    // `'sin_configurar'`: la píldora decía **«Sin conectar»**, con el mismo
    // rótulo y el mismo gris que una flota que jamás capturó un GPS. Con la
    // base caída eso afirma «no tienes GPS» y manda al contralor a recapturar
    // una credencial que sí existe. El estado tiene que ser el suyo propio.
    expect(r.estado, 'no se pudo medir NO es «sin conectar»').toBe('no_medible');
    expect(r.estado).not.toBe('sin_configurar');
    // Y el texto no puede afirmar nada sobre la flota.
    expect(r.detalle).toMatch(/NO dice que no tengas GPS/i);
  });

  it('sin credencial: manda a la sección de captura de ESTA misma pantalla', () => {
    const r = renglonRastreo({ conectores: [], ligadas: 0, vistas: 0 });
    expect(r.estado).toBe('sin_configurar');
    expect(r.detalle).toMatch(/Credenciales de tus sistemas/);
    expect(r.falta[0]).toMatch(/capturar el acceso/);
  });

  it('con credencial y sin unidades ligadas: INCOMPLETO, y nombra el eslabón que falta', () => {
    const r = renglonRastreo({ conectores: ['samsara'], ligadas: 0, vistas: 0 });
    expect(r.estado).toBe('incompleto');
    // La trampa que esto evita: «tengo el token, ¿por qué no veo nada?». La
    // respuesta es que ninguna unidad reclama un dispositivo, y las lecturas
    // se están contando como huérfanas.
    expect(r.falta.join(' ')).toMatch(/número de dispositivo/);
    expect(r.falta.join(' ')).toMatch(/huérfanas/);
  });

  it('con credencial y unidades ligadas pero sin posiciones: sigue siendo INCOMPLETO', () => {
    const r = renglonRastreo({ conectores: ['samsara'], ligadas: 3, vistas: 0 });
    expect(r.estado).toBe('incompleto');
    expect(r.detalle).toMatch(/3 unidades ligadas/);
    expect(r.detalle).toMatch(/no ha traído una sola posición/);
  });

  it('con posiciones asentadas: LISTO, y dice cuántas unidades — sin afirmar que sea de hoy', () => {
    const r = renglonRastreo({ conectores: ['samsara'], ligadas: 3, vistas: 2 });
    expect(r.estado).toBe('listo');
    expect(r.detalle).toMatch(/2 unidades con posición/);
    expect(r.detalle).toMatch(/NO afirma que la posición sea de hoy/);
    expect(r.falta).toEqual([]);
  });

  it('un proveedor SIN lector de posiciones se dice, aunque su credencial esté probada', () => {
    // `wialon` tiene `probar()` verificado contra la documentación y NO tiene
    // lector en `LECTORES_POSICION`: su credencial se prueba y no sincroniza.
    // Callarlo dejaría al dueño esperando un mapa que nunca se va a llenar.
    const r = renglonRastreo({ conectores: ['wialon'], ligadas: 2, vistas: 0 });
    expect(r.falta.join(' ')).toMatch(/wialon todavía no tiene lector de posiciones/);
  });

  it('el aviso del lector faltante sobrevive incluso cuando ya entran posiciones de otro', () => {
    const r = renglonRastreo({ conectores: ['samsara', 'wialon'], ligadas: 5, vistas: 3 });
    expect(r.estado).toBe('listo');
    expect(r.falta.join(' ')).toMatch(/wialon/);
    expect(r.falta.join(' ')).not.toMatch(/samsara todavía no tiene lector/);
  });

  it('no se pudo contar las unidades ligadas: se dice, no se asume cero', () => {
    const r = renglonRastreo({ conectores: ['samsara'], ligadas: null, vistas: 0 });
    expect(r.falta.join(' ')).toMatch(/no se pudo leer cuántas unidades/);
  });
});
