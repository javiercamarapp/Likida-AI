import { getResumenNegocio } from '@/lib/admin/negocio';
import ChatNegocio from '../chat';

export const dynamic = 'force-dynamic';

export default async function AdminChat() {
  const r = await getResumenNegocio();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center px-5">
        <span className="text-sm font-medium">Chatea con tus Datos</span>
      </header>
      <main className="max-w-2xl">
        <ChatNegocio resumen={r} />
      </main>
    </div>
  );
}
