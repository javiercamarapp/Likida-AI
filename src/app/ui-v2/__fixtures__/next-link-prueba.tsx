import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';

// Sustituto de `next/link` SOLO para las pruebas de comportamiento en Chromium (el paquete real no se empaqueta para el navegador).
export default function Link({ href, children, ...resto }: { href: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return createElement('a', { href, ...resto }, children);
}
