// Allow importing the stylesheet for its side effect (esbuild bundles it).
declare module "*.css";

// Fantail's hot-reload client and our mount/teardown handle on window.
declare global {
  interface Window {
    module?: {
      hot?: {
        accept(path: string, callback: () => void): void;
      };
    };
    __disposeApp?: () => void;
  }
}

export {};
