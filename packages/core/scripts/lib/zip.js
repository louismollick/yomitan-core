// zip.js without web workers. Upstream's importer calls configure({workerScripts}); workers are
// disabled here so the importer runs identically in browsers, workers, Node and React Native.
import { configure as baseConfigure } from '@zip.js/zip.js/lib/zip-no-worker-inflate.js';

export * from '@zip.js/zip.js/lib/zip-no-worker-inflate.js';

export function configure(options) {
    baseConfigure({ ...options, workerScripts: undefined, useWebWorkers: false });
}
