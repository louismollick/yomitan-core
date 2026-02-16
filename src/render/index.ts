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

// Core rendering classes
export { DisplayGenerator } from './display-generator.js';
export { StructuredContentGenerator } from './structured-content-generator.js';
export { PronunciationGenerator } from './pronunciation-generator.js';
export { HtmlTemplateCollection } from './html-template-collection.js';

// Content management
export type { ContentManager } from './content-manager.js';
export { NoOpContentManager } from './content-manager.js';

// CSS utilities
export { sanitizeCSS, addScopeToCss, addScopeToCssLegacy } from './css-util.js';

// Japanese rendering utilities
export {
    isCodePointKanji,
    isMoraPitchHigh,
    getPitchCategory,
    getDownstepPositions,
    getKanaMorae,
    getKanaMoraCount,
    getKanaDiacriticInfo,
} from './japanese-util.js';
export type { PitchCategory, DiacriticType } from './japanese-util.js';

// Templates and styles
export { DISPLAY_TEMPLATES } from './templates/display-templates.js';
export { DISPLAY_CSS } from './styles/display-styles.js';
export { STRUCTURED_CONTENT_CSS } from './styles/structured-content-styles.js';
export { PRONUNCIATION_CSS } from './styles/pronunciation-styles.js';
