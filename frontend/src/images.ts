// Read an image file, downscale to keep embedded data URLs small, and return a
// data URL. Defaults to PNG (preserves transparency — used by the logo and
// lanyard element images). Pass type "image/jpeg" for full-bleed photos like the
// schedule background, where PNG would balloon to several MB.
export function fileToImageDataUrl(
  file: File,
  max = 1000,
  type: "image/png" | "image/jpeg" = "image/png",
  quality?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(type, quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
