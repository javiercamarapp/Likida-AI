import { describe, it, expect } from 'vitest';
import { crearTraductor } from './traducir';
import type { TrDe } from './tr_tipos';
import { admin_sistema as es } from './es/admin_sistema';
import { admin_sistema as en } from './en/admin_sistema';
import { nombreDeRolTr, nombreEtapaTr, nombreFuenteTr, nombreGiroTr, nombreNivelTr, rotuloEstadoRealTr, criterioScoreTr, estadoProspectoTr } from './rotulos_tr';
import { ROTULOS_ROL } from '@/lib/auth/roles';
import { NOMBRE_NIVEL } from '@/lib/likida/agentes/autonomia';
import { ROTULO_ESTADO_REAL } from '@/lib/likida/agentes/estado-real';
import { NOMBRE_FUENTE } from '@/lib/admin/escalaciones';
import { COLOR_EMBUDO, NOMBRE_GIRO, CRITERIO_SCORES } from '@/lib/admin/prospectos-mapa-client';
import { ESTADOS_PROSPECTO } from '@/lib/likida/vendedores';
import { cadaCuanto, desdeHace } from '@/app/admin/crons/estado-relojes';
import { etiquetaInterruptor } from '@/app/admin/observabilidad/etiquetas';
import { etiquetaAccion } from '@/app/admin/bitacora/etiquetas';

// «admin_sistema»: los rótulos que llegan de lib salen por clave en los dos idiomas, el español sigue diciendo EXACTAMENTE lo que dice
// lib (si alguien cambia un nombre en lib sin tocar la clave, esta prueba lo avisa) y las funciones de etiqueta hablan inglés con el
// traductor en. Sin traductor hablan español, como antes.

const tEs: TrDe<'admin_sistema'> = crearTraductor('es', es, es).t;
const tEn: TrDe<'admin_sistema'> = crearTraductor('en', en, es).t;

describe('rótulos de lib por clave', () => {
  it('en español dicen lo mismo que lib', () => {
    for (const [n, v] of Object.entries(NOMBRE_NIVEL)) expect(nombreNivelTr(n as keyof typeof NOMBRE_NIVEL, tEs)).toBe(v);
    for (const [k, v] of Object.entries(ROTULO_ESTADO_REAL)) expect(rotuloEstadoRealTr(k as keyof typeof ROTULO_ESTADO_REAL, tEs)).toBe(v);
    for (const [k, v] of Object.entries(NOMBRE_FUENTE)) expect(nombreFuenteTr(k as keyof typeof NOMBRE_FUENTE, tEs)).toBe(v);
    for (const [k, v] of Object.entries(ROTULOS_ROL)) expect(nombreDeRolTr(k, tEs)).toBe(v.nombre);
    for (const [k, v] of Object.entries(COLOR_EMBUDO)) expect(nombreEtapaTr(k, tEs)).toBe(v.nombre);
    for (const [k, v] of Object.entries(NOMBRE_GIRO)) expect(nombreGiroTr(k as keyof typeof NOMBRE_GIRO, tEs)).toBe(v);
    for (const [k, v] of Object.entries(CRITERIO_SCORES)) expect(criterioScoreTr(k as keyof typeof CRITERIO_SCORES, tEs)).toBe(v);
    for (const e of ESTADOS_PROSPECTO) expect(estadoProspectoTr(e.valor, tEs, e.rotulo)).toBe(e.rotulo);
  });

  it('en inglés salen en inglés (sin acentos del español)', () => {
    const dichos = [
      ...Object.keys(NOMBRE_NIVEL).map((k) => nombreNivelTr(k as keyof typeof NOMBRE_NIVEL, tEn)),
      ...Object.keys(ROTULO_ESTADO_REAL).map((k) => rotuloEstadoRealTr(k as keyof typeof ROTULO_ESTADO_REAL, tEn)),
      ...Object.keys(NOMBRE_FUENTE).map((k) => nombreFuenteTr(k as keyof typeof NOMBRE_FUENTE, tEn)),
      ...Object.keys(ROTULOS_ROL).map((k) => nombreDeRolTr(k, tEn)),
      ...Object.keys(COLOR_EMBUDO).map((k) => nombreEtapaTr(k, tEn)),
      ...Object.keys(NOMBRE_GIRO).map((k) => nombreGiroTr(k as keyof typeof NOMBRE_GIRO, tEn)),
    ];
    for (const d of dichos) expect(d).not.toMatch(/[áéíóúñ¿¡]/);
    expect(nombreDeRolTr('flota_admin', tEn)).toBe('Fleet owner');
    expect(nombreEtapaTr('negociacion', tEn)).toBe('In negotiation');
    expect(nombreNivelTr('L3', tEn)).toBe('Act with approval');
  });

  it('un valor fuera del catálogo se enseña tal cual (visible, no roto)', () => {
    expect(nombreDeRolTr('rol_raro', tEn)).toBe('rol_raro');
    expect(nombreEtapaTr('etapa_rara', tEn)).toBe('etapa_rara');
  });
});

describe('etiquetas de las pantallas de sistema', () => {
  it('sin traductor hablan español, con el de inglés hablan inglés', () => {
    expect(cadaCuanto(300_000)).toBe('cada 5 min');
    expect(cadaCuanto(300_000, tEn)).toBe('every 5 min');
    expect(cadaCuanto(7_200_000, tEn)).toBe('every 2 h');
    expect(desdeHace(3, tEn)).toBe('3 min ago');
    expect(desdeHace(null, tEn)).toBe('never');
    expect(etiquetaInterruptor('agente:liquidacion')).toBe('Agente de Liquidación');
    expect(etiquetaInterruptor('agente:liquidacion', tEn)).toBe('Settlement agent');
    expect(etiquetaInterruptor('agente:inventado', tEn)).toBe('agente:inventado');
    expect(etiquetaAccion('usuario.rol_cambiado', tEn)).toBe('User · rol cambiado');
  });
});
