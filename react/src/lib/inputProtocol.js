export const INPUT_VERSION = 1;

export const OPCODES = {
  POINTER_MOVE_ABS:    1,
  POINTER_BUTTON_DOWN: 2,
  POINTER_BUTTON_UP:   3,
  POINTER_WHEEL:       4,
  KEY_DOWN:            5,
  KEY_UP:              6,
};

export function packFrame(opcode, payloadBytes) {
  const payloadLen = payloadBytes ? payloadBytes.length : 0;
  const buf = new ArrayBuffer(4 + payloadLen);
  const dv  = new DataView(buf);

  dv.setUint8(0,  INPUT_VERSION);
  dv.setUint8(1,  opcode);
  dv.setUint16(2, 0, false);

  if (payloadLen) {
    new Uint8Array(buf, 4).set(payloadBytes);
  }

  return buf;
}

export function packMove(x, y) {
  const payload = new Uint8Array(4);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, x, false);
  dv.setUint16(2, y, false);
  return packFrame(OPCODES.POINTER_MOVE_ABS, payload);
}

export function packButton(opcode, x, y, button, modifierFlags = 0) {
  const payload = new Uint8Array(6);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, x, false);
  dv.setUint16(2, y, false);
  dv.setUint8(4,  button);
  dv.setUint8(5,  modifierFlags);
  return packFrame(opcode, payload);
}

export function packWheel(x, y, dx, dy, modifierFlags = 0) {
  const payload = new Uint8Array(9);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, x,  false);
  dv.setUint16(2, y,  false);
  dv.setInt16(4,  dx, false);
  dv.setInt16(6,  dy, false);
  dv.setUint8(8,  modifierFlags);
  return packFrame(OPCODES.POINTER_WHEEL, payload);
}

export function packKey(opcode, keyCode, key, code, modifierFlags = 0) {
  const keyBytes  = new TextEncoder().encode(key  || "");
  const codeBytes = new TextEncoder().encode(code || "");

  const payload = new Uint8Array(
    2 + 1 + 1 + keyBytes.length + 1 + codeBytes.length
  );
  const dv = new DataView(payload.buffer);

  dv.setUint16(0, keyCode, false);
  dv.setUint8(2,  modifierFlags);
  dv.setUint8(3,  keyBytes.length);
  payload.set(keyBytes, 4);
  payload.set([codeBytes.length], 4 + keyBytes.length);
  payload.set(codeBytes, 5 + keyBytes.length);

  return packFrame(opcode, payload);
}

export function getModifierFlags(event) {
  return (
    (event.ctrlKey  ? 1 : 0) |
    (event.shiftKey ? 2 : 0) |
    (event.altKey   ? 4 : 0) |
    (event.metaKey  ? 8 : 0)
  );
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}