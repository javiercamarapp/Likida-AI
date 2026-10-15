import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaAvisosVigia, AYUDA_REGLA_PROVISIONAL, POLITICA_PRIVACIDAD, type ResultadoAviso } from './vista';
import { agruparPorDia, armarTarjeta, type AvisoBandeja } from '@/lib/likida/vigia/aviso/bandeja';

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA RENDERIZADA por estado: vacío, pendiente, enviado, fallido y sin destinatario; qué datos tiene y cuáles faltan;
// los cuatro botones solo donde corresponden; quien solo mira no ve botones ni teléfonos completos; la regla provisional y la
// política de privacidad a la vista. Datos 100 % sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async (): Promise<ResultadoAviso> => null;
const FILA = { fecha: '2026-10-21', cliente: 'CLIENTE SINT 01', consignatario: null, caja: 'CJ-100', unidad: 'U-7', citaTexto: '08:00', citaEn: null };

const aviso = (p: Partial<AvisoBandeja> = {}): AvisoBandeja => ({
  id: '44444444-4444-4444-8444-444444444444', filaId: '22222222-2222-4222-8222-222222222222', clienteId: 'c1', version: 1,
  estado: 'pendiente_confirmacion', canal: 'cliente_1a1',
  texto: 'Datos de la unidad asignada a tu viaje:\nCaja: CJ-100\nPlacas de la caja: por confirmar',
  datos: {
    tipo: 'inicial', pendientes: ['placas_caja', 'operador_nombre'], faltantes: [],
    valores: { caja: 'CJ-100', unidad: 'U-7', placas_unidad: 'ZZZ-123' }, fuentes: { placas_unidad: 'sistema' },
  },
  motivo: null, error: null, creadoEn: '2026-10-20T14:00:00.000Z', aprobadoEn: null, enviadoEn: null, ...p,
});

type Props = Parameters<typeof VistaAvisosVigia>[0];
function pintar(avisos: AvisoBandeja[], p: Partial<Props> = {}): string {
  const lectura = p.puedeDecidir === false;
  const grupos = agruparPorDia(avisos.map((a) => armarTarjeta(a, FILA, lectura)));
  return renderToStaticMarkup(
    <VistaAvisosVigia sufijo="" grupos={grupos} total={avisos.length} soloPendientes={false} puedeDecidir avisoEncendido errorLectura={null} sinMigrar={false} accion={accion} {...p} />,
  );
}

describe('estados vacíos y errores llanos', () => {
  it('sin avisos: lo dice y explica cuándo aparecerán', () => {
    const html = pintar([]);
    expect(html).toContain('Aún no hay avisos de viaje');
    expect(html).toContain('data-testid="vacio"');
  });
  it('«solo pendientes» sin nada: dice que no hay nadie esperando', () => {
    expect(pintar([], { soloPendientes: true })).toContain('No hay avisos esperando a nadie');
  });
  it('no pudo leer: lo dice y NO afirma que no hay avisos', () => {
    const html = pintar([], { errorLectura: 'No pude leer los avisos. Intenta de nuevo en un momento.' });
    expect(html).toContain('No pude leer los avisos');
    expect(html).not.toContain('Aún no hay avisos de viaje');
  });
  it('0797 sin aplicar: lo dice y NO afirma que no hay avisos', () => {
    const html = pintar([], { sinMigrar: true });
    expect(html).toContain('todavía no está lista');
    expect(html).not.toContain('Aún no hay avisos de viaje');
  });
  it('aviso apagado: lo dice; encendido, no; sin saberlo, lo admite', () => {
    expect(pintar([], { avisoEncendido: false })).toContain('El aviso de viaje está apagado');
    expect(pintar([], { avisoEncendido: true })).not.toContain('El aviso de viaje está apagado');
    const nulo = pintar([], { avisoEncendido: null });
    expect(nulo).toContain('No pude confirmar');
    expect(nulo).not.toContain('El aviso de viaje está apagado');
  });
});

describe('ayuda y privacidad', () => {
  it('muestra la regla provisional «caja + unidad + CCP listo»', () => {
    const html = pintar([]);
    expect(html).toContain('Regla provisional');
    expect(html).toContain('caja + unidad + carta porte (CCP) lista');
    expect(AYUDA_REGLA_PROVISIONAL).toContain('leyenda de colores');
  });
  it('la política de privacidad va visible junto a la captura manual', () => {
    const html = pintar([aviso()]);
    expect(html).toContain('data-testid="privacidad"');
    expect(html).toContain('NO se envían al cliente');
    expect(POLITICA_PRIVACIDAD).toContain('licencia');
  });
});

describe('una tarjeta pendiente', () => {
  const html = pintar([aviso()]);
  it('agrupa por día y por cliente', () => {
    expect(html).toContain('21/10/2026');
    expect(html).toContain('CLIENTE SINT 01');
  });
  it('dice qué datos tiene con su fuente y qué falta en llano', () => {
    expect(html).toContain('Caja:');
    expect(html).toContain('CJ-100');
    expect(html).toContain('(del programa)');
    expect(html).toContain('(del sistema)');
    expect(html).toContain('Falta la placa de la caja');
    expect(html).toContain('Falta el operador');
  });
  it('enseña el estado, la versión y el texto que se le va a decir al cliente', () => {
    expect(html).toContain('Pendiente de tu confirmación');
    expect(html).toContain('Versión 1');
    expect(html).toContain('Lo que se le va a decir al cliente');
    expect(html).toContain('Datos de la unidad asignada a tu viaje');
  });
  it('canal directo: Confirmar y enviar, Editar y Descartar; no «Copiar»', () => {
    expect(html).toContain('Confirmar y enviar');
    expect(html).toContain('Editar');
    expect(html).toContain('Descartar');
    expect(html).not.toContain('Copiar y marcar enviado');
  });
  it('canal de copia: Copiar y marcar enviado, no «Confirmar y enviar»', () => {
    const h = pintar([aviso({ canal: 'ejecutivo_copia' })]);
    expect(h).toContain('Copiar y marcar enviado');
    expect(h).not.toContain('Confirmar y enviar');
  });
  it('la captura manual pide operador, placas, estado de la caja y los tres datos sensibles rotulados «no se envía»', () => {
    for (const n of ['operadorNombre', 'placasUnidad', 'placasCaja', 'estadoCaja', 'licencia', 'licenciaVence', 'telefono']) expect(html).toContain(`name="${n}"`);
    expect(html).toContain('(no se envía al cliente)');
  });
  it('ningún formulario trae un campo tenant_id', () => {
    expect(html).not.toMatch(/name="tenant_?id"/i);
  });
});

describe('otros estados', () => {
  it('enviado: sin botones', () => {
    const h = pintar([aviso({ estado: 'enviado', enviadoEn: '2026-10-20T15:00:00.000Z', aprobadoEn: '2026-10-20T14:30:00.000Z' })]);
    expect(h).toContain('Enviado');
    expect(h).not.toMatch(/Confirmar y enviar|Copiar y marcar enviado|Descartar|name="accion"/);
  });
  it('fallido: el error en llano, role=alert, y la salida (copiar el texto)', () => {
    const h = pintar([aviso({ estado: 'fallido', error: 'Ese contacto no tiene constancia de consentimiento: no se le escribe.' })]);
    expect(h).toContain('No pude enviar: este cliente no autorizó mensajes por WhatsApp. Copia el texto y mándalo por tu grupo.');
    expect(h).toContain('role="alert"');
    expect(h).toContain('Copiar y marcar enviado');
    expect(h).not.toContain('Confirmar y enviar');
  });
  it('sin destinatario: dice por qué y deja copiar a mano, no confirmar', () => {
    const h = pintar([aviso({ estado: 'sin_destinatario', clienteId: null, datos: { tipo: 'inicial', pendientes: [], faltantes: ['sin_cliente'] } })]);
    expect(h).toContain('Sin destinatario');
    expect(h).toContain('No encontré a qué cliente pertenece este servicio.');
    expect(h).toContain('Copiar y marcar enviado');
    expect(h).not.toContain('Confirmar y enviar');
  });
  it('actualización: versión y qué cambió', () => {
    const h = pintar([aviso({ version: 2, texto: 'Actualización: cambió la caja: CJ-1 → CJ-100.\nCaja: CJ-100', datos: { tipo: 'actualizacion', valores: { caja: 'CJ-100' } } })]);
    expect(h).toContain('Versión 2 (actualización)');
    expect(h).toContain('data-testid="cambio"');
    expect(h).toContain('cambió la caja');
  });
  it('alerta interna: se rotula y solo se descarta', () => {
    const h = pintar([aviso({ estado: 'sin_destinatario', canal: 'ejecutivo_copia', datos: { tipo: 'alerta_cambia_demasiado', interno: true } })]);
    expect(h).toContain('Alerta interna para la oficina');
    expect(h).not.toMatch(/Confirmar y enviar|Copiar y marcar enviado/);
    expect(h).toContain('Descartar');
  });
  it('editado a mano: se nota', () => {
    expect(pintar([aviso({ datos: { tipo: 'inicial', editado_por_persona: true } })])).toContain('editado a mano');
  });
});

describe('quien solo mira', () => {
  const tel = 'Operador: X\nTeléfono del operador: 5212899900001';
  const h = pintar([aviso({ texto: tel, canal: 'ejecutivo_copia' })], { puedeDecidir: false });
  it('no ve ningún botón ni formulario', () => {
    expect(h).not.toMatch(/Confirmar y enviar|Copiar y marcar enviado|Descartar|Editar|name="accion"|<form/);
    expect(h).toContain('Solo el dueño o el encargado');
  });
  it('no ve el teléfono completo', () => {
    expect(h).not.toContain('5212899900001');
    expect(h).toContain('•••• 0001');
  });
  it('sí ve el aviso, lo que tiene y lo que falta', () => {
    expect(h).toContain('Falta la placa de la caja');
    expect(h).toContain('CJ-100');
  });
});

describe('navegación', () => {
  it('el enlace de regreso y el filtro conservan el sufijo de tenant', () => {
    const h = pintar([], { sufijo: '?tenant=abc' });
    expect(h).toContain('href="/dashboard/agentes/vigia?tenant=abc"');
    expect(h).toContain('href="/dashboard/agentes/vigia/avisos?tenant=abc&amp;pendientes=1"');
    expect(h).toContain('Solo pendientes');
  });
  it('sin sufijo el filtro es ?pendientes=1; con el filtro puesto ofrece mostrar todos', () => {
    expect(pintar([])).toContain('href="/dashboard/agentes/vigia/avisos?pendientes=1"');
    const h = pintar([], { soloPendientes: true });
    expect(h).toContain('Mostrar todos');
    expect(h).toContain('href="/dashboard/agentes/vigia/avisos"');
  });
});
