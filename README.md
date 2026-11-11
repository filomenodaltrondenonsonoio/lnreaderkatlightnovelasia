# LNReader custom plugins

A plugin repository for [LNReader](https://github.com/lnreader/lnreader).

| Plugin | Site | Status |
| --- | --- | --- |
| Kat Reading Cafe | https://katreadingcafe.com | Ready (selectors checked against the live site) |
| LightNovelAsia | https://lightnovelasia.com | Ready (built against the site's public API) |

Chapters that the sites sell or lock (early access / coins) are **not** bypassed. In Kat Reading Cafe they
show a 🔒 prefix in the chapter list, a "hide locked chapters" setting is available, and opening one shows a
note with the unlock date instead of text.

## Install in LNReader

1. Create a GitHub repository and push this folder to it (branch `master` or `main`).
2. The included GitHub Action (`Publish Plugins`) runs on push, type-checks, compiles and publishes to the
   branch `plugins/v3.0.0`. You can also run it manually from the Actions tab. No secrets are needed.
3. In LNReader: **More → Settings → Browse → Plugin repositories → Add** and paste
   `https://raw.githubusercontent.com/filomenodaltrondenonsonoio/lnreaderkatlightnovelasia/plugins/v3.0.0/.dist/plugins.min.json`
4. Open **Browse → Available**, install *Kat Reading Cafe*.

Local build (optional): `npm install && npm run build` produces `.dist/plugins.min.json` and `.js/`.

## Layout

- `plugins/english/*.ts` – one file per plugin
- `public/static/src/en/<site>/icon.png` – 96×96 icons (placeholders; replace freely)
- `scripts/` – manifest builder and publisher (adapted from lnreader-plugins)
- `src/libs`, `src/types` – type stubs only, for `npm run typecheck`; LNReader provides the real modules

## Notes

- Update the plugin `version` field when you change a plugin, so LNReader offers the update.
- The plugin code has been checked for type errors, but it could not be run inside LNReader here.
