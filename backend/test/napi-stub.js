// Stub for @napi-rs/canvas — tests that import render.ts transitively don't
// actually call the canvas functions. This avoids requiring the native module.
export const GlobalFonts = { registerFromPath: () => {} };
export function createCanvas() {
  return { getContext: () => null, toBuffer: () => Buffer.from("") };
}
export async function loadImage() {
  return { width: 0, height: 0 };
}
