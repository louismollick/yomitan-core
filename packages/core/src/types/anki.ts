export type NoteId = number;

export type CardId = number;

export type NoteWithId = Note & { id: NoteId };

export type Note = {
    fields: NoteFields;
    tags: string[];
    deckName: string;
    modelName: string;
    options: {
        allowDuplicate: boolean;
        duplicateScope: string;
        duplicateScopeOptions: {
            deckName: string | null;
            checkChildren: boolean;
            checkAllModels: boolean;
        };
    };
};

export type NoteFields = {
    [field: string]: string;
};

export type NoteInfoWrapper = {
    canAdd: boolean;
    valid: boolean;
    noteIds: NoteId[] | null;
    noteInfos?: (NoteInfo | null)[];
};

export type NoteInfo = {
    noteId: NoteId;
    tags: string[];
    fields: { [key: string]: NoteFieldInfo };
    modelName: string;
    cards: CardId[];
    cardsInfo: CardInfo[];
};

export type NoteFieldInfo = {
    value: string;
    order: number;
};

export type CardInfo = {
    noteId: NoteId;
    cardId: CardId;
    flags: number;
    cardState: number;
};

export type ApiReflectResult = {
    scopes: string[];
    actions: string[];
};

export type MessageBody = {
    action: string;
    params: { [key: string]: unknown };
    version: number;
    key?: string;
};

export type CanAddNotesDetail = {
    canAdd: boolean;
    error: string | null;
};
