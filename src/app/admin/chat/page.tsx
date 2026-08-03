import { getResumenNegocio } from '@/lib/admin/negocio';
import ChatNegocio from '../chat';

export const dynamic = 'force-dynamic';

export default async function AdminChat() {
  const r = await getResumenNegocio();

  return (
    <div className="min-h-screen">
      <header className="border-b h-16 flex items-center px-8" style={{ borderColor: 'var(--line)' }}>
        <span className="text-base font-medium">Chatea con tus Datos</span>
      </header>
      <main className="px-8 py-10 max-w-2xl">
        <ChatNegocio resumen={r} />
      </main>
    </div>
  );
}
