import { resolveCaddyHttpsMode } from 'src/utils/caddyHttpsMode';
import { loadConfig } from 'src/utils/loadConfig';
import { readSecretFile, validateMongoUrl } from 'src/utils/secretFile';
import { allowUnsafeDevelopmentFeature } from 'src/utils/unsafeFeatures';

export interface Config {
  mongoUrl: string;
  staticPath: string;
  codeRunnerPath: string;
  pluginRunnerPath: string;
  pipeline: {
    allowUnsafeExecution: boolean;
  };
  picgo: {
    allowUnsafePluginInstall: boolean;
  };
  caddy: {
    allowedDomains: string[];
    httpsMode: 'off' | 'on-demand';
  };
  /** Legacy database used only by the explicit Waline comment importer. */
  legacyWalineDB: string;
  demo: boolean | string;
  log: string;
}

const allowUnsafePipelineExecution =
  process.env.ZWEI_BLOG_PIPELINE_ALLOW_UNSAFE_EXECUTION ??
  loadConfig('pipeline.allowUnsafeExecution', false);
const allowUnsafePicgoPluginInstall =
  process.env.ZWEI_BLOG_PICGO_ALLOW_UNSAFE_PLUGIN_INSTALL ??
  loadConfig('picgo.allowUnsafePluginInstall', false);
const configuredCaddyDomains = loadConfig('caddy.allowedDomains', '');
const caddyHttpsModeResolution = resolveCaddyHttpsMode(
  process.env.ZWEI_BLOG_CADDY_HTTPS,
  loadConfig('caddy.httpsMode', ''),
  process.env.EMAIL,
);
if (caddyHttpsModeResolution.inferredFromLegacyEmail) {
  console.warn(
    'Deprecated legacy HTTPS configuration detected from EMAIL; set ZWEI_BLOG_CADDY_HTTPS explicitly',
  );
}

export const loadMongoUrl = () => {
  const urlFromEnvironment = process.env.ZWEI_BLOG_DATABASE_URL?.trim();
  const urlFile = process.env.ZWEI_BLOG_DATABASE_URL_FILE?.trim();
  if (urlFromEnvironment && urlFile) {
    throw new Error('Set only one of ZWEI_BLOG_DATABASE_URL and ZWEI_BLOG_DATABASE_URL_FILE');
  }
  if (urlFile) {
    return validateMongoUrl(readSecretFile(urlFile));
  }

  return validateMongoUrl(
    loadConfig('database.url', () => {
      const db = {
        host: loadConfig('database.host', 'mongo'),
        port: loadConfig('database.port', '27017'),
        user: loadConfig('database.user', ''),
        passwd: loadConfig('database.passwd', ''),
        name: loadConfig('database.name', 'zweiBlog'),
      };

      let authInfo = '';
      if (db.user !== '') {
        const user = encodeURIComponent(String(db.user));
        const password = encodeURIComponent(String(db.passwd));
        authInfo = password ? `${user}:${password}@` : `${user}@`;
      }

      const databaseName = encodeURIComponent(String(db.name));
      return `mongodb://${authInfo}${db.host}:${db.port}/${databaseName}?authSource=admin`;
    }),
  );
};

export const config: Config = {
  mongoUrl: loadMongoUrl(),
  staticPath: loadConfig('static.path', '/app/static'),
  demo: loadConfig('demo', false),
  legacyWalineDB:
    process.env.ZWEI_BLOG_LEGACY_WALINE_DB ||
    loadConfig('legacyWaline.db', loadConfig('waline.db', 'waline')),
  log: loadConfig('log', '/var/log'),
  codeRunnerPath: loadConfig('codeRunner.path', '/app/codeRunner'),
  pluginRunnerPath: loadConfig('pluginRunner.path', '/app/pluginRunner'),
  pipeline: {
    // Pipeline scripts run arbitrary JavaScript. Keep execution opt-in so a
    // normal ZweiBlog installation does not expose the host Node.js process.
    allowUnsafeExecution: allowUnsafeDevelopmentFeature(
      allowUnsafePipelineExecution,
      process.env.NODE_ENV,
    ),
  },
  picgo: {
    // Installing a PicGo plugin executes third-party package code at runtime.
    allowUnsafePluginInstall: allowUnsafeDevelopmentFeature(
      allowUnsafePicgoPluginInstall,
      process.env.NODE_ENV,
    ),
  },
  caddy: {
    httpsMode: caddyHttpsModeResolution.mode,
    allowedDomains: (Array.isArray(configuredCaddyDomains)
      ? configuredCaddyDomains
      : String(configuredCaddyDomains).split(',')
    )
      .map((domain) => String(domain).trim())
      .filter(Boolean),
  },
};
