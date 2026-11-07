const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add wasm asset support, used by expo-sqlite on web
config.resolver.assetExts.push('wasm');

// Add COEP and COOP headers to support SharedArrayBuffer, used by expo-sqlite on web
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    middleware(req, res, next);
  };
};

// These libraries have no web version, so web builds use the stand-ins in src/web instead.
const WEB_SHIMS = {
  '@maplibre/maplibre-react-native': path.resolve(__dirname, 'src/web/maplibre.tsx'),
  'expo-secure-store': path.resolve(__dirname, 'src/web/secure-store.ts'),
};

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] };
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
