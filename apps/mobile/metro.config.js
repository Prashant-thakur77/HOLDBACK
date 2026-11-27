const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;

/**
 * Packages linked from the repository with `file:` (they live outside this
 * project and arrive as symlinks). Metro has to watch their real folders, and
 * their own imports have to resolve from THIS project's node_modules so the
 * app bundles exactly one copy of `@solana/web3.js`: two copies would make
 * `instanceof PublicKey` fail between the SDK and the wallet adapter.
 */
const linkedRoots = ['../../sdk', '../../dojo']
  .map((relative) => path.resolve(projectRoot, relative))
  .filter((folder) => fs.existsSync(folder));

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), ...linkedRoots];

// Cache transforms per project so another project's cache can never be served here.
config.cacheStores = ({ FileStore }) => [
  new FileStore({ root: path.join(projectRoot, 'node_modules', '.cache', 'metro') }),
];

const isBareSpecifier = (name) => !name.startsWith('.') && !path.isAbsolute(name);
const projectOrigin = path.join(projectRoot, 'index.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromLinkedPackage = linkedRoots.some((root) =>
    context.originModulePath.startsWith(root + path.sep),
  );
  if (fromLinkedPackage && isBareSpecifier(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: projectOrigin },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
