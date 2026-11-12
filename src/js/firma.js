// Firma electrónica del formulario (Ley 527 de 1999 y Decreto 2364 de 2012, compilado en el Decreto 1074 de 2015).
//
// Al final del formulario la persona marca dos casillas: que leyó y acepta el tratamiento de sus datos
// personales (Ley 1581 de 2012) y que firma electrónicamente la declaración. Con eso se guarda en la meta:
//   { aceptaDatos: true, firmado: true, fecha: ISO, huella: SHA-256 de los datos firmados }
// La firma solo vale para esos datos: si después cambia cualquier campo, la huella ya no coincide y hay que
// volver a firmar. El PDF lleva el sello con el nombre, el documento, la fecha y hora y un código de
// verificación (derivado de la huella y la fecha), así sale firmado y no hay que imprimirlo para firmarlo.
//
// API (window.Firma):
//   sha256(texto) -> hex                    SHA-256 (UTF-8) sin depender de crypto.subtle (sirve con file://)
//   huella(s) -> hex                        huella de un estado (claves ordenadas; vacíos incluidos)
//   firmar(s, ahora?) -> firma              la firma de ese estado en ese momento
//   vigente(firma, s) -> boolean            la firma corresponde a esos datos
//   codigo(firma) -> 'XXXX-XXXX-XXXX-XXXX'  código de verificación que va en el PDF
//   fechaTexto(firma) -> 'dd/mm/aaaa hh:mm' fecha y hora local de la firma
//   normalizar(v) -> firma | null           lo que viene del archivo, validado
(function (root) {
  'use strict';

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function utf8(texto) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(texto);
    const s = unescape(encodeURIComponent(texto));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  function sha256(texto) {
    const datos = utf8(String(texto == null ? '' : texto));
    const n = datos.length;
    const total = Math.ceil((n + 9) / 64) * 64;
    const m = new Uint8Array(total);
    m.set(datos);
    m[n] = 0x80;
    const bits = n * 8;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);
    const rot = (x, r) => (x >>> r) | (x << (32 - r));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  function huella(s) {
    const st = s || {};
    const canon = Object.keys(st).sort().map((k) => [k, st[k] == null ? '' : String(st[k])]);
    return sha256(JSON.stringify(canon));
  }

  const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

  function firmar(s, ahora) {
    const f = ahora instanceof Date ? ahora : new Date();
    return { aceptaDatos: true, firmado: true, fecha: f.toISOString(), huella: huella(s) };
  }

  function vigente(firma, s) {
    return !!(firma && firma.aceptaDatos === true && firma.firmado === true && esFecha(firma.fecha)
      && firma.huella === huella(s));
  }

  function codigo(firma) {
    if (!firma || !firma.huella) return '';
    const x = sha256(firma.huella + '|' + firma.fecha).slice(0, 16).toUpperCase();
    return x.match(/.{4}/g).join('-');
  }

  function fechaTexto(firma) {
    if (!firma || !esFecha(firma.fecha)) return '';
    const f = new Date(firma.fecha);
    const dos = (n) => String(n).padStart(2, '0');
    return `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
  }

  function normalizar(v) {
    if (!v || typeof v !== 'object') return null;
    if (v.aceptaDatos !== true || v.firmado !== true || !esFecha(v.fecha)) return null;
    if (typeof v.huella !== 'string' || !/^[0-9a-f]{64}$/.test(v.huella)) return null;
    return { aceptaDatos: true, firmado: true, fecha: v.fecha, huella: v.huella };
  }

  const Firma = { sha256, huella, firmar, vigente, codigo, fechaTexto, normalizar };
  root.Firma = Firma;
  if (typeof module !== 'undefined' && module.exports) module.exports = Firma;
})(typeof window !== 'undefined' ? window : globalThis);
