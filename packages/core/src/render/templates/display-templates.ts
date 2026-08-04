/*
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * The full HTML template string for display rendering.
 * Contains all template elements used by DisplayGenerator and HtmlTemplateCollection.
 * Sourced from Yomitan's templates-display.html.
 */
export const DISPLAY_TEMPLATES = `<!DOCTYPE html><html><head><title>Templates</title></head><body>

<!-- Term entry -->
<template id="term-entry-template" data-remove-whitespace-text="true"><div class="entry" data-type="term">
    <div class="entry-current-indicator" title="Current entry"><span class="entry-current-indicator-inner"></span></div>
    <div class="entry-header">
        <div class="actions">
            <div class="note-actions-container"></div>
            <div class="action-button-container">
                <button type="button" class="action-button" data-action="play-audio" title="Play audio" data-title-default="Play audio" data-menu-position="left below h-cover v-cover">
                    <span class="action-icon icon color-icon" data-icon="play-audio"></span>
                    <span class="action-button-badge icon" hidden></span>
                </button>
                <button type="button" class="action-button action-button-collapsible" data-action="menu" data-menu-position="left below h-cover v-cover">
                    <span class="action-icon icon" data-icon="kebab-menu"></span>
                </button>
            </div>
            <span class="entry-current-indicator-icon" title="Current entry">
                <span class="icon color-icon" data-icon="entry-current"></span>
            </span>
        </div>
        <div class="headword-list"></div>
        <div class="headword-list-details">
            <div class="headword-list-tag-list tag-list"></div>
            <ul class="inflection-rule-chains"></ul>
        </div>
    </div>
    <div class="entry-body">
        <div class="entry-body-section" data-section-type="frequencies">
            <div class="entry-body-section-content frequency-group-list"></div>
        </div>
        <div class="entry-body-section" data-section-type="pronunciations">
            <ol class="entry-body-section-content pronunciation-group-list"></ol>
        </div>
        <div class="entry-body-section" data-section-type="definitions">
            <ol class="entry-body-section-content definition-list"></ol>
        </div>
    </div>
</div></template>
<template id="headword-template" data-remove-whitespace-text="true"><div class="headword">
    <div class="headword-text-container">
        <span class="headword-term-outer source-text">
            <span class="headword-current-indicator"></span>
            <span class="headword-term"></span>
        </span>
        <span class="headword-reading-outer">
            <span class="headword-reading"></span>
        </span>
    </div>
    <div class="headword-details">
        <button type="button" class="action-button" data-action="play-audio" title="Play audio" data-title-default="Play audio" data-menu-position="right below h-cover v-cover">
            <span class="action-icon icon color-icon" data-icon="play-audio"></span>
            <span class="action-button-badge icon" hidden></span>
        </button>
    </div>
</div></template>
<template id="definition-item-template" data-remove-whitespace-text="true"><li class="definition-item">
    <div class="definition-item-inner">
        <button type="button" class="expansion-button"><div class="expansion-button-icon icon" data-icon="double-down-chevron"></div></button>
        <div class="definition-item-content">
            <div class="definition-tag-list tag-list"></div>
            <div class="definition-disambiguation-list"></div>
            <ul class="gloss-list"></ul>
        </div>
    </div>
</li></template>
<template id="definition-disambiguation-template"><span class="definition-disambiguation"></span></template>
<template id="gloss-item-template"><li class="gloss-item click-scannable"><span class="gloss-separator"> </span><span class="gloss-content"></span></li></template>
<template id="gloss-item-image-description-template"> <span class="gloss-image-description"></span></template>
<template id="inflection-rule-chain-template"><li class="inflection-rule-chain"></li></template>
<template id="inflection-template"><span class="inflection"></span><span class="inflection-separator"> </span></template>

<!-- Frequency -->
<template id="frequency-group-item-template"><span class="frequency-group-item"><span class="tag tag-has-body frequency-group-tag" data-category="frequency"><span class="tag-label"><span class="tag-label-content"></span></span><span class="tag-body"><span class="tag-body-content frequency-list"></span></span></span></span></template>
<template id="term-frequency-item-template" data-remove-whitespace-text="true"><span class="frequency-item"><span class="tag tag-has-body frequency-tag" data-category="frequency" data-frequency-type="term">
    <span class="tag-label"><span class="tag-label-content"></span></span>
    <span class="tag-body"><span class="tag-body-content frequency-body">
        <span class="frequency-disambiguation"><ruby>
            <span class="frequency-disambiguation-term"></span>
            <span class="frequency-disambiguation-separator"></span>
            <rt class="frequency-disambiguation-reading"></rt>
        </ruby></span>
        <span class="frequency-separator"></span>
        <span class="frequency-value-list"></span>
    </span></span>
</span></span></template>
<template id="kanji-frequency-item-template" data-remove-whitespace-text="true"><span class="frequency-item"><span class="tag tag-has-body frequency-tag" data-category="frequency" data-frequency-type="kanji">
    <span class="tag-label"><span class="tag-label-content"></span></span>
    <span class="tag-body"><span class="tag-body-content frequency-body">
        <span class="frequency-value-list"></span>
    </span></span>
</span></span></template>

<!-- Pitch accent -->
<template id="pronunciation-group-template"><li class="pronunciation-group"><span class="pronunciation-group-tag-list tag-list"></span><ul class="pronunciation-list"></ul></li></template>
<template id="pronunciation-disambiguation-template"><span class="pronunciation-disambiguation"></span></template>
<template id="pronunciation-template"><li class="pronunciation"><span class="pronunciation-tag-list tag-list"></span><span class="pronunciation-disambiguation-list"></span><span class="pronunciation-representation-list"><span class="pronunciation-text-container"></span><span class="pronunciation-downstep-notation-container"></span><span class="pronunciation-graph-container"></span></span></li></template>

<!-- Kanji entry -->
<template id="kanji-entry-template" data-remove-whitespace-text="true"><div class="entry kanji-entry" data-type="kanji">
    <div class="entry-current-indicator" title="Current entry"><span class="entry-current-indicator-inner"></span></div>
    <div class="entry-header">
        <div class="actions">
            <div class="note-actions-container"></div>
            <span class="entry-current-indicator-icon" title="Current entry">
                <span class="icon color-icon" data-icon="entry-current"></span>
            </span>
            <button type="button" class="action-button action-button-collapsible" data-action="menu" data-menu-position="left below h-cover v-cover">
                <span class="action-icon icon" data-icon="kebab-menu"></span>
            </button>
        </div>
        <div class="kanji-glyph-container">
            <span class="headword-current-indicator"></span>
            <div class="kanji-glyph source-text"></div>
        </div>
        <div class="kanji-tag-list tag-list"></div>
    </div>
    <div class="entry-body">
        <div class="entry-body-section" data-section-type="frequencies">
            <div class="entry-body-section-content frequency-group-list"></div>
        </div>
    </div>
    <div class="kanji-glyph-data">
        <button type="button" class="expansion-button"><div class="expansion-button-icon icon" data-icon="double-down-chevron"></div></button>
        <table class="kanji-glyph-table">
            <tbody>
                <tr>
                    <th scope="col">Meaning</th>
                    <th scope="col">Readings</th>
                    <th scope="col">Statistics</th>
                </tr>
                <tr>
                    <td class="kanji-gloss-container"><ol class="kanji-gloss-list"></ol></td>
                    <td class="kanji-readings"><dl class="kanji-readings-chinese"></dl><dl class="kanji-readings-japanese"></dl></td>
                    <td class="kanji-statistics"></td>
                </tr>
                <tr><th scope="col" colspan="3">Classifications</th></tr>
                <tr><td colspan="3" class="kanji-classifications"></td></tr>
                <tr><th scope="col" colspan="3">Codepoints</th></tr>
                <tr><td colspan="3" class="kanji-codepoints"></td></tr>
                <tr><th scope="col" colspan="3">Dictionary Indices</th></tr>
                <tr><td colspan="3" class="kanji-dictionary-indices"></td></tr>
            </tbody>
        </table>
    </div>
</div></template>
<template id="kanji-info-table-template"><table class="kanji-info-table"><tbody class="kanji-info-table-body"></tbody></table></template>
<template id="kanji-info-table-item-template"><tr class="kanji-info-table-item"><th scope="col" class="kanji-info-table-item-header"></th><td class="kanji-info-table-item-value"></td></tr></template>
<template id="kanji-info-table-empty-template"><tr class="kanji-info-table-item kanji-info-table-item-empty"><td class="kanji-info-table-item-value-empty">No data found</td></tr></template>
<template id="kanji-gloss-item-template"><li class="kanji-gloss-item"><span class="kanji-gloss-content"></span></li></template>
<template id="kanji-reading-template"><dd class="kanji-reading"></dd></template>

<!-- Tag -->
<template id="tag-template"><span class="tag"><span class="tag-label"><span class="tag-label-content"></span></span></span></template>
<template id="tag-with-body-template"><span class="tag tag-has-body"><span class="tag-label"><span class="tag-label-content"></span></span><span class="tag-body"><span class="tag-body-content"></span></span></span></template>

<!-- Extra -->
<template id="footer-notification-template"><div class="footer-notification scrollbar">
    <div class="footer-notification-body"></div>
    <div class="footer-notification-close-button-container">
        <button type="button" class="footer-notification-close-button"><span class="footer-notification-close-button-icon icon" data-icon="cross"></span></button>
    </div>
</div></template>
<template id="footer-notification-tag-details-template" data-remove-whitespace-text="true">
    <div class="tag-details"></div>
    <div class="tag-details-disambiguation-list"></div>
</template>
<template id="profile-list-item-template"><label class="profile-list-item">
    <div class="profile-list-item-selection"><label class="radio"><input type="radio" class="profile-entry-is-default-radio" name="profile-entry-default-radio"><span class="radio-body"><span class="radio-border"></span><span class="radio-dot"></span></span></label></div>
    <div class="profile-list-item-name"></div>
</label></template>

</body></html>`;
