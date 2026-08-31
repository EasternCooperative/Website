// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="vite/client" />
/// <reference types="../vendor/integration/types.d.ts" />

// Fontsource packages ship CSS only (no type declarations); declare them so
// side-effect imports type-check under TypeScript 6 strict (ts2882).
declare module '@fontsource-variable/*';
declare module '@fontsource/*';

// pdfmake's isomorphic Node entry (used by the build-time schedule PDF route).
// @types/pdfmake only covers the browser build at 'pdfmake/build/pdfmake'.
declare module 'pdfmake/js/index.js' {
  import type { TDocumentDefinitions } from 'pdfmake/interfaces';
  interface PdfDoc {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfPrinterLike {
    setFonts(fonts: Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', string>>): void;
    setLocalAccessPolicy?(fn: (path: string) => boolean): void;
    setUrlAccessPolicy?(fn: (url: string) => boolean): void;
    createPdf(docDefinition: TDocumentDefinitions): PdfDoc;
  }
  const pdfMake: PdfPrinterLike;
  export default pdfMake;
}
