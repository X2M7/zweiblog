// These data-only assets already have SHA-256 filenames. Rewriting their literal
// representation would invalidate those hashes without reducing library data.
const libraryAsset = /^ts-libs\.[a-f0-9]{64}\.js$/;

export default (api) => {
  api.modifyBundleConfig({
    stage: 100, // After @umijs/plugin-esbuild installs its normal JS minimizer.
    fn(config, { env }) {
      const esbuild = (config.optimization?.minimizer || []).find(
        (minimizer) => minimizer.constructor?.name === 'ESBuildMinifyPlugin',
      );
      if (!esbuild) {
        if (env === 'production') {
          throw new Error('Monaco library assets require the configured Umi esbuild minimizer.');
        }
        return config;
      }
      // Umi's esbuild plugin also enables minification in development.
      const previous = esbuild.options.exclude;
      esbuild.options.exclude = [
        ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
        libraryAsset,
      ];
      return config;
    },
  });
};
