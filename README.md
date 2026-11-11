# LNReader plugins: Kat Reading Cafe and LightNovelAsia

A plugin repository for [LNReader](https://github.com/lnreader/lnreader).

| Plugin | Site |
| --- | --- |
| Kat Reading Cafe | https://katreadingcafe.com |
| LightNovelAsia | https://lightnovelasia.com |

## Install in LNReader

1. Go to **More → Settings → Browse → Plugin repositories → Add** and paste:

   ```
   https://raw.githubusercontent.com/filomenodaltrondenonsonoio/lnreaderkatlightnovelasia/plugins/v3.0.0/.dist/plugins.min.json
   ```

2. Open **Browse → Available** and install *Kat Reading Cafe* and *LightNovelAsia*.

The repository must stay public, or LNReader can't download the plugins.

## Locked chapters

Chapters the sites sell or lock (coins, early access, login only) are **not** bypassed. In both plugins they
show with a 🔒 prefix in the chapter list, and opening one shows a short note instead of the text. Each plugin
has a "hide locked chapters" switch in its settings.

## Updating the plugins

Every push to `master` runs the `Publish Plugins` GitHub Action. It type-checks and compiles the plugins, then
publishes them to the `plugins/v3.0.0` branch, which is what LNReader reads. You can also run it by hand from
the Actions tab. No secrets are needed.

When you change a plugin, raise its `version` field so LNReader offers the update.

Local build (optional): `npm install && npm run build` writes `.dist/plugins.min.json` and `.js/`.

## Layout

- `plugins/english/*.ts`: one file per plugin
- `public/static/src/en/<site>/icon.png`: 96×96 icons (placeholders, replace freely)
- `scripts/`: manifest builder and publisher (adapted from lnreader-plugins)
- `src/libs`, `src/types`: type stubs used only by `npm run typecheck`; LNReader provides the real modules
