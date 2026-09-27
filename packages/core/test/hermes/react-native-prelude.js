// Globals a React Native 0.86 runtime provides but the standalone Hermes CLI does not. Only add
// things React Native really has, so missing platform APIs still fail the smoke test.
(function () {
    var g = globalThis;
    if (typeof g.console === 'undefined') {
        var log = function () {
            print(Array.prototype.map.call(arguments, String).join(' '));
        };
        g.console = {log: log, info: log, warn: log, error: log, debug: log};
    }
    if (typeof g.queueMicrotask === 'undefined') {
        g.queueMicrotask = function (callback) {
            Promise.resolve().then(callback);
        };
    }
    if (typeof g.performance === 'undefined') {
        g.performance = {now: function () { return Date.now(); }};
    }
    // React Native's Hermes ships ECMA-402 Collator on iOS and Android; the CLI build has no Intl.
    if (typeof g.Intl === 'undefined') {
        g.Intl = {
            Collator: function () {
                return {compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }};
            },
        };
    }
})();
