import type { NextConfig } from 'next';

const config: NextConfig = {
  // The create-next-app defaults since Next.js 16.4.
  cacheComponents: true,
  partialPrefetching: true,
  // Where Next.js compiles with WebAssembly (StackBlitz's WebContainers), webpack bundles this
  // CommonJS dependency of the AI SDK's gateway as an ES module and the route fails to load. Node
  // loads it as it is.
  serverExternalPackages: ['@vercel/oidc'],
};

export default config;
