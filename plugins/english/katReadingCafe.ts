import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Kat Reading Cafe (https://katreadingcafe.com)
 *
 * The site runs the Themesia "LightNovel" WordPress theme with a few
 * customisations:
 *  - listing pages use `article.maindet` cards, search uses `article.ats-card`
 *  - novels live under `/series/<slug>/`, chapters directly under `/<slug>/`
 *  - recent chapters are paid / early-access ("locked") and become free on a
 *    date shown on the chapter page. This plugin never tries to get around
 *    that: locked chapters are marked with a lock and show the unlock date.
 */
class KatReadingCafePlugin implements Plugin.PluginBase {
  id = 'katReadingCafe';
  name = 'Kat Reading Cafe';
  icon = 'src/en/katreadingcafe/icon.png';
  site = 'https://katreadingcafe.com';
  version = '1.0.0';

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: 'https://katreadingcafe.com/',
    },
  };

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide locked (premium / early access) chapters',
      type: 'Switch',
    },
  };

  filters = {
    order: {
      label: 'Order by',
      type: FilterTypes.Picker,
      value: '',
      options: [
        { label: 'Default', value: '' },
        { label: 'A-Z', value: 'title' },
        { label: 'Z-A', value: 'titlereverse' },
        { label: 'Latest Update', value: 'update' },
        { label: 'Latest Added', value: 'latest' },
        { label: 'Popular', value: 'popular' },
        { label: 'Rating', value: 'rating' },
      ],
    },
    status: {
      label: 'Status',
      type: FilterTypes.Picker,
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: 'ongoing' },
        { label: 'Hiatus', value: 'hiatus' },
        { label: 'Completed', value: 'completed' },
        { label: 'Dropped', value: 'dropped' },
      ],
    },
    type: {
      label: 'Type',
      type: FilterTypes.CheckboxGroup,
      value: [],
      options: [
        { label: 'Fan Fiction', value: 'fan-fiction' },
        { label: 'Web Novel', value: 'web-novel' },
      ],
    },
    genre: {
      label: 'Genres',
      type: FilterTypes.CheckboxGroup,
      value: [],
      options: [
        { label: 'Action', value: 'action' },
        { label: 'Adult', value: 'adult' },
        { label: 'Adventure', value: 'adventure' },
        { label: 'Comedy', value: 'comedy' },
        { label: 'Crossdressing', value: 'crossdressing' },
        { label: 'Dark Comedy', value: 'dark-comedy' },
        { label: 'Drama', value: 'drama' },
        { label: 'Ecchi', value: 'ecchi' },
        { label: 'Fantasy', value: 'fantasy' },
        { label: 'Futa', value: 'futa' },
        { label: 'Gender Bender', value: 'gender-bender' },
        { label: 'Gore', value: 'gore' },
        { label: 'Harem', value: 'harem' },
        { label: 'Historical', value: 'historical' },
        { label: 'Horror', value: 'horror' },
        { label: 'Josei', value: 'josei' },
        { label: 'Magical Girl', value: 'magical-girl' },
        { label: 'Martial Arts', value: 'martial-arts' },
        { label: 'Mature', value: 'mature' },
        { label: 'Mecha', value: 'mecha' },
        { label: 'MTL', value: 'mtl' },
        { label: 'Mystery', value: 'mystery' },
        { label: 'No Romance', value: 'no-romance' },
        { label: 'Psychological', value: 'psychological' },
        { label: 'Pure Love', value: 'pure-love' },
        { label: 'Romance', value: 'romance' },
        { label: 'School Life', value: 'school-life' },
        { label: 'Sci-fi', value: 'sci-fi' },
        { label: 'Seinen', value: 'seinen' },
        { label: 'Shoujo', value: 'shoujo' },
        { label: 'Shoujo Ai', value: 'shoujo-ai' },
        { label: 'Shounen', value: 'shounen' },
        { label: 'Slice of Life', value: 'slice-of-life' },
        { label: 'Smut', value: 'smut' },
        { label: 'Straight', value: 'straight' },
        { label: 'Supernatural', value: 'supernatural' },
        { label: 'Tragedy', value: 'tragedy' },
        { label: 'Wuxia', value: 'wuxia' },
        { label: 'Xianxia', value: 'xianxia' },
        { label: 'Xuanhuan', value: 'xuanhuan' },
        { label: 'Yuri', value: 'yuri' },
      ],
    },
  } satisfies Filters;

  resolveUrl = (path: string) => this.site + path;

  /** Strip the origin from an absolute URL so LNReader stores a relative path. */
  toPath(url: string): string {
    return url.replace(/^https?:\/\/[^/]+/i, '');
  }

  /** Fetch a page and fail loudly when Cloudflare (or similar) answers instead. */
  async getHtml(url: string): Promise<string> {
    const res = await fetchApi(url);
    if (!res.ok) {
      throw new Error(
        'Could not reach site (' + res.status + '). Try opening it in the WebView.',
      );
    }
    const body = await res.text();
    const title = body.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
    if (
      title &&
      /^(just a moment|attention required|bot verification|you are being redirected)/i.test(
        title,
      )
    ) {
      throw new Error('Captcha check, please open the site in the WebView.');
    }
    return body;
  }

  /** Lazy loaded images keep the real URL in data-* attributes. */
  imageUrl(img: { attr(name: string): string | undefined }): string | undefined {
    let src = img.attr('src');
    if (!src || src.startsWith('data:')) {
      src = img.attr('data-src') || img.attr('data-lazy-src') || src;
    }
    return src && !src.startsWith('data:') ? src : undefined;
  }

  parseNovels(html: string): Plugin.NovelItem[] {
    const $ = parseHTML(html);
    const novels: Plugin.NovelItem[] = [];
    const seen: Record<string, boolean> = {};

    const add = (
      href: string | undefined,
      name: string | undefined,
      cover: string | undefined,
    ) => {
      if (!href || !name || !href.includes('/series/')) return;
      const path = this.toPath(href);
      if (seen[path]) return;
      seen[path] = true;
      novels.push({ name: name.trim(), path, cover: cover || defaultCover });
    };

    // Browse / latest listing
    $('article.maindet').each((_, el) => {
      const card = $(el);
      const link = card.find('a').first();
      add(
        link.attr('href'),
        link.attr('title') || card.find('.tt, h2, h3').first().text(),
        this.imageUrl(card.find('img').first()),
      );
    });

    // Search results use a different card
    $('article.ats-card').each((_, el) => {
      const card = $(el);
      const link = card.find('.ats-title a').first();
      add(
        link.attr('href') || card.find('a.ats-cover').attr('href'),
        link.text(),
        this.imageUrl(card.find('img.ats-cover-img, img').first()),
      );
    });

    return novels;
  }

  async popularNovels(
    pageNo: number,
    {
      filters,
      showLatestNovels,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const params: string[] = ['page=' + pageNo];

    const order = showLatestNovels ? 'update' : filters?.order?.value;
    if (order) params.push('order=' + encodeURIComponent(order));
    if (filters?.status?.value) {
      params.push('status=' + encodeURIComponent(filters.status.value));
    }
    for (const value of filters?.type?.value || []) {
      params.push('type[]=' + encodeURIComponent(value));
    }
    for (const value of filters?.genre?.value || []) {
      params.push('genre[]=' + encodeURIComponent(value));
    }

    const html = await this.getHtml(this.site + '/series/?' + params.join('&'));
    return this.parseNovels(html);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url =
      this.site + '/page/' + pageNo + '/?s=' + encodeURIComponent(searchTerm);
    const res = await fetchApi(url);
    // Past the last page WordPress answers 404, which just means "no more".
    if (!res.ok) return [];
    return this.parseNovels(await res.text());
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const html = await this.getHtml(this.resolveUrl(novelPath));
    const $ = parseHTML(html);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('h1.entry-title').first().text().trim() || $('h1').first().text().trim(),
      cover: this.imageUrl($('.thumb img.ts-post-image, img.ts-post-image').first()) || defaultCover,
      genres: $('.genxed a, .sertogenre a')
        .map((_, el) => $(el).text().trim())
        .get()
        .join(', '),
      summary: '',
      author: '',
      artist: '',
      status: NovelStatus.Unknown,
      chapters: [],
    };

    // "Author格温大统领", "Status Ongoing", ... : the label and value are in one span
    $('.spe span').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const match = text.match(/^(author|artist)\s*:?\s*(.+)$/i);
      if (!match) return;
      if (match[1].toLowerCase() === 'author') novel.author = match[2].trim();
      else novel.artist = match[2].trim();
    });

    const statusText = (
      $('.sertostat').first().text() || $('.spe').text()
    ).toLowerCase();
    if (statusText.includes('completed')) novel.status = NovelStatus.Completed;
    else if (statusText.includes('ongoing')) novel.status = NovelStatus.Ongoing;
    else if (statusText.includes('hiatus')) novel.status = NovelStatus.OnHiatus;
    else if (statusText.includes('dropped')) novel.status = NovelStatus.Cancelled;

    const summary = $('.entry-content[itemprop="description"], .synp .entry-content, .entry-content').first();
    const paragraphs = summary
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    novel.summary = paragraphs.length
      ? paragraphs.join('\n\n')
      : summary.text().trim();

    const hideLocked = !!storage.get('hideLocked');
    const chapters: Plugin.ChapterItem[] = [];

    $('.eplister li').each((_, el) => {
      const li = $(el);
      const href = li.find('a').first().attr('href');
      if (!href) return;

      const locked =
        li.attr('data-locked') === '1' || li.find('.katoc-lock-badge').length > 0;
      if (locked && hideLocked) return;

      const numText = li.find('.epl-num').text().replace(/\s+/g, ' ').trim();
      const title = li.find('.epl-title').text().replace(/\s+/g, ' ').trim();
      const numMatch = numText.match(/(\d+(?:\.\d+)?)/);
      const timestamp = Number(li.attr('data-ts'));

      let name = title || numText;
      if (title && numText && !title.toLowerCase().startsWith(numText.toLowerCase())) {
        name = numText + ' - ' + title;
      }

      chapters.push({
        name: (locked ? '🔒 ' : '') + name,
        path: this.toPath(href),
        chapterNumber: numMatch ? parseFloat(numMatch[1]) : undefined,
        releaseTime: timestamp
          ? new Date(timestamp * 1000).toISOString()
          : li.find('.epl-date').text().trim() || undefined,
      });
    });

    // The site lists newest first; LNReader wants oldest first.
    if (
      chapters.length > 1 &&
      (chapters[0].chapterNumber ?? 0) > (chapters[chapters.length - 1].chapterNumber ?? 0)
    ) {
      chapters.reverse();
    }
    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await this.getHtml(this.resolveUrl(chapterPath));
    const $ = parseHTML(html);
    const content = $('.epcontent').first();

    if (!content.length) {
      return '<p>Could not find the chapter text. Open the chapter in the WebView to check it.</p>';
    }

    // Locked (premium / early access) chapters only contain a notice.
    const text = content.text().replace(/\s+/g, ' ').trim();
    if (
      !content.find('p').length &&
      /premium content|post is locked|login to buy/i.test(text)
    ) {
      const unlock = text.match(/free on ([^.]+?(?:GMT[+-]\d+\)?)?)\./i)?.[1];
      return (
        '<p>🔒 This chapter is locked on Kat Reading Cafe.</p>' +
        (unlock ? '<p>It becomes free on ' + unlock + '.</p>' : '') +
        '<p>Log in on the site (WebView) if you have access, or support the translator there.</p>'
      );
    }

    content.find('script, style, noscript, iframe, ins, .ckb-wrap').remove();

    // The app renders this as-is, so drop inline handlers and script URLs.
    content.find('*').each((_, el) => {
      const node = $(el);
      for (const attr of Object.keys(el.attribs || {})) {
        if (/^on/i.test(attr)) {
          node.removeAttr(attr);
        } else if (attr === 'href' || attr === 'src') {
          const value = el.attribs[attr].replace(/\s/g, '').toLowerCase();
          if (/^(javascript|vbscript):/.test(value)) node.removeAttr(attr);
        }
      }
    });

    // Resolve lazy / relative images.
    content.find('img').each((_, el) => {
      const img = $(el);
      const src = this.imageUrl(img);
      if (src) img.attr('src', src.startsWith('/') ? this.site + src : src);
    });

    return (content.html() || '').trim();
  }
}

export default new KatReadingCafePlugin();
