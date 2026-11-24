import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// REPO PÚBLICO: ningún archivo de este directorio puede nombrar a un transportista, un cliente o un intermediario real, ni traer
// teléfonos, correos o texto copiado de un chat. La lista de nombres prohibidos se guarda como HUELLAS SHA-256 (de la palabra o
// del par de palabras en minúsculas), para que esta prueba no escriba —ni siquiera por partes— los nombres que protege.
const HUELLAS_PROHIBIDAS: ReadonlySet<string> = new Set([
  '81b73d52aad380b9b0742b58d13928b8c265216ab78f7f5ec38a3c80865b6f20',
  '873fc42a5952181eea451cee3681747710ae38f7c901a1d38c198eb1da473d1a',
  'bbdefa2950f49882f295b1285d4fa9dec45fc4144bfb07ee6acc68762d12c2e3',
  '3ffce6dff62b8730381c8d7af31974c6195c8cd1a37bb751293494ec6afdd809',
  '171130f90d122e5d742847326c75896cd4ee6a07eeed73a21926509d4bbd7cad',
  '46c759e871935f8cd63cac9a269ad2b045ed518ac00f19f79471c8bde5523d91',
  '49733e6c3ab14229e84c29d48ec03095dd218f2987d0c37dddb60dede7004533',
  'f91b583d3b2f5ca3668769a332bee5e7e723abf16301d4dde28366bb470b01f9',
  'cc00acb8bb6a4fd95e39644d79559279ba32cc9d24576b52ebf8650efb88ead0',
  '5313be216c8bb1fc30d89e0091471e4ca9b0a263f1d68ca1e2214c029ce4ca2c',
  '3ee49785593999cef46e1c1482ad1a246d6e319b48149ec2e8cdff05ddf8b236',
  '916a98f0fa2a39af1a736b1a3744cb655dc8638a6953e2fb13e39934ab60d55a',
  '951d6049f986a9e314ec4277ba93ec4af158d998d3c71b04c093990d25b0d292',
  'b6256089b7163d70ea42cb3f9a81cd31ff4b54457cc9fed0bf8f272905a914cc',
  '3ad1aefe4a271db40e8ebab014a9280fca587f1a2617e0ba755e5846b6bfb27b',
  '310bfd86c777720d5dd6476b68d559159d2b4b471e468e6a3065203c32caf139',
  'd0e2ece166bdef23adedfaa3f1c47c9f969270f0fc519185514d58b4c7f6d199',
  '9695ea39cecf4b315fef380bcda35ded64a52eb459ea02085cf78bb6f66f2f6f',
  '74c0d3aa6fd600e08ad309e09c0599ca69a8eea4a4890d020e9ac0005d29170a',
  '79f950e57d58f374c9ad4f40680ec2d2560644de2acfe9ccd282f61974759028',
  'd36bd048982d176c5b5230564072c307df2deab45e62cdaac6a2fb6b2e7668ce',
  '39228d78ed59d721df54b8dac3d733d4c1a7624d0c63776c9c313f4ef90d1377',
  '6ceca90b33d89e133cf5890e6bc8800651d73cfc1a237ced9d1a59b9df329485',
  'ce0b3f349e7144d128541c5fe02645c84ddef5e88a7e56c69e8a1f3206f3f62c',
  '6d3bf5df57a30177b526be12b620e0a3310452a0251b25c1afbaad50e72bd0fb',
  'c27e13bdfeef173ea6328ab1f72810f8a4a8fd6aa7608786526681596d89c907',
  '02779491c32e3ab46355f0edc15e4b93728c4931987b2b762fe7d2980a3bd843',
  '83b136445cea011a891adae02bbd813dbf6a365253a9e3b78c023bc281a64bc4',
  '3be2a88de41f765035caa928c2b11db9d93a38a1b7714aae741608af49beff10',
  'e66674c01f282e0cc13ee7253bc599ee1dc4d232b3fb4df84e8f41a855ade1d9',
  '844ecb16764367f230fef3bf934ae5ed9b3f711aa8e990e3437ce2ffa5f35a15',
  '217eb50072231d18513de90baabecc69f63809d150f4e390fab035fadc6a5f30',
  '222f930b87524636da58b1987eabd52f1285cb0ef7dad72f28fcd026fbb3f73f',
  '661e59b9a16cb0313bf055898e96b2a3700fb27e7d5cc08abc66ffe6c989f2d4',
]);

const huella = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Palabras sueltas y pares de palabras consecutivas del texto, en minúsculas y sin acentos. */
function candidatos(texto: string): string[] {
  const palabras = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) ?? [];
  const salida: string[] = [];
  for (let i = 0; i < palabras.length; i += 1) {
    salida.push(palabras[i]);
    if (i + 1 < palabras.length) salida.push(`${palabras[i]} ${palabras[i + 1]}`);
  }
  return salida;
}

describe('el directorio de conocimiento no nombra clientes reales ni trae datos personales', () => {
  const dir = __dirname;
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'sin_nombres_reales.test.ts');
  it('hay archivos que revisar', () => { expect(archivos.length).toBeGreaterThan(10); });
  for (const f of archivos) {
    it(`${f}: sin nombres de clientes`, () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- f sale de readdirSync sobre este mismo directorio.
      const t = readFileSync(join(dir, f), 'utf8');
      const hallados = candidatos(t).filter((c) => HUELLAS_PROHIBIDAS.has(huella(c)));
      expect(hallados.length, `${f} nombra a un cliente o intermediario real`).toBe(0);
    });
    it(`${f}: sin teléfonos, correos ni links reales`, () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- f sale de readdirSync sobre este mismo directorio.
      const t = readFileSync(join(dir, f), 'utf8');
      expect(t).not.toMatch(/\b\d{10,13}\b/);
      expect(t).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(t).not.toMatch(/https?:\/\/(?!ejemplo\.test)/);
    });
  }
});
