/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2021-2022  Yomichan Authors
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

import { getDownstepPositions, getKanaDiacriticInfo, isMoraPitchHigh } from './japanese-util.js';

/**
 * Generates DOM elements for pronunciation visualizations including
 * pitch accent text, graphs, and downstep position notation.
 */
export class PronunciationGenerator {
    private _document: Document;

    /**
     * Creates a new PronunciationGenerator.
     * @param doc - The Document object to use for creating DOM elements.
     */
    constructor(doc: Document) {
        this._document = doc;
    }

    /**
     * Creates a span element containing styled mora elements for pronunciation text.
     * @param morae - Array of mora strings.
     * @param pitchPositions - The pitch accent downstep position (number or HL string pattern).
     * @param nasalPositions - Array of 1-indexed mora positions that are nasalized.
     * @param devoicePositions - Array of 1-indexed mora positions that are devoiced.
     * @returns A span element with class `pronunciation-text`.
     */
    createPronunciationText(
        morae: string[],
        pitchPositions: number | string,
        nasalPositions: number[],
        devoicePositions: number[],
    ): HTMLSpanElement {
        const nasalPositionsSet = nasalPositions.length > 0 ? new Set(nasalPositions) : null;
        const devoicePositionsSet = devoicePositions.length > 0 ? new Set(devoicePositions) : null;
        const container = this._document.createElement('span');
        container.className = 'pronunciation-text';
        for (let i = 0, ii = morae.length; i < ii; ++i) {
            const i1 = i + 1;
            const mora = morae[i];
            const highPitch = isMoraPitchHigh(i, pitchPositions);
            const highPitchNext = isMoraPitchHigh(i1, pitchPositions);
            const nasal = nasalPositionsSet?.has(i1);
            const devoice = devoicePositionsSet?.has(i1);

            const n1 = this._document.createElement('span');
            n1.className = 'pronunciation-mora';
            n1.dataset.position = `${i}`;
            n1.dataset.pitch = highPitch ? 'high' : 'low';
            n1.dataset.pitchNext = highPitchNext ? 'high' : 'low';

            const characterNodes: HTMLSpanElement[] = [];
            for (const character of mora) {
                const n2 = this._document.createElement('span');
                n2.className = 'pronunciation-character';
                n2.textContent = character;
                n1.appendChild(n2);
                characterNodes.push(n2);
            }

            if (devoice) {
                n1.dataset.devoice = 'true';
                const n3 = this._document.createElement('span');
                n3.className = 'pronunciation-devoice-indicator';
                n1.appendChild(n3);
            }
            if (nasal && characterNodes.length > 0) {
                n1.dataset.nasal = 'true';

                const group = this._document.createElement('span');
                group.className = 'pronunciation-character-group';

                const n2 = characterNodes[0];
                const character = n2.textContent as string;

                const characterInfo = getKanaDiacriticInfo(character);
                if (characterInfo !== null) {
                    n1.dataset.originalText = mora;
                    n2.dataset.originalText = character;
                    n2.textContent = characterInfo.character;
                }

                let n3 = this._document.createElement('span');
                n3.className = 'pronunciation-nasal-diacritic';
                n3.textContent = '\u309a'; // Combining handakuten
                group.appendChild(n3);

                n3 = this._document.createElement('span');
                n3.className = 'pronunciation-nasal-indicator';
                group.appendChild(n3);

                (n2.parentNode as ParentNode).replaceChild(group, n2);
                group.insertBefore(n2, group.firstChild);
            }

            const line = this._document.createElement('span');
            line.className = 'pronunciation-mora-line';
            n1.appendChild(line);

            container.appendChild(n1);
        }
        return container;
    }

    /**
     * Creates an SVG element representing the pitch accent graph.
     * @param morae - Array of mora strings.
     * @param pitchPositions - The pitch accent downstep position (number or HL string pattern).
     * @returns An SVG element with class `pronunciation-graph`.
     */
    createPronunciationGraph(morae: string[], pitchPositions: number | string): SVGSVGElement {
        const ii = morae.length;

        const svgns = 'http://www.w3.org/2000/svg';
        const svg = this._document.createElementNS(svgns, 'svg') as SVGSVGElement;
        svg.setAttribute('xmlns', svgns);
        svg.setAttribute('class', 'pronunciation-graph');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('viewBox', `0 0 ${50 * (ii + 1)} 100`);

        if (ii <= 0) {
            return svg;
        }

        const path1 = this._document.createElementNS(svgns, 'path');
        svg.appendChild(path1);

        const path2 = this._document.createElementNS(svgns, 'path');
        svg.appendChild(path2);

        const pathPoints: string[] = [];
        for (let i = 0; i < ii; ++i) {
            const highPitch = isMoraPitchHigh(i, pitchPositions);
            const highPitchNext = isMoraPitchHigh(i + 1, pitchPositions);
            const x = i * 50 + 25;
            const y = highPitch ? 25 : 75;
            if (highPitch && !highPitchNext) {
                this._addGraphDotDownstep(svg, svgns, x, y);
            } else {
                this._addGraphDot(svg, svgns, x, y);
            }
            pathPoints.push(`${x} ${y}`);
        }

        path1.setAttribute('class', 'pronunciation-graph-line');
        path1.setAttribute('d', `M${pathPoints.join(' L')}`);

        pathPoints.splice(0, ii - 1);
        {
            const highPitch = isMoraPitchHigh(ii, pitchPositions);
            const x = ii * 50 + 25;
            const y = highPitch ? 25 : 75;
            this._addGraphTriangle(svg, svgns, x, y);
            pathPoints.push(`${x} ${y}`);
        }

        path2.setAttribute('class', 'pronunciation-graph-line-tail');
        path2.setAttribute('d', `M${pathPoints.join(' L')}`);

        return svg;
    }

    /**
     * Creates a span element showing the downstep position in bracket notation.
     * @param downstepPositions - The downstep position (number or HL string pattern).
     * @returns A span element with class `pronunciation-downstep-notation`.
     */
    createPronunciationDownstepPosition(downstepPositions: number | string): HTMLSpanElement {
        const downsteps =
            typeof downstepPositions === 'string' ? getDownstepPositions(downstepPositions) : downstepPositions;
        const downstepPositionString = `${downsteps}`;

        const n1 = this._document.createElement('span');
        n1.className = 'pronunciation-downstep-notation';
        n1.dataset.downstepPosition = downstepPositionString;

        let n2 = this._document.createElement('span');
        n2.className = 'pronunciation-downstep-notation-prefix';
        n2.textContent = '[';
        n1.appendChild(n2);

        n2 = this._document.createElement('span');
        n2.className = 'pronunciation-downstep-notation-number';
        n2.textContent = downstepPositionString;
        n1.appendChild(n2);

        n2 = this._document.createElement('span');
        n2.className = 'pronunciation-downstep-notation-suffix';
        n2.textContent = ']';
        n1.appendChild(n2);

        return n1;
    }

    /**
     * Creates a Jidoujisho-style pronunciation graph SVG.
     * @param mora - Array of mora strings.
     * @param pitchPositions - The pitch accent downstep position (number or HL string pattern).
     * @returns An SVG element.
     */
    createPronunciationGraphJJ(mora: string[], pitchPositions: number | string): SVGSVGElement {
        const patt = this._pitchValueToPattJJ(mora.length, pitchPositions);

        const positions = Math.max(mora.length, patt.length);
        const stepWidth = 35;
        const marginLr = 16;
        const svgWidth = Math.max(0, (positions - 1) * stepWidth + marginLr * 2);

        const svgns = 'http://www.w3.org/2000/svg';
        const svg = this._document.createElementNS(svgns, 'svg') as SVGSVGElement;
        svg.setAttribute('xmlns', svgns);
        svg.setAttribute('width', `${svgWidth * (3 / 5)}px`);
        svg.setAttribute('height', '45px');
        svg.setAttribute('viewBox', `0 0 ${svgWidth} 75`);

        if (mora.length <= 0) {
            return svg;
        }

        for (let i = 0; i < mora.length; i++) {
            const xCenter = marginLr + i * stepWidth;
            this._textJJ(xCenter - 11, mora[i], svgns, svg);
        }

        let pathType = '';

        const circles: Element[] = [];
        const paths: Element[] = [];

        let prevCenter = [-1, -1];
        for (let i = 0; i < patt.length; i++) {
            const xCenter = marginLr + i * stepWidth;
            const accent = patt[i];
            let yCenter = 0;
            if (accent === 'H') {
                yCenter = 5;
            } else if (accent === 'L') {
                yCenter = 30;
            }
            circles.push(this._circleJJ(xCenter, yCenter, i >= mora.length, svgns));

            if (i > 0) {
                if (prevCenter[1] === yCenter) {
                    pathType = 's';
                } else if (prevCenter[1] < yCenter) {
                    pathType = 'd';
                } else if (prevCenter[1] > yCenter) {
                    pathType = 'u';
                }
                paths.push(this._pathJJ(prevCenter[0], prevCenter[1], pathType, stepWidth, svgns));
            }
            prevCenter = [xCenter, yCenter];
        }

        for (const path of paths) {
            svg.appendChild(path);
        }

        for (const circle of circles) {
            svg.appendChild(circle);
        }

        return svg;
    }

    // Private

    private _addGraphDot(container: Element, svgns: string, x: number, y: number): void {
        container.appendChild(this._createGraphCircle(svgns, 'pronunciation-graph-dot', x, y, '15'));
    }

    private _addGraphDotDownstep(container: Element, svgns: string, x: number, y: number): void {
        container.appendChild(this._createGraphCircle(svgns, 'pronunciation-graph-dot-downstep1', x, y, '15'));
        container.appendChild(this._createGraphCircle(svgns, 'pronunciation-graph-dot-downstep2', x, y, '5'));
    }

    private _addGraphTriangle(container: Element, svgns: string, x: number, y: number): void {
        const node = this._document.createElementNS(svgns, 'path');
        node.setAttribute('class', 'pronunciation-graph-triangle');
        node.setAttribute('d', 'M0 13 L15 -13 L-15 -13 Z');
        node.setAttribute('transform', `translate(${x},${y})`);
        container.appendChild(node);
    }

    private _createGraphCircle(svgns: string, className: string, x: number, y: number, radius: string): Element {
        const node = this._document.createElementNS(svgns, 'circle');
        node.setAttribute('class', className);
        node.setAttribute('cx', `${x}`);
        node.setAttribute('cy', `${y}`);
        node.setAttribute('r', radius);
        return node;
    }

    private _pitchValueToPattJJ(numberOfMora: number, pitchValue: number | string): string {
        if (typeof pitchValue === 'string') {
            return pitchValue + pitchValue[pitchValue.length - 1];
        }
        if (numberOfMora >= 1) {
            if (pitchValue === 0) {
                return `L${'H'.repeat(numberOfMora)}`;
            }
            if (pitchValue === 1) {
                return `H${'L'.repeat(numberOfMora)}`;
            }
            if (pitchValue >= 2) {
                const stepdown = pitchValue - 2;
                return `LH${'H'.repeat(stepdown)}${'L'.repeat(numberOfMora - pitchValue + 1)}`;
            }
        }
        return '';
    }

    private _circleJJ(x: number, y: number, o: boolean, svgns: string): Element {
        if (o) {
            const node = this._document.createElementNS(svgns, 'circle');
            node.setAttribute('r', '4');
            node.setAttribute('cx', `${x + 4}`);
            node.setAttribute('cy', `${y}`);
            node.setAttribute('stroke', 'currentColor');
            node.setAttribute('stroke-width', '2');
            node.setAttribute('fill', 'none');
            return node;
        }
        const node = this._document.createElementNS(svgns, 'circle');
        node.setAttribute('r', '5');
        node.setAttribute('cx', `${x}`);
        node.setAttribute('cy', `${y}`);
        node.setAttribute('style', 'opacity:1;fill:currentColor;');
        return node;
    }

    private _textJJ(x: number, mora: string, svgns: string, svg: SVGSVGElement): void {
        if (mora.length === 1) {
            const path = this._document.createElementNS(svgns, 'text');
            path.setAttribute('x', `${x}`);
            path.setAttribute('y', '67.5');
            path.setAttribute('style', 'font-size:20px;font-family:sans-serif;fill:currentColor;');
            path.textContent = mora;
            svg.appendChild(path);
        } else {
            const path1 = this._document.createElementNS(svgns, 'text');
            path1.setAttribute('x', `${x - 5}`);
            path1.setAttribute('y', '67.5');
            path1.setAttribute('style', 'font-size:20px;font-family:sans-serif;fill:currentColor;');
            path1.textContent = mora[0];
            svg.appendChild(path1);

            const path2 = this._document.createElementNS(svgns, 'text');
            path2.setAttribute('x', `${x + 12}`);
            path2.setAttribute('y', '67.5');
            path2.setAttribute('style', 'font-size:14px;font-family:sans-serif;fill:currentColor;');
            path2.textContent = mora[1];
            svg.appendChild(path2);
        }
    }

    private _pathJJ(x: number, y: number, type: string, stepWidth: number, svgns: string): Element {
        let delta = '';
        switch (type) {
            case 's':
                delta = `${stepWidth},0`;
                break;
            case 'u':
                delta = `${stepWidth},-25`;
                break;
            case 'd':
                delta = `${stepWidth},25`;
                break;
        }

        const path = this._document.createElementNS(svgns, 'path');
        path.setAttribute('d', `m ${x},${y} ${delta}`);
        path.setAttribute('style', 'fill:none;stroke:currentColor;stroke-width:1.5;');

        return path;
    }
}
