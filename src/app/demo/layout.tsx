import type { ReactNode } from 'react';

// `page.tsx` de /demo es un componente de cliente ('use client') y Next no deja
// exportar `metadata` desde ahí: el título de pestaña vive en este layout.
export const metadata = { title: 'Demo — Likida' };

export default function DemoLayout({ children }: { children: ReactNode }) {
  return children;
}
