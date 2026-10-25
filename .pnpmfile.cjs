module.exports = {
  hooks: {
    readPackage(pkg) {
      // PicGo 3.0.2 does not import globby in its published CJS/ESM/CLI code.
      // Remove this unused dependency chain: globby -> micromatch -> braces
      // (GHSA-vfj7-8cjw-p6xm has no upstream fix). Keep this version-specific;
      // rerun scripts/picgo-runtime.test.cjs before changing the pinned version.
      // pnpm 8 does not support the newer dependency-removal "-" override.
      if (pkg.name === 'picgo' && pkg.version === '3.0.2' && pkg.dependencies) {
        delete pkg.dependencies.globby;
      }
      return pkg;
    },
  },
};
