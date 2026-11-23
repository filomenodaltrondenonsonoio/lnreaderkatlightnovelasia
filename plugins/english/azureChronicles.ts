import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Azure Chronicles (https://azurechronicles.com)
 *
 * A WordPress site, read as HTML:
 *  - list:     /series[/page/N/]?sort=&status=&type=&genre[]=&q=
 *  - latest:   /latest[/page/N/]
 *  - novel:    /novel/<slug>/  (chapters load through the site's paging request)
 *  - chapter:  /novel/<slug>/chapter-N/, text in #ac-chapter-prose
 *
 * Premium chapters are NOT bypassed: the site doesn't include their text, and
 * the plugin shows a short note instead.
 */
const SITE = 'https://azurechronicles.com';

const GENRES: [string, string][] = [
  ['Action', 'action'], ['Adult', 'adult'], ['Adventure', 'adventure'], ['Comedy', 'comedy'],
  ['Drama', 'drama'], ['Ecchi', 'ecchi'], ['Fantasy', 'fantasy'],
  ['Gender Bender', 'gender-bender'], ['Harem', 'harem'], ['Historical', 'historical'],
  ['Horror', 'horror'], ['Josei', 'josei'], ['Martial Arts', 'martial-arts'], ['Mature', 'mature'],
  ['Mecha', 'mecha'], ['Mystery', 'mystery'], ['Psychological', 'psychological'],
  ['Romance', 'romance'], ['School Life', 'school-life'], ['Sci-fi', 'sci-fi'], ['Seinen', 'seinen'],
  ['Shoujo', 'shoujo'], ['Shoujo Ai', 'shoujo-ai'], ['Shounen', 'shounen'],
  ['Shounen Ai', 'shounen-ai'], ['Slice of Life', 'slice-of-life'],
  ['Supernatural', 'supernatural'], ['Tragedy', 'tragedy'], ['Wuxia', 'wuxia'],
  ['Xianxia', 'xianxia'], ['Xuanhuan', 'xuanhuan'], ['Yuri', 'yuri'],
];

class AzureChroniclesPlugin implements Plugin.PluginBase {
  id = 'azureChronicles';
  name = 'Azure Chronicles';
  icon = 'src/en/azurechronicles/icon.png';
  site = SITE;
  version = '1.0.0';

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: { Referer: SITE + '/' },
  };

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide premium chapters',
      type: 'Switch',
    },
  };

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sort by',
      value: 'views',
      options: [
        { label: 'Views', value: 'views' },
        { label: 'Newest', value: '' },
        { label: 'Rating', value: 'rating' },
        { label: 'Oldest', value: 'oldest' },
        { label: 'Title A-Z', value: 'title' },
        { label: 'Most chapters', value: 'chapters' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      label: 'Status',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: 'ongoing' },
        { label: 'Completed', value: 'completed' },
      ],
    },
    type: {
      type: FilterTypes.Picker,
      label: 'Type',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Novel', value: 'novel' },
        { label: 'Light Novel', value: 'light-novel' },
      ],
    },
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      value: '',
      options: [{ label: 'All', value: '' }].concat(
        GENRES.map(g => ({ label: g[0], value: g[1] })),
      ),
    },
  } satisfies Filters;

  private toPath(href: string): string {
    const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/[?#].*$/, '');
    return path && !path.endsWith('/') ? path + '/' : path;
  }

  resolveUrl = (path: string) => SITE + '/' + path;

  private async html(path: string): Promise<string> {
    const res = await fetchApi(SITE + path);
    if (!res.ok) throw new Error('Azure Chronicles error ' + res.status);
    return res.text();
  }

  /** Works for both the catalog cards and the latest-updates list. */
  private parseList(html: string): Plugin.NovelItem[] {
    const $ = parseHTML(html);
    const root = $('main').length ? $('main').first() : $('body');
    const found: Record<string, Plugin.NovelItem> = {};
    const order: string[] = [];
    root.find('a[href*="/novel/"]').each((_, el) => {
      const a = $(el);
      const match = (a.attr('href') || '').match(/\/novel\/([^/?#]+)\/?$/);
      if (!match) return;
      const path = 'novel/' + match[1] + '/';
      const img = a.find('img').first();
      const name = (a.attr('title') || img.attr('alt') || a.text()).replace(/\s+/g, ' ').trim();
      // The latest list sets covers as a CSS background.
      const background = (a.attr('style') || '').match(/url\(['"]?([^'")]+)/);
      const cover = img.attr('src') || (background ? background[1] : '');
      if (!found[path]) {
        found[path] = { name, path, cover: cover || defaultCover };
        order.push(path);
      } else {
        if (!found[path].name && name) found[path].name = name;
        if (found[path].cover === defaultCover && cover) found[path].cover = cover;
      }
    });
    return order.map(p => found[p]).filter(n => n.name);
  }

  private async catalog(pageNo: number, params: Record<string, string>) {
    const query = Object.keys(params)
      .filter(k => params[k])
      .map(k => k + '=' + encodeURIComponent(params[k]))
      .join('&');
    const page = pageNo > 1 ? 'page/' + pageNo + '/' : '';
    const html = await this.html('/series/' + page + (query ? '?' + query : ''));
    const $ = parseHTML(html);
    const novels: Plugin.NovelItem[] = [];
    $('article a[href*="/novel/"][title]').each((_, el) => {
      const a = $(el);
      novels.push({
        name: (a.attr('title') || '').trim(),
        path: this.toPath(a.attr('href') || ''),
        cover: a.find('img').first().attr('src') || defaultCover,
      });
    });
    return novels;
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (showLatestNovels) {
      return this.parseList(
        await this.html('/latest/' + (pageNo > 1 ? 'page/' + pageNo + '/' : '')),
      );
    }
    const params: Record<string, string> = {
      sort: filters ? filters.sort.value : 'views',
      status: filters?.status?.value || '',
      type: filters?.type?.value || '',
    };
    if (filters?.genre?.value) params['genre[]'] = filters.genre.value;
    return this.catalog(pageNo, params);
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const found = await this.catalog(pageNo, { q: term });
    if (found.length || pageNo > 1) return found;
    // Retry with the longest word when the exact phrase finds nothing.
    const longest = term
      .split(/[^A-Za-z0-9]+/)
      .filter(w => w.length > 2)
      .sort((a, b) => b.length - a.length)[0];
    return longest && longest !== term ? this.catalog(1, { q: longest }) : found;
  }

  private mapStatus(s: string): string {
    const v = s.toLowerCase();
    if (v.indexOf('ongoing') >= 0) return NovelStatus.Ongoing;
    if (v.indexOf('complete') >= 0) return NovelStatus.Completed;
    if (v.indexOf('hiatus') >= 0) return NovelStatus.OnHiatus;
    if (v.indexOf('drop') >= 0 || v.indexOf('cancel') >= 0) return NovelStatus.Cancelled;
    return NovelStatus.Unknown;
  }

  private readChapters(
    html: string,
    hideLocked: boolean,
    out: Plugin.ChapterItem[],
    seen: Record<string, boolean>,
  ): void {
    const $ = parseHTML(html);
    $('a.chapter-el[href*="/chapter-"]').each((_, el) => {
      const a = $(el);
      const path = this.toPath(a.attr('href') || '');
      if (!path || seen[path]) return;
      seen[path] = true;
      const locked = a.attr('data-ac-locked') === '1';
      if (locked && hideLocked) return;
      const label = (a.attr('data-ac-chapter-label') || '').trim();
      const num = path.match(/chapter-(\d+(?:[.-]\d+)?)\/$/);
      out.push({
        name: (locked ? '🔒 ' : '') + (label || 'Chapter ' + (num ? num[1] : '')),
        path,
        chapterNumber: num ? Number(num[1].replace('-', '.')) : undefined,
      });
    });
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const html = await this.html('/' + novelPath);
    const $ = parseHTML(html);
    const h1 = $('h1').first();
    const info = h1.parent().parent().parent().parent();
    const genres: string[] = [];
    info.find('a[href*="/genre/"]').each((_, el) => {
      const g = $(el).text().trim();
      if (g && genres.indexOf(g) < 0) genres.push(g);
    });
    const summary = $('.prose').first().clone();
    summary.find('br').replaceWith('\n');
    summary.find('p').after('\n\n');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: h1.text().trim(),
      cover: $('meta[property="og:image"]').attr('content') || defaultCover,
      status: this.mapStatus($('a[href*="/status/"]').first().text()),
      genres: genres.join(','),
      summary: summary.text().replace(/\n{3,}/g, '\n\n').trim(),
      chapters: [],
    };

    const nonce = html.match(/acData\s*=\s*\{[\s\S]{0,600}?nonce['"]?\s*:\s*['"]([^'"]+)/);
    const novelId = html.match(/append\('novel_id',\s*'(\d+)'\)/);
    const hideLocked = !!storage.get('hideLocked');
    const chapters: Plugin.ChapterItem[] = [];
    const seen: Record<string, boolean> = {};

    if (nonce && novelId) {
      for (let page = 1; ; page++) {
        const body = new FormData();
        body.append('action', 'ac_novel_chapter_page');
        body.append('nonce', nonce[1]);
        body.append('novel_id', novelId[1]);
        body.append('chapter_page', String(page));
        body.append('order', 'ASC');
        body.append('search', '');
        const res = await fetchApi(SITE + '/wp-admin/admin-ajax.php', { method: 'POST', body });
        const json = await res.json();
        if (!json.success) throw new Error('Could not load chapter list');
        this.readChapters(json.data.html || '', hideLocked, chapters, seen);
        if (page >= (Number(json.data.max_pages) || 1)) break;
      }
    } else {
      // Short novels have no pager: every chapter is already on the page.
      this.readChapters(html, hideLocked, chapters, seen);
      chapters.reverse();
    }
    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await this.html('/' + chapterPath);
    const $ = parseHTML(html);
    const prose = $('#ac-chapter-prose');
    if (!prose.length) {
      if (/ac_unlock_chapter|to unlock/i.test(html)) {
        return (
          '<p><b>This is a premium chapter on Azure Chronicles.</b> ' +
          'Open it on the website to unlock and read it.</p>'
        );
      }
      throw new Error('Chapter text not found');
    }
    prose.find('script,style,ins,iframe').remove();
    const text = (prose.html() || '').trim();
    if (!text) throw new Error('Chapter has no text');
    return text;
  }
}

export default new AzureChroniclesPlugin();
