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
};

export default nextConfig;
