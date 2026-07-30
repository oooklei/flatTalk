import { HttpClient } from './http-client.js';
import { createTagSystemAdapter } from './tag-system-adapter.js';

export function createInterfaceDataService(options = {}) {
  return {
    httpClient: options.httpClient ?? new HttpClient(options.http ?? {}),
    tagSystem: options.tagSystemAdapter ?? createTagSystemAdapter(options.tagSystem ?? {}),
  };
}
