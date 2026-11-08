import { describe, it, expect } from 'vitest';
import { mxn, mxnEntero, numero } from '@/lib/formato';
import { resolverFormato } from './formatos';

describe('resolverFormato', () => {
  it('cada id da exactamente lo que lib/formato', () => {
    expect(resolverFormato('numero')(1234567)).toBe(numero(1234567));
    expect(resolverFormato('mxn')(1234.5)).toBe(mxn(1234.5));
    expect(resolverFormato('mxnEntero')(482311.4)).toBe(mxnEntero(482311.4));
  });
  it('una función pasa tal cual y sin formato queda el String histórico', () => {
    const f = (v: number) => `x${v}`;
    expect(resolverFormato(f)).toBe(f);
    expect(resolverFormato()(7)).toBe('7');
  });
});
