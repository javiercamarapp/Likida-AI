import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { qrSvg } from '@/lib/qr';
import { enlaceWaMe, textoDeArranque } from '@/lib/likida/arranque_whatsapp';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { VistaArranqueWhatsApp } = await import('./vista');

const CONFIGURADO = { estado: 'configurado' as const, digitos: '525512345678', visible: '+52 55 1234 5678', esPrueba: false };
const enlace = enlaceWaMe('525512345678', textoDeArranque('Transportes del Norte'));

function pintar(datos: Parameters<typeof VistaArranqueWhatsApp>[0]['datos']) {
  return renderToStaticMarkup(<VistaArranqueWhatsApp datos={datos} hrefOperadores="/dashboard/operadores" hrefAyuda="/dashboard/soporte" />);
}

describe('la guía de arranque del chofer', () => {
  it('con número: lo enseña grande, con el enlace wa.me (texto prellenado), el QR y los gestos de copiar e imprimir', () => {
    const html = pintar({ numero: CONFIGURADO, nombreFlota: 'Transportes del Norte', enlace, qrSvg: qrSvg(enlace, { etiqueta: 'QR' }), operadores: { activos: 250, pendientesDeInvitar: 37 } });
    expect(html).toContain('+52 55 1234 5678');
    expect(html).toContain(`href="${enlace.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('https://wa.me/525512345678?text=Hola%2C%20soy%20chofer%20de%20Transportes%20del%20Norte');
    expect(html).toContain('role="img"'); // el QR
    expect(html).toContain('Copiar enlace');
    expect(html).toContain('Imprimir cartel');
    expect(html).toContain('id="cartel-whatsapp"');
    expect(html).toContain('@media print');
    expect(html).toContain('250');
    expect(html).toContain('37');
  });

  it('SIN número configurado NO inventa uno: lo dice y manda a pedirlo (sin enlace ni QR)', () => {
    const html = pintar({ numero: { estado: 'sin_configurar' }, nombreFlota: 'X', enlace: null, qrSvg: null, operadores: null });
    expect(html).toContain('todavía no está configurado');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain('role="img"'); // el QR es el único svg con rol de imagen
    expect(html).toContain('href="/dashboard/soporte"');
  });

  it('un número inválido se dice como error (no se enseña un teléfono roto)', () => {
    const html = pintar({ numero: { estado: 'invalido', motivo: 'No parece un teléfono.' }, nombreFlota: 'X', enlace: null, qrSvg: null, operadores: null });
    expect(html).toContain('no es válido');
    expect(html).toContain('No parece un teléfono.');
    expect(html).not.toContain('wa.me');
  });

  it('un número de PRUEBA se enseña CON la advertencia de no repartirlo', () => {
    const html = pintar({ numero: { ...CONFIGURADO, esPrueba: true }, nombreFlota: 'X', enlace, qrSvg: null, operadores: null });
    expect(html).toContain('número de PRUEBA');
  });

  it('el flujo del chofer lo cuenta como es: número dado de alta, aviso de privacidad, tickets, LISTO', () => {
    const html = pintar({ numero: CONFIGURADO, nombreFlota: 'X', enlace, qrSvg: null, operadores: null });
    for (const t of ['SU número de WhatsApp', 'aviso de privacidad', 'fotos de sus tickets', '«LISTO»']) expect(html).toContain(t);
  });

  it('el estado de los operadores es verdad: sin operadores manda a darlos de alta; con todos invitados lo dice; sin lectura lo dice', () => {
    const sin = pintar({ numero: CONFIGURADO, nombreFlota: 'X', enlace, qrSvg: null, operadores: { activos: 0, pendientesDeInvitar: 0 } });
    expect(sin).toContain('Todavía no has dado de alta a ningún operador');
    const todos = pintar({ numero: CONFIGURADO, nombreFlota: 'X', enlace, qrSvg: null, operadores: { activos: 10, pendientesDeInvitar: 0 } });
    expect(todos).toContain('Todos ya fueron invitados');
    const ilegible = pintar({ numero: CONFIGURADO, nombreFlota: 'X', enlace, qrSvg: null, operadores: null });
    expect(ilegible).toContain('No pude contar a tus operadores');
  });
});
