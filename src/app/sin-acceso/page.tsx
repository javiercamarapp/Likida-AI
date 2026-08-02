export default function SinAcceso() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm text-center">
        <div className="text-lg font-semibold tracking-tight">Sin acceso</div>
        <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
          Tu cuenta inició sesión, pero no está vinculada a ninguna flota en
          Likida. Pídele a tu proveedor que te dé de alta.
        </p>
      </div>
    </main>
  );
}
