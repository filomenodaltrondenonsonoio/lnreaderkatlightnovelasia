import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';

/**
 * No Bad Novel (https://www.nobadnovel.com)
 *
 * A server-rendered Astro site, read as HTML:
 *  - list:    /series[/page/N]?sort=...&status=...&order=desc  (24 per page)
 *  - search:  /series[/page/N]?keyword=...
 *  - novel:   /series/<slug>  (lists every chapter)
 *  - chapter: /series/<slug>/<chapter-slug>, text in p.para
 */
const SITE = 'https://www.nobadnovel.com';

class NoBadNovelPlugin implements Plugin.PluginBase {
  id = 'noBadNovel';
  name = 'No Bad Novel';
  icon = 'src/en/nobadnovel/icon.png';
  site = SITE;
  version = '1.0.0';

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sort by',
      value: 'popularity',
      options: [
        { label: 'Popular', value: 'popularity' },
        { label: 'Recently updated', value: 'updatedAt' },
        { label: 'Newest', value: 'createdAt' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      label: 'Status',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: 'OnGoing' },
        { label: 'Completed', value: 'Completed' },
      ],
    },
  } satisfies Filters;

  /** Accepts full URLs or site paths and returns "series/..." */
  private toPath(href: string): string {
    return href.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/[?#].*$/, '');
  }

  resolveUrl = (path: string) => SITE + '/' + path;

  private async load(path: string) {
    const res = await fetchApi(SITE + path);
    if (!res.ok) throw new Error('No Bad Novel error ' + res.status);
    return parseHTML(await res.text());
  }

  private async listPage(pageNo: number, params: Record<string, string>) {
    const query = Object.keys(params)
      .filter(k => params[k])
      .map(k => k + '=' + encodeURIComponent(params[k]))
      .join('&');
    const $ = await this.load(
      '/series' + (pageNo > 1 ? '/page/' + pageNo : '') + (query ? '?' + query : ''),
    );
    const novels: Plugin.NovelItem[] = [];
    $('h4 a[href*="/series/"]').each((_, el) => {
      const link = $(el);
      const card = link.closest('h4').parent();
      novels.push({
        name: link.text().trim(),
        path: this.toPath(link.attr('href') || ''),
        cover: card.find('img').first().attr('src') || defaultCover,
      });
    });
    return novels.filter(n => n.name && n.path);
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    return this.listPage(pageNo, {
      sort: showLatestNovels ? 'updatedAt' : filters?.sort?.value || 'popularity',
      status: showLatestNovels ? '' : filters?.status?.value || '',
      order: 'desc',
    });
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const found = await this.listPage(pageNo, { keyword: term });
    if (found.length || pageNo > 1) return found;
    // Retry with the longest word when the exact phrase finds nothing.
    const longest = term
      .split(/[^A-Za-z0-9]+/)
      .filter(w => w.length > 2)
      .sort((a, b) => b.length - a.length)[0];
    return longest && longest !== term ? this.listPage(1, { keyword: longest }) : found;
  }

  private mapStatus(s: string): string {
    const v = s.toLowerCase();
    if (v.indexOf('ongoing') >= 0 || v.indexOf('progress') >= 0) return NovelStatus.Ongoing;
    if (v.indexOf('complete') >= 0) return NovelStatus.Completed;
    if (v.indexOf('hiatus') >= 0) return NovelStatus.OnHiatus;
    return NovelStatus.Unknown;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const $ = await this.load('/' + novelPath);
    const h1 = $('h1').first();
    const info = h1.parent();
    const intro = $('#intro').first().clone();
    intro.find('br').replaceWith('\n');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: h1.text().trim(),
      cover:
        h1.closest('div').parent().parent().find('img').first().attr('src') ||
        $('meta[property="og:image"]').attr('content') ||
        defaultCover,
      author: info.find('a[href*="author="]').first().text().trim() || undefined,
      status: this.mapStatus(h1.next().text().trim()),
      summary: intro
        .text()
        .split('\n')
        .map(l => l.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      chapters: [],
    };

    const seen: Record<string, boolean> = {};
    const chapters: Plugin.ChapterItem[] = [];
    let list = $('#chapter-list li a');
    if (!list.length) list = $('li a[href*="/chapter-"]');
    list.each((_, el) => {
      const a = $(el);
      const path = this.toPath(a.attr('href') || '');
      if (!path || seen[path]) return;
      seen[path] = true;
      const name = a.text().replace(/\s+/g, ' ').trim();
      const num = name.match(/^C(\d+(?:\.\d+)?)\b/) || path.match(/\/chapter-(\d+)/);
      chapters.push({
        name,
        path,
        chapterNumber: num ? Number(num[1]) : undefined,
      });
    });
    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const $ = await this.load('/' + chapterPath);
    const html = $('p.para')
      .map((_, el) => {
        const inner = ($(el).html() || '').trim();
        return inner ? '<p>' + inner + '</p>' : '';
      })
      .get()
      .filter(Boolean)
      .join('\n');
    if (!html) throw new Error('Chapter text not found');
    return html;
  }
}

export default new NoBadNovelPlugin();
