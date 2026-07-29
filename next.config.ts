import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `zxing-wasm` va aquí a propósito: el lector es WebAssembly y el `.wasm` se
  // lee de node_modules en tiempo de ejecución (ver cfdi.ts). Si el bundler se
  // lo lleva, el binario deja de estar donde `require.resolve` lo busca y el
  // decodificador truena EN EL DEPLOY, no en local — el modo de fallo caro.
  serverExternalPackages: ['sharp', 'zxing-wasm', 'pdf-lib'],
  // El `.wasm` del lector se lee de disco en runtime (ver cfdi.ts), sin ningún
  // import que el tracer pueda seguir — así que hay que meterlo a la fuerza al
  // bundle de la función. Sin esto el webhook despliega "bien" y truena al
  // decodificar el primer código, que es el modo de fallo caro.
  outputFileTracingIncludes: {
    '/api/webhook/whatsapp': ['./node_modules/zxing-wasm/dist/reader/*.wasm'],
  },
  // Cinturón, además del tirante. `cfdi.ts` lee el `.wasm` de disco en runtime y
  // eso hace que el tracer considere alcanzable cualquier archivo bajo el
  // proyecto: en una medición del 28-jul-2026 se colaron 348 archivos ajenos al
  // bundle, entre ellos `.env.local` —con la service role key, el token de
  // WhatsApp y el app secret— y 76 documentos internos de auditoría.
  //
  // Ninguno de esos archivos lo lee la función. Los secretos ya viven en las
  // variables de entorno de Vercel, así que subir además el fichero es superficie
  // regalada; y los .md son las notas internas del proyecto.
  //
  // ── LA LISTA SE ESCRIBIÓ CONTRA UN INVENTARIO; AHORA VA CONTRA EL TRACE ────
  //
  // Los excludes de arriba funcionaron: medido sobre
  // `.next/server/app/api/webhook/whatsapp/route.js.nft.json`, no queda ni un
  // `.md`, ni un `.env*`, ni `docs/`, ni `supabase/`, ni un `*.test.*`.
  //
  // Pero se escribieron listando lo que se sabía que sobraba, no leyendo lo que
  // de verdad entró. Y entraron 145 archivos del proyecto, 4.22 MB: el
  // `tsbuildinfo`, el lockfile, las fotos de los fixtures, el sistema de diseño,
  // las 19 fichas YAML, los arneses de pago y 82 archivos de TypeScript SIN
  // COMPILAR. Nada de eso lo abre la función.
  //
  // Verificado antes de excluir, que es la parte que importa: el ÚNICO archivo
  // que este bundle lee de disco en runtime es el `.wasm` de zxing, y vive bajo
  // `node_modules` (`cfdi.ts:213`, la ruta que el include de arriba protege).
  // `command grep -rn "readFileSync\|readFile(\|process.cwd()" src/` no devuelve
  // ningún otro lector, y las rutas `normas/*.yaml` de `indice.ts` son cadenas
  // de referencia para un humano — nadie las abre (`indice.ts:9`).
  //
  // Se excluye `src/**/*.ts` y `*.tsx`, no `src/**`: un `.ts` no lo puede
  // ejecutar el runtime de la función —ahí corre lo compilado de `.next/`—, así
  // que sacarlo es seguro por construcción. Excluir la carpeta entera no lo
  // sería: el día que alguien meta una plantilla o un asset bajo `src/` y lo lea
  // en runtime, el bundle lo seguiría llevando y esta lista no lo rompería.
  //
  // PARA VOLVER A MEDIR (es lo que nadie hizo, y por eso se coló todo esto):
  //   npm run build && node -e "const{readFileSync,statSync}=require('fs'),p=require('path');
  //   const T='.next/server/app/api/webhook/whatsapp/route.js.nft.json';
  //   const {files}=JSON.parse(readFileSync(T,'utf8'));let n=0,b=0;
  //   for(const f of files){const a=p.resolve(p.dirname(T),f);
  //   if(a.includes('node_modules'))continue;try{b+=statSync(a).size;n++}catch{}}
  //   console.log(n,'archivos del proyecto,',(b/1048576).toFixed(2),'MB')"
  //
  // Medido el 28-jul-2026, mismo build, antes y después de esta lista:
  //
  //                       archivos      tamaño     del proyecto
  //   antes                    623     24.18 MB     145 arch / 4.22 MB
  //   después                  498     22.46 MB      20 arch / 2.50 MB
  //   de node_modules          478     19.96 MB     (idéntico: no se tocó nada
  //                                                  que una dependencia use)
  //
  // De los 20 que quedan, 13 son los chunks compilados de `.next/` (2.55 MB) y
  // el resto son los config del proyecto y `src/app/globals.css` —que sobrevive
  // justo porque el exclude es por extensión y no por carpeta—.
  //
  // El arranque en frío lo sigue mandando `sharp-libvips` con 15.34 MB (68% de
  // la función), y ese no se puede excluir porque sí se usa: `cfdi.ts` reduce la
  // imagen a 1600 px con `sharp` antes de pasarla a zxing.
  outputFileTracingExcludes: {
    '*': [
      './.env*', './**/*.md', './**/*.test.*', './docs/**', './supabase/**', './scripts/**',
      // Artefactos de build, de instalación y de herramientas: los produce el
      // propio repo, no los consume la función.
      //
      // `coverage/` está aquí por haberlo visto pasar: entre dos builds del
      // 28-jul alguien corrió el reporte de cobertura y sus 28 archivos (192 KB)
      // aparecieron en el trace sin que nadie tocara nada. Es LITERALMENTE el
      // modo de fallo de esta lista —una carpeta nueva se cuela sola—, y la razón
      // es que `cfdi.ts` lee el `.wasm` con `process.cwd()`, lo que hace que el
      // tracer dé por alcanzable todo lo que cuelgue de la raíz del proyecto.
      // Cualquier carpeta generada que aparezca después va a colarse igual: hay
      // que volver a medir el trace, no confiar en esta lista.
      './tsconfig.tsbuildinfo', './package-lock.json', './schema.sql',
      './coverage/**', './.vercel/**',
      // Fuente sin compilar. La función ejecuta lo de `.next/`, no esto.
      './src/**/*.ts', './src/**/*.tsx',
      // Insumos de prueba: la foto de 131 KB del fixture de códigos entre ellos.
      './src/**/__fixtures__/**',
      // Arneses que hacen llamadas REALES de pago. Que viajen en el bundle de
      // producción es, además de peso, superficie que nadie quiere ahí.
      './pruebas-manuales/**',
      // Material de referencia humano: el sistema de diseño y las 19 fichas
      // normativas. `indice.ts` las cita por nombre; el runtime nunca las abre.
      './design-system/**', './normas/**',
    ],
  },
};

export default nextConfig;
