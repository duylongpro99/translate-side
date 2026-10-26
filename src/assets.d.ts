// Images imported as data: URLs (Vite's `?inline`), for page-side UI that must not need a web-accessible resource.
declare module '*.png?inline' {
  const src: string;
  export default src;
}
