// Compiled against the built declarations with the strictest settings a consumer might use:
// skipLibCheck off and no DOM lib (Node and React Native projects).
import type { DictionaryStorage } from 'yomitan-core';
import * as core from 'yomitan-core';

export const storage: DictionaryStorage = core.createMemoryStorage();

// Anki note media: a screenshot from the host, audio resolved from the profile's sources.
export const media: core.NoteMedia = { screenshot: { data: new Uint8Array(), mediaType: 'image/webp' } };
export const audioUrls = (client: core.Yomitan): Promise<core.AudioUrl[]> => client.audio.urls('猫', 'ねこ');
export const addWithMedia = (controller: core.DisplayController, entry: core.TermDictionaryEntry) =>
    controller.addNote(entry, 0, {}, undefined, media);
