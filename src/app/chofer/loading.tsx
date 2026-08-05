// Shimmer, no spinner: enseña la FORMA de lo que viene, así que la pantalla no
// salta al llegar los datos. Y `.skeleton` ya se apaga solo con
// `prefers-reduced-motion` (globals.css) — es lo único que se mueve en toda
// esta sección.
export default function CargandoChofer() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="skeleton rounded-lg" style={{ height: 30, width: '45%' }} />
      <div className="card p-5 flex flex-col gap-3">
        <div className="skeleton rounded-md" style={{ height: 18, width: '35%' }} />
        <div className="skeleton rounded-md" style={{ height: 28, width: '70%' }} />
        <div className="skeleton rounded-md" style={{ height: 18, width: '55%' }} />
      </div>
      <div className="card p-5 flex flex-col gap-3">
        <div className="skeleton rounded-md" style={{ height: 18, width: '40%' }} />
        <div className="skeleton rounded-md" style={{ height: 28, width: '60%' }} />
      </div>
    </div>
  );
}
