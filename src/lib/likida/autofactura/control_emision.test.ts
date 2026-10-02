import { describe, it, expect } from 'vitest';
import { decidirEmision, registrarResultado, type DecisionEmision } from './control_emision';
import { crearMemoriaControl } from './control.fixture';

// El flujo supervisado de la PRIMERA EMISIÓN: ensayo hasta que TODAS las barreras se cumplan, y fallar cerrado.

const A = 'tenant-a';
const B = 'tenant-b';
const COM = 'enerser';
const T = (id: string, monto: number) => ({ gastoId: id, monto });
const pedir = (m: ReturnType<typeof crearMemoriaControl>, tickets = [T('g1', 500)], modoPedido: 'ensayo' | 'emitir' = 'emitir', tenantId = A, comercio = COM) =>
  decidirEmision({ tenantId, comercio, tickets, modoPedido }, m.deps);
const emitir = (d: DecisionEmision) => { if (d.modo !== 'emitir') throw new Error(`esperaba emitir y fue ensayo: ${d.razon} — ${d.detalle}`); return d; };

describe('barreras que mandan a ensayo', () => {
  it('se pidió ensayo: ensayo, sin tocar nada', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A);
    expect(await pedir(m, [T('g1', 500)], 'ensayo')).toMatchObject({ modo: 'ensayo', razon: 'no_pedido' });
    expect(m.lotes).toHaveLength(0);
  });
  it('sin fila de control o con la bandera apagada: ensayo (la emisión real es opt-in POR FLOTA)', async () => {
    const m = crearMemoriaControl({ verificados: [COM] });
    expect(await pedir(m)).toMatchObject({ modo: 'ensayo', razon: 'bandera_flota_apagada' });
    m.encender(A, { emisionReal: false });
    expect(await pedir(m)).toMatchObject({ modo: 'ensayo', razon: 'bandera_flota_apagada' });
    expect(m.lotes).toHaveLength(0);
  });
  it('la bandera de OTRA flota no vale', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(B);
    expect(await pedir(m, [T('g1', 500)], 'emitir', A)).toMatchObject({ modo: 'ensayo', razon: 'bandera_flota_apagada' });
  });
  it('portal sin verificar u obsoleto: ensayo, con la razón', async () => {
    const m = crearMemoriaControl(); m.encender(A);
    expect(await pedir(m)).toMatchObject({ modo: 'ensayo', razon: 'portal_sin_verificar' });
    const o = crearMemoriaControl({ obsoletos: [COM] }); o.encender(A);
    const d = await pedir(o);
    expect(d).toMatchObject({ modo: 'ensayo', razon: 'portal_sin_verificar' });
    expect((d as { detalle: string }).detalle).toContain('cambió después de su corrida supervisada');
  });
  it('CAPUFE no pasa por el registro de guiones, pero SÍ por la fase supervisada', async () => {
    const m = crearMemoriaControl(); m.encender(A);
    const d = emitir(await pedir(m, [T('g1', 500)], 'emitir', A, 'capufe'));
    expect(d.permitidos).toEqual([]);
    expect(d.rechazados[0].motivo).toBe('espera_confirmacion');
  });
  it('FALLA CERRADO: control, fase o cupo ilegibles → ensayo, y nunca emite', async () => {
    for (const cual of ['control', 'fase', 'cupo'] as const) {
      const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.falla[cual] = true;
      expect(await pedir(m), cual).toMatchObject({ modo: 'ensayo', razon: 'control_ilegible' });
    }
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.falla.consumir = true;
    expect(await pedir(m)).toMatchObject({ modo: 'ensayo', razon: 'control_ilegible' });
  });
});

describe('fase supervisada: una persona confirma el lote', () => {
  it('la primera vez NO emite: propone el lote y deja el ticket esperando', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A);
    const d = emitir(await pedir(m, [T('g1', 500), T('g2', 700)]));
    expect(d.permitidos).toEqual([]);
    expect(d.rechazados.map((r) => r.motivo)).toEqual(['espera_confirmacion', 'espera_confirmacion']);
    expect(m.lotes).toHaveLength(1);
    expect(m.lotes[0]).toMatchObject({ estado: 'propuesto', gastoIds: ['g1', 'g2'], monto: 1200 });
    expect(m.bitacora.map((b) => b.accion)).toContain('autofactura.lote_propuesto');
    expect(m.cupos.size).toBe(0); // no se reservó cupo: no se emite nada
  });
  it('re-correr no duplica el lote: los mismos tickets siguen esperando en UNA propuesta', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A);
    await pedir(m, [T('g1', 500)]); await pedir(m, [T('g1', 500), T('g2', 700)]);
    expect(m.lotes).toHaveLength(1);
    expect(m.lotes[0].gastoIds).toEqual(['g1', 'g2']);
  });
  it('con el lote confirmado emite SOLO lo confirmado, y reserva el cupo', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A);
    await pedir(m, [T('g1', 500)]);
    m.confirmarLote(A, COM);
    const d = emitir(await pedir(m, [T('g1', 500), T('g9', 300)]));
    expect(d.permitidos).toEqual(['g1']);
    expect(d.rechazados.find((r) => r.gastoId === 'g9')?.motivo).toBe('espera_confirmacion'); // g9 no estaba en el lote que la persona vio
    expect(m.lotes.find((l) => l.estado === 'ejecutado')).toBeTruthy();
    expect(m.cupos.get(`${A}|${m.hoy}`)).toEqual({ tickets: 1, monto: 500 });
  });
  it('el lote confirmado se consume UNA vez: la corrida siguiente vuelve a pedir confirmación', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A);
    await pedir(m, [T('g1', 500)]); m.confirmarLote(A, COM);
    expect(emitir(await pedir(m, [T('g1', 500)])).permitidos).toEqual(['g1']);
    const otra = emitir(await pedir(m, [T('g1', 500)]));
    expect(otra.permitidos).toEqual([]);
  });
  it('un lote confirmado de OTRA flota no autoriza nada en esta', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.encender(B);
    await pedir(m, [T('g1', 500)], 'emitir', B); m.confirmarLote(B, COM);
    expect(emitir(await pedir(m, [T('g1', 500)], 'emitir', A)).permitidos).toEqual([]);
  });
});

describe('límites', () => {
  it('un ticket sobre el límite de monto NO emite aunque su lote esté confirmado (lo hace una persona)', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A, { maxMontoTicket: 1000 }); m.ponerFase(A, COM, 'autonoma');
    const d = emitir(await pedir(m, [T('g1', 500), T('g2', 1000.01), T('g3', 0), T('g4', Number.NaN)]));
    expect(d.permitidos).toEqual(['g1']);
    expect(d.rechazados.map((r) => [r.gastoId, r.motivo])).toEqual([['g2', 'monto_excede'], ['g3', 'monto_excede'], ['g4', 'monto_excede']]);
  });
  it('el borde exacto del monto SÍ pasa', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A, { maxMontoTicket: 1000 }); m.ponerFase(A, COM, 'autonoma');
    expect(emitir(await pedir(m, [T('g1', 1000)])).permitidos).toEqual(['g1']);
  });
  it('tickets por lote: el resto espera a la siguiente corrida', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A, { maxTicketsLote: 2 }); m.ponerFase(A, COM, 'autonoma');
    const d = emitir(await pedir(m, [T('g1', 100), T('g2', 100), T('g3', 100)]));
    expect(d.permitidos).toEqual(['g1', 'g2']);
    expect(d.rechazados).toEqual([expect.objectContaining({ gastoId: 'g3', motivo: 'limite_lote' })]);
  });
  it('cupo diario por tickets y por monto, acumulado entre corridas del mismo día', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A, { maxTicketsLote: 3, maxTicketsDia: 4, maxMontoDia: 1500 }); m.ponerFase(A, COM, 'autonoma');
    expect(emitir(await pedir(m, [T('g1', 600), T('g2', 600)])).permitidos).toEqual(['g1', 'g2']);
    const d = emitir(await pedir(m, [T('g3', 400)])); // 1200 + 400 > 1500
    expect(d.permitidos).toEqual([]);
    expect(d.rechazados[0].motivo).toBe('limite_dia');
    expect(emitir(await pedir(m, [T('g4', 300)])).permitidos).toEqual(['g4']); // 1500 exactos
  });
  it('si otra corrida gana la carrera por el cupo, esta no emite (la reserva es atómica)', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A, { maxTicketsDia: 3, maxTicketsLote: 3 }); m.ponerFase(A, COM, 'autonoma');
    const real = m.repo.reservarCupo;
    m.repo.reservarCupo = async (...a) => { m.cupos.set(`${A}|${m.hoy}`, { tickets: 3, monto: 0 }); return real(...a); };
    const d = emitir(await pedir(m, [T('g1', 100)]));
    expect(d.permitidos).toEqual([]);
    expect(d.rechazados[0].motivo).toBe('limite_dia');
  });
  it('el cupo es por día: mañana se renueva', async () => {
    const m = crearMemoriaControl({ verificados: [COM], hoy: '2026-10-02' }); m.encender(A, { maxTicketsDia: 1, maxTicketsLote: 1 }); m.ponerFase(A, COM, 'autonoma');
    expect(emitir(await pedir(m, [T('g1', 100)])).permitidos).toEqual(['g1']);
    expect(emitir(await pedir(m, [T('g2', 100)])).permitidos).toEqual([]);
    const manana = crearMemoriaControl({ verificados: [COM], hoy: '2026-10-03' }); manana.encender(A, { maxTicketsDia: 1, maxTicketsLote: 1 }); manana.ponerFase(A, COM, 'autonoma');
    manana.cupos.set(`${A}|2026-10-02`, { tickets: 1, monto: 100 });
    expect(emitir(await pedir(manana, [T('g3', 100)])).permitidos).toEqual(['g3']);
  });
});

describe('autónoma: sin confirmación por lote, con todas las demás barreras', () => {
  it('emite sin proponer lote, pero la bandera apagada sigue mandando a ensayo', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.ponerFase(A, COM, 'autonoma');
    const d = emitir(await pedir(m, [T('g1', 500)]));
    expect(d.permitidos).toEqual(['g1']); expect(m.lotes).toHaveLength(0);
    m.encender(A, { emisionReal: false });
    expect(await pedir(m)).toMatchObject({ modo: 'ensayo' });
  });
});

describe('registrarResultado', () => {
  it('devuelve el cupo de lo que NO salió, cuenta las emisiones del portal y deja bitácora', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.ponerFase(A, COM, 'autonoma', 0);
    const d = emitir(await pedir(m, [T('g1', 500), T('g2', 700)]));
    await registrarResultado({ tenantId: A, comercio: COM, decision: d, resultados: [
      { gastoId: 'g1', monto: 500, cfdiUuid: '00000000-0000-4000-8000-000000000001' },
      { gastoId: 'g2', monto: 700, cfdiUuid: null, detalle: 'el portal no cargó' },
    ] }, m.deps);
    expect(m.cupos.get(`${A}|${m.hoy}`)).toEqual({ tickets: 1, monto: 500 });
    expect(m.fases.get(`${A}|${COM}`)?.emisionesConfirmadas).toBe(1);
    expect(m.bitacora.filter((b) => b.accion === 'autofactura.emitido')).toHaveLength(1);
    expect(m.bitacora.filter((b) => b.accion === 'autofactura.emision_fallida')).toHaveLength(1);
  });
  it('un fallo AMBIGUO (pudo emitirse) conserva el cupo: contarlo es el lado seguro', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.ponerFase(A, COM, 'autonoma', 0);
    const d = emitir(await pedir(m, [T('g1', 500)]));
    await registrarResultado({ tenantId: A, comercio: COM, decision: d, resultados: [{ gastoId: 'g1', monto: 500, cfdiUuid: null, detalle: 'SE APRETÓ EMITIR y después falló. PUEDE QUE EL CFDI YA EXISTA' }] }, m.deps);
    expect(m.cupos.get(`${A}|${m.hoy}`)).toEqual({ tickets: 1, monto: 500 });
  });
  it('la bitácora no lleva datos fiscales del receptor', async () => {
    const m = crearMemoriaControl({ verificados: [COM] }); m.encender(A); m.ponerFase(A, COM, 'autonoma', 0);
    const d = emitir(await pedir(m, [T('g1', 500)]));
    await registrarResultado({ tenantId: A, comercio: COM, decision: d, resultados: [{ gastoId: 'g1', monto: 500, cfdiUuid: '00000000-0000-4000-8000-000000000001' }] }, m.deps);
    expect(JSON.stringify(m.bitacora)).not.toMatch(/rfc|correo|contraseña|cookie/i);
  });
});
