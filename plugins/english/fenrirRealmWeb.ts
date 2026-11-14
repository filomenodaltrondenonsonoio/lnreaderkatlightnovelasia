import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Fenrir Realm (https://fenrirealm.com), WebView edition.
 *
 * Browsing, search, novel details and chapter lists use the site's public API.
 * Chapter text is not fetched: the site only releases it to its own reader
 * page after a Cloudflare Turnstile check. Opening a chapter shows a short
 * note, and the WebView button opens that chapter on the site, where it is
 * read normally.
 *
 * Separate id from the official "fenrir" plugin, so both can be installed
 * and official updates don't replace this one.
 */
const SITE = 'https://fenrirealm.com';

type ApiNovel = {
  title: string;
  slug: string;
  cover?: string | null;
  description?: string | null;
  status?: string | null;
  genres?: { name: string }[];
  user?: { name?: string; username?: string } | null;
};

type ApiChapter = {
  slug?: string | null;
  number: number;
  title?: string | null;
  created_at?: string | null;
  locked?: { price?: number } | null;
  group?: { index?: number | null; slug?: string | null } | null;
};

class FenrirRealmWebPlugin implements Plugin.PluginBase {
  id = 'fenrirRealmWeb';
  name = 'Fenrir Realm (WebView)';
  icon = 'src/en/fenrirrealmweb/icon.png';
  site = SITE;
  version = '1.2.0';

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide paid chapters',
      type: 'Switch',
    },
  };

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sort',
      value: 'popular',
      options: [
        { label: 'Popular', value: 'popular' },
        { label: 'Latest', value: 'latest' },
        { label: 'Updated', value: 'updated' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      label: 'Status',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: 'on-going' },
        { label: 'Completed', value: 'completed' },
        { label: 'Hiatus', value: 'hiatus' },
        { label: 'On Hold', value: 'on-hold' },
        { label: 'Dropped', value: 'dropped' },
      ],
    },
  } satisfies Filters;

  private async api(path: string): Promise<any> {
    const res = await fetchApi(SITE + path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Fenrir Realm error ' + res.status);
    return res.json();
  }

  private cover(path?: string | null): string {
    return path ? SITE + '/' + path : defaultCover;
  }

  private toItem(n: ApiNovel): Plugin.NovelItem {
    return { name: n.title, path: n.slug, cover: this.cover(n.cover) };
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let q =
      '/api/new/v2/series?page=' + pageNo + '&per_page=20&sort=' +
      encodeURIComponent(showLatestNovels ? 'updated' : filters?.sort?.value || 'popular');
    if (filters?.status?.value) {
      q += '&' + encodeURIComponent('statuses[]') + '=' + encodeURIComponent(filters.status.value);
    }
    const res = await this.api(q);
    return (res.data || []).map((n: ApiNovel) => this.toItem(n));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const search = (term: string) =>
      this.api(
        '/api/series/filter?page=' + pageNo + '&per_page=20&search=' + encodeURIComponent(term),
      );
    let res = await search(searchTerm.trim());
    // Exact wording is needed; retry with the longest word if nothing matched.
    if (pageNo === 1 && !(res.data || []).length) {
      const words = searchTerm.split(/[^A-Za-z0-9]+/).filter(w => w.length > 2);
      const longest = words.sort((a, b) => b.length - a.length)[0];
      if (longest && longest !== searchTerm.trim()) res = await search(longest);
    }
    return (res.data || []).map((n: ApiNovel) => this.toItem(n));
  }

  private mapStatus(s?: string | null): string {
    const v = (s || '').toLowerCase();
    if (v.indexOf('going') >= 0) return NovelStatus.Ongoing;
    if (v.indexOf('complete') >= 0) return NovelStatus.Completed;
    if (v.indexOf('hiatus') >= 0 || v.indexOf('hold') >= 0) return NovelStatus.OnHiatus;
    if (v.indexOf('drop') >= 0) return NovelStatus.Cancelled;
    return NovelStatus.Unknown;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const slug = novelPath.split('/')[0];
    const n: ApiNovel = await this.api('/api/new/v2/series/' + encodeURIComponent(slug));
    const $ = parseHTML(n.description || '');
    const paragraphs = $('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const novel: Plugin.SourceNovel = {
      path: slug,
      name: n.title,
      cover: this.cover(n.cover),
      author: (n.user && (n.user.name || n.user.username)) || undefined,
      status: this.mapStatus(n.status),
      genres: (n.genres || []).map(g => g.name).join(','),
      summary: paragraphs.length ? paragraphs.join('\n\n') : $.root().text().trim(),
      chapters: [],
    };

    const list: ApiChapter[] = await this.api(
      '/api/new/v2/series/' + encodeURIComponent(slug) + '/chapters',
    );
    const hideLocked = !!storage.get('hideLocked');
    novel.chapters = list
      .filter(c => !(hideLocked && c.locked && c.locked.price))
      .map(c => {
        const volume = c.group && c.group.index != null ? c.group : null;
        const title = (c.title || '').trim();
        return {
          name:
            (c.locked && c.locked.price ? '🔒 ' : '') +
            (volume ? 'Vol ' + volume.index + ' ' : '') +
            'Chapter ' + c.number +
            (title && title !== 'Chapter ' + c.number ? ': ' + title : ''),
          path:
            slug + (volume && volume.slug ? '/' + volume.slug : '') +
            '/' + (c.slug || String(c.number)),
          releaseTime: c.created_at || undefined,
          chapterNumber: c.number + (volume ? (volume.index || 0) * 10000 : 0),
        };
      })
      .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.resolveUrl(chapterPath);
    return (
      '<p><b>Read this chapter in WebView.</b></p>' +
      '<p>Fenrir Realm only shows chapter text on its own reader page. Tap the ' +
      'globe (WebView) button at the top to open this chapter on the site and read it there.</p>' +
      '<p><a href="' + url + '">' + url + '</a></p>'
    );
  }

  resolveUrl = (path: string) => SITE + '/series/' + path.split('~~')[0];
}

export default new FenrirRealmWebPlugin();
