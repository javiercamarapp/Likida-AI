import { describe, it, expect, beforeAll } from 'vitest';
import { accessToken, tokenMatches } from './passcode';

beforeAll(() => {
  process.env.DASHBOARD_PASSCODE = 'demo-1234';
  process.env.DASHBOARD_SECRET = 'secreto-de-prueba';
});

describe('passcode (HMAC)', () => {
  it('el token NO es reversible (no contiene el passcode ni su base64)', async () => {
    const t = await accessToken('demo-1234');
    expect(t).toHaveLength(64);                 // hex de SHA-256
    expect(t).not.toContain('demo-1234');
    expect(t).not.toContain(Buffer.from('demo-1234').toString('base64'));
  });
  it('tokenMatches acepta el token correcto y rechaza el resto', async () => {
    const t = await accessToken('demo-1234');
    expect(await tokenMatches(t)).toBe(true);
    expect(await tokenMatches('deadbeef')).toBe(false);
    expect(await tokenMatches(undefined)).toBe(false);
    expect(await tokenMatches(await accessToken('otro'))).toBe(false);
  });
});
