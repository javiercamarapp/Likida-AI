import { describe, expect, it } from 'vitest';
import { clientIp, ipDeCabeceras, llaveDeIp } from './ip_cliente';
import { clientIp as clientIpReexportada } from '@/lib/ratelimit';

const req = (h: Record<string, string>) => new Request('https://x.test/', { headers: h });

describe('clientIp (CT-SEG-13)', () => {
  it('prefiere x-vercel-forwarded-for sobre un x-forwarded-for fijado por el cliente', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });
  it('sin cabecera de Vercel usa x-real-ip antes que x-forwarded-for', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.4', 'x-forwarded-for': '6.6.6.6' }))).toBe('198.51.100.4');
  });
  it('como ultimo recurso toma el valor MAS A LA DERECHA de x-forwarded-for, no el que escribe el cliente', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 192.0.2.50' }))).toBe('192.0.2.50');
  });
  it('sin cabeceras devuelve desconocida', () => {
    expect(clientIp(req({}))).toBe('desconocida');
    expect(ipDeCabeceras(new Headers())).toBe('desconocida');
  });
  it('dos direcciones del mismo /64 IPv6 dan la MISMA llave', () => {
    const a = clientIp(req({ 'x-vercel-forwarded-for': '2001:db8:aaaa:bbbb:1111:2222:3333:4444' }));
    const b = clientIp(req({ 'x-vercel-forwarded-for': '2001:db8:aaaa:bbbb:ffff:eeee:dddd:cccc' }));
    expect(a).toBe(b);
    expect(a).toBe('2001:db8:aaaa:bbbb::/64');
  });
  it('/64 distintos dan llaves distintas', () => {
    expect(llaveDeIp('2001:db8:aaaa:bbbc::1')).not.toBe(llaveDeIp('2001:db8:aaaa:bbbb::1'));
  });
  it('IPv6 comprimida y expandida coinciden; corchetes y zona se ignoran', () => {
    expect(llaveDeIp('[2001:db8::1]:443')).toBe(llaveDeIp('2001:0db8:0000:0000:0000:0000:0000:0001'));
    expect(llaveDeIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });
  it('IPv4 mapeada en IPv6 se trata como IPv4; IPv4 con puerto pierde el puerto', () => {
    expect(llaveDeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(llaveDeIp('203.0.113.7:5555')).toBe('203.0.113.7');
  });
  it('basura no tira excepcion', () => {
    expect(() => llaveDeIp('no-es-ip:::::')).not.toThrow();
  });
  it('ratelimit re-exporta la MISMA funcion (una sola copia)', () => {
    expect(clientIpReexportada).toBe(clientIp);
  });
});
