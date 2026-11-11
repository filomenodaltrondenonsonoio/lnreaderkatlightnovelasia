// Type-check stub for LNReader's '@libs/fetch'. The app injects the real
// implementation (default headers, user agent, WebView cookies, ...).
export type FetchInit = {
  headers?: Record<string, string> | Headers;
  method?: string;
  body?: FormData | string;
  [key: string]: unknown;
};

export declare function fetchApi(url: string, init?: FetchInit): Promise<Response>;

export declare function fetchText(
  url: string,
  init?: FetchInit,
  encoding?: string,
): Promise<string>;
