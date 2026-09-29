/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The headless display controller (ADR-0008): Yomitan's per-entry Anki actions and their states,
 * following ext/js/display/display-anki.js. Renderers wire their buttons to it; consumers own the
 * popup and navigation.
 */

import {
    type AnkiNote,
    type AnkiNoteContext,
    type AnkiTransport,
    type FieldOverwriteMode,
    type NoteState,
    getNoteStates,
    getOverwrittenField,
} from '../anki/anki';
import type { ProfileOptions } from '../profile/profile';
import type { DictionaryEntry } from '../upstream/types/ext/dictionary';

export type SaveAction = 'add' | 'add-duplicate' | 'overwrite' | 'disabled';

export type CardFormatState = {
    cardFormatIndex: number;
    name: string;
    icon: string;
    /** What the save button does now, following the profile's `anki.duplicateBehavior`. */
    action: SaveAction;
    /** Why the button is disabled, when it is. */
    reason: string | null;
    state: NoteState;
    /** Existing notes the "view note" button opens. Empty when there are none or the transport can't browse. */
    viewNoteIds: number[];
    errors: string[];
};

export type EntryNoteStates = { entryIndex: number; cardFormats: CardFormatState[] };

/** What the display controller needs from a yomitan-core client. */
export type DisplayControllerClient = {
    profile: { get(): { options: ProfileOptions } };
    anki: {
        buildNote(
            entry: DictionaryEntry,
            options?: { cardFormatIndex?: number; context?: AnkiNoteContext; extraMarkers?: Record<string, string> },
        ): Promise<{ note: AnkiNote; errors: Error[] }>;
    };
};

export type AddNoteResult = { noteId: number; overwritten: boolean };

export class DuplicateNoteError extends Error {
    readonly code = 'duplicate';

    constructor(message = 'Duplicate notes are disabled') {
        super(message);
        this.name = 'DuplicateNoteError';
    }
}

function getCardFormatIndices(options: ProfileOptions, entry: DictionaryEntry): number[] {
    const indices: number[] = [];
    for (const [index, format] of options.anki.cardFormats.entries()) {
        if (format.type === entry.type) {
            indices.push(index);
        }
    }
    return indices;
}

function getSaveAction(behavior: string, state: NoteState): { action: SaveAction; reason: string | null } {
    if (!state.canAdd) {
        return { action: 'disabled', reason: 'The note is missing required field content' };
    }
    if (state.duplicateNoteIds.length === 0) {
        return { action: 'add', reason: null };
    }
    switch (behavior) {
        case 'prevent':
            return { action: 'disabled', reason: 'Duplicate notes are disabled' };
        case 'overwrite':
            return state.duplicateNoteIds.some((id) => id !== -1)
                ? { action: 'overwrite', reason: null }
                : { action: 'disabled', reason: 'The duplicate note could not be found' };
        default:
            return { action: 'add-duplicate', reason: null };
    }
}

export function createDisplayController(client: DisplayControllerClient, { anki }: { anki: AnkiTransport }) {
    const buildNotes = async (
        entry: DictionaryEntry,
        context: AnkiNoteContext,
        extraMarkers?: Record<string, string>,
    ) => {
        const options = client.profile.get().options;
        const indices = getCardFormatIndices(options, entry);
        return await Promise.all(
            indices.map(async (cardFormatIndex) => ({
                cardFormatIndex,
                ...(await client.anki.buildNote(entry, { cardFormatIndex, context, extraMarkers })),
            })),
        );
    };

    return {
        /**
         * The save and view-note buttons' state for each entry and applicable card format, as Yomitan
         * shows them after a lookup.
         */
        async getNoteStates(
            entries: DictionaryEntry[],
            context: AnkiNoteContext = {},
            extraMarkers?: Record<string, string>,
        ): Promise<EntryNoteStates[]> {
            const options = client.profile.get().options;
            const built = await Promise.all(entries.map((entry) => buildNotes(entry, context, extraMarkers)));
            const flat = built.flat();
            const fetchInfo =
                options.anki.duplicateBehavior === 'overwrite' || options.anki.displayTagsAndFlags !== 'never';
            const states =
                flat.length === 0
                    ? []
                    : await getNoteStates(
                          anki,
                          flat.map(({ note }) => note),
                          fetchInfo,
                      );
            let offset = 0;
            return built.map((notes, entryIndex) => ({
                entryIndex,
                cardFormats: notes.map(({ cardFormatIndex, errors }) => {
                    const state = states[offset++];
                    const format = options.anki.cardFormats[cardFormatIndex];
                    const { action, reason } = getSaveAction(options.anki.duplicateBehavior, state);
                    return {
                        cardFormatIndex,
                        name: format.name,
                        icon: format.icon,
                        action,
                        reason,
                        state,
                        viewNoteIds:
                            anki.guiBrowseNotes === undefined ? [] : state.duplicateNoteIds.filter((id) => id !== -1),
                        errors: errors.map((error) => error.message),
                    };
                }),
            }));
        },

        /**
         * Saves the entry with one card format, as Yomitan's save button does under the profile's
         * `anki.duplicateBehavior`: `new` adds a duplicate, `overwrite` updates the existing note
         * field by field (each field's `overwriteMode`), `prevent` refuses.
         */
        async addNote(
            entry: DictionaryEntry,
            cardFormatIndex: number,
            context: AnkiNoteContext = {},
            extraMarkers?: Record<string, string>,
        ): Promise<AddNoteResult> {
            const options = client.profile.get().options;
            const { note, errors } = await client.anki.buildNote(entry, { cardFormatIndex, context, extraMarkers });
            if (errors.length > 0) {
                throw new AggregateErrorLike(errors);
            }
            const behavior = options.anki.duplicateBehavior;
            const [state] = await getNoteStates(anki, [note], behavior === 'overwrite');
            if (state.duplicateNoteIds.length > 0) {
                if (behavior === 'prevent') {
                    throw new DuplicateNoteError();
                }
                if (behavior === 'overwrite') {
                    const overwriteId = state.duplicateNoteIds.find((id) => id !== -1);
                    const info = state.noteInfos.find((item) => item !== null && item.noteId === overwriteId);
                    if (overwriteId === undefined || info === undefined || info === null) {
                        throw new Error('The duplicate note could not be found');
                    }
                    const fieldOptions = options.anki.cardFormats[cardFormatIndex].fields;
                    const fields: Record<string, string> = {};
                    for (const [field, newValue] of Object.entries(note.fields)) {
                        fields[field] = getOverwrittenField(
                            info.fields[field]?.value ?? '',
                            newValue,
                            fieldOptions[field].overwriteMode as FieldOverwriteMode,
                        );
                    }
                    await anki.updateNoteFields({ ...note, fields, id: overwriteId });
                    return { noteId: overwriteId, overwritten: true };
                }
            }
            const noteId = await anki.addNote(note);
            if (noteId === null) {
                throw new Error('Anki did not create the note');
            }
            return { noteId, overwritten: false };
        },

        /** Opens existing notes in Anki's browser, when the transport supports it. */
        async viewNotes(noteIds: number[]): Promise<void> {
            if (anki.guiBrowseNotes === undefined) {
                throw new Error('This Anki connection cannot open the note browser');
            }
            await anki.guiBrowseNotes(noteIds);
        },
    };
}

/** `AggregateError` is missing on some React Native runtimes. */
class AggregateErrorLike extends Error {
    readonly errors: Error[];

    constructor(errors: Error[]) {
        super(errors.map((error) => error.message).join('\n'));
        this.name = 'AnkiNoteError';
        this.errors = errors;
    }
}

export type DisplayController = ReturnType<typeof createDisplayController>;
