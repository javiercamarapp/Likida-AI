// Aplica el tema guardado ANTES del primer paint — sin esto, quien eligió
// oscuro ve un flash blanco en cada navegación dura. Corre SOLO en el panel:
// la landing, el login y el PDF se quedan claros (nunca se diseñaron en
// oscuro y el naranja de marca vive sobre fondos claros). La misma
// resolución de "sistema" que selector-tema.tsx, duplicada a propósito:
// esto tiene que ser un string síncrono sin imports.
//
// Vive aquí y no en `app/layout.tsx` porque DOS lugares lo necesitan idéntico
// al byte: el layout lo inyecta como `<script>` inline y el proxy calcula su
// hash SHA-256 para la CSP con nonce (Ola 9). Un layout no puede exportar
// nombres extra, y duplicar el string rompería el hash en silencio.
export const SCRIPT_TEMA = `(function(){try{if(location.pathname.indexOf('/dashboard')!==0)return;var t=localStorage.getItem('likida-tema');var d=t==='oscuro'||(t==='sistema'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})()`;
