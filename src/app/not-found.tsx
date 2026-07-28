import Link from 'next/link';

// Sin esta página, una URL mal escrita mostraba el 404 crudo de Next: pantalla
// negra con texto de framework. Delante de un comprador eso se lee como "esto
// está a medio hacer", aunque el 404 sea correcto.
export default function NoEncontrado() {
  return (
    <div className="min-h-screen flex items-center justify-center px-8">
      <div className="card p-12 text-center max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Esta página no existe</h1>
        <p className="mt-3 text-base" style={{ color: 'var(--muted)' }}>
          Puede que el enlace esté mal escrito o que la liquidación ya no esté disponible.
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-6 px-5 py-2.5 rounded-xl text-base font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Ir al panel
        </Link>
      </div>
    </div>
  );
}
