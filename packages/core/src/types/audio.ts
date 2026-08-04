export type AudioSourceType =
    | 'jpod101'
    | 'language-pod-101'
    | 'jisho'
    | 'lingua-libre'
    | 'wiktionary'
    | 'text-to-speech'
    | 'text-to-speech-reading'
    | 'custom'
    | 'custom-json';

export type AudioSourceInfo = {
    type: AudioSourceType;
    url: string;
    voice: string;
};

export type AudioUrlInfo = {
    type: 'url';
    url: string;
    name?: string;
};

export type AudioTtsInfo = {
    type: 'tts';
    text: string;
    voice: string;
};

export type AudioInfo = AudioUrlInfo | AudioTtsInfo;

export type WikimediaCommonsLookupResponse = {
    query: {
        search: { title: string }[];
    };
};

export type WikimediaCommonsFileResponse = {
    query: {
        pages: {
            [key: string]: {
                imageinfo: { url: string; user: string }[];
            };
        };
    };
};

export type CustomAudioList = {
    type: 'audioSourceList';
    audioSources: { url: string; name?: string }[];
};
