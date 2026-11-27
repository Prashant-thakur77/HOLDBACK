// Next.js ships its route matcher precompiled and without types. The header
// test uses it so that paths are matched exactly as the framework matches them.
declare module 'next/dist/compiled/path-to-regexp' {
  export function pathToRegexp(path: string): RegExp;
}
