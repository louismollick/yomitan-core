/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { upstreamPin as pin } from './upstream/pin.js';

/** The Yomitan commit the engine was vendored from, and the Yomitan release it corresponds to. */
export const upstreamPin: { readonly commit: string; readonly yomitanVersion: string } = pin;
