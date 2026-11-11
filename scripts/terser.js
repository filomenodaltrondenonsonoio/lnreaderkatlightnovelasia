import fs from 'fs';

// Same minifier settings as the official lnreader-plugins repo. terser is a
// devDependency; if it is not installed (e.g. a quick local build) the
// plugins are simply left unminified.
let minifySync;
try {
  ({ minify_sync: minifySync } = await import('terser'));
} catch {
  console.warn('terser not installed, skipping minification');
}

const config = {
  compress: { arrows: false },
  mangle: {},
  ecma: 5,
  enclose: false,
  module: true,
  toplevel: true,
};

export const minify = function (path) {
  if (!minifySync) return;
  const code = fs.readFileSync(path).toString();
  const result = minifySync(code, config);
  fs.writeFileSync(path, result.code);
};
