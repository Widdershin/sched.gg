// Shim: allow shared/render.ts to reference CanvasRenderingContext2D without
// DOM lib types. The actual type comes from @napi-rs/canvas at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare class CanvasRenderingContext2D {
  fillStyle: any;
  strokeStyle: any;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalCompositeOperation: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  clip(fillRule?: string): void;
  save(): void;
  restore(): void;
  drawImage(image: unknown, dx: number, dy: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  getTransform(): { a: number };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}
