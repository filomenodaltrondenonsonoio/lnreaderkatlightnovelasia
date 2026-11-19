# LNReader plugins: Kat Reading Cafe, LightNovelAsia, Novels Haven, Fenrir Realm and No Bad Novel

A plugin repository for [LNReader](https://github.com/lnreader/lnreader).

| Plugin | Site |
| --- | --- |
| Kat Reading Cafe | https://katreadingcafe.com |
| LightNovelAsia | https://lightnovelasia.com |
| Novels Haven | https://novelshaventranslations.com |
| Fenrir Realm (WebView) | https://fenrirealm.com |
| No Bad Novel | https://www.nobadnovel.com |

## Install in LNReader

1. Go to **More → Settings → Browse → Plugin repositories → Add** and paste:

   ```
   https://raw.githubusercontent.com/filomenodaltrondenonsonoio/lnreaderkatlightnovelasia/plugins/v3.0.0/.dist/plugins.min.json
   ```

2. Open **Browse → Available** and install *Kat Reading Cafe*, *LightNovelAsia*, *Novels Haven*, *Fenrir Realm (WebView)* and *No Bad Novel*.

The repository must stay public, or LNReader can't download the plugins.

## Fenrir Realm (WebView)

Fenrir Realm only shows chapter text on its own reader page, after a Cloudflare check. This plugin handles
browsing, search, your library and chapter lists in the app. For chapter text it uses LNReader's
`fetchViaWebview` (proposed in lnreader/lnreader#2128, not in a released app yet): the app opens the chapter
page in a hidden WebView, the site runs its own check, and the plugin reads the finished page. On app versions
without it, opening a chapter shows a short note, and the WebView (globe) button opens it on the site. It has its own id (`fenrirRealmWeb`), so it
can be installed next to the official Fenrir plugin and official updates won't replace it.

## Locked chapters

Chapters the sites sell or lock (coins, premium, early access, login only) are **not** bypassed. In all plugins they
show with a 🔒 prefix in the chapter list, and opening one shows a short note instead of the text. Each plugin
has a switch in its settings to hide them.

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
