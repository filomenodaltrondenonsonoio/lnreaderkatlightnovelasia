// Mirrors LNReader's '@libs/novelStatus'. Type-check stub only; the app
// provides the real module at runtime.
export enum NovelStatus {
  Unknown = 'Unknown',
  Ongoing = 'Ongoing',
  Completed = 'Completed',
  Licensed = 'Licensed',
  PublishingFinished = 'Publishing Finished',
  Cancelled = 'Cancelled',
  OnHiatus = 'On Hiatus',
  STUB = 'STUB',
  Inactive = 'Inactive',
}
