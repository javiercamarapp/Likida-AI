import type { ReactNode } from 'react';
import { trPublico } from '@/lib/i18n/publico_tr';

// `page.tsx` de /demo es un componente de cliente ('use client') y Next no deja
// exportar `metadata` desde ahí: el título de pestaña vive en este layout.
export async function generateMetadata() {
  return { title: (await trPublico()).t('dem.meta.titulo') };
}

export default function DemoLayout({ children }: { children: ReactNode }) {
  return children;
}
