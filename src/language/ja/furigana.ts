export type { FuriganaSegment } from './japanese';
export { distributeFurigana, distributeFuriganaInflected } from './japanese';

import { distributeFurigana } from './japanese';
import type { FuriganaSegment } from './japanese';

export function generateFurigana(text: string, reading: string): FuriganaSegment[] {
    return distributeFurigana(text, reading);
}
