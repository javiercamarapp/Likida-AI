// ═══════════════════════════════════════════════════════════════════════════
// EL SITEMAP — solo lo PÚBLICO por diseño. El resto de app.likida.ai es
// software con sesión: no se lista, y robots.ts además lo veta. Los
// artículos salen de la misma colección tipada que la página del blog — una
// sola fuente, imposible que el sitemap y el índice divergan.
// ═══════════════════════════════════════════════════════════════════════════
import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/env';
import { ARTICULOS } from '@/lib/likida/marketing/articulos';


export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${appUrl()}/blog`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${appUrl()}/calculadora`, changeFrequency: 'monthly', priority: 1 },
    ...ARTICULOS.map((a) => ({
      url: `${appUrl()}/blog/${a.slug}`,
      lastModified: a.fecha,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
