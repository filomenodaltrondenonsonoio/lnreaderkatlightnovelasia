// Builds .dist/plugins.json and .dist/plugins.min.json: the repository
// manifest LNReader reads. Adapted from lnreader/lnreader-plugins.
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import languages from './languages.js';
import { minify } from './terser.js';

const sh = cmd => execSync(cmd).toString().replace(/[\s\n]/g, '');

const REMOTE = process.env.REPO_URL || sh('git remote get-url origin');
const BRANCH = process.env.BRANCH || sh('git branch --show-current');
const matched = REMOTE.match(/([^:/]+?)\/([^/.]+)(\.git)?$/);
if (!matched) throw new Error('Cannot parse git remote url: ' + REMOTE);
const [, USERNAME, REPO] = matched;

const USER_CONTENT = process.env.USER_CONTENT_BASE
  ? process.env.USER_CONTENT_BASE
  : `https://raw.githubusercontent.com/${USERNAME}/${REPO}/${BRANCH}`;
const STATIC_LINK = `${USER_CONTENT}/public/static`;
// LNReader still downloads plugin code from this legacy path.
const PLUGIN_LINK = `${USER_CONTENT}/.js/src/plugins`;

const COMPILED_DIR = './.js/plugins';
const DIST_DIR = '.dist';
fs.mkdirSync(DIST_DIR, { recursive: true });

// Compiled plugins import '@libs/*', 'cheerio', ... which only exist inside
// the app, so metadata is read by running the bundle with a require() that
// returns an inert proxy.
const createProxy = () =>
  new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'get') return a => a;
        if (!target[prop]) target[prop] = createProxy();
        return target[prop];
      },
    },
  );
const fakeRequire = () => createProxy();

const manifest = [];
const ids = new Set();

for (const language of Object.keys(languages)) {
  const dir = path.join(COMPILED_DIR, language.toLowerCase());
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    minify(path.join(dir, file));
    const code = fs.readFileSync(path.join(dir, file), 'utf-8');
    const instance = Function(
      'require',
      'module',
      `const exports = module.exports = {};\n${code};\nreturn exports.default`,
    )(fakeRequire, {});

    const { id, name, site, version, icon, customJS, customCSS } = instance;
    if (ids.has(id)) throw new Error(`Duplicate plugin id: ${id}`);
    ids.add(id);

    manifest.push({
      id,
      name: name.replace(/\[.*\]/, ''),
      site,
      lang: languages[language],
      version,
      url: `${PLUGIN_LINK}/${language.toLowerCase()}/${file}`,
      iconUrl: `${STATIC_LINK}/${icon || 'siteNotAvailable.png'}`,
      customJS: customJS ? `${STATIC_LINK}/${customJS}` : undefined,
      customCSS: customCSS ? `${STATIC_LINK}/${customCSS}` : undefined,
    });
    console.log(`  ${name.padEnd(25)} (${id}) v${version}`);
  }
}

manifest.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(DIST_DIR, 'plugins.min.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(DIST_DIR, 'plugins.json'), JSON.stringify(manifest, null, '\t'));
console.log(`Wrote ${manifest.length} plugin(s) to ${DIST_DIR}/plugins.min.json`);
