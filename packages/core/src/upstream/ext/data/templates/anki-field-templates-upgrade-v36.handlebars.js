// Vendored from Yomitan by scripts/sync-upstream.mjs. Do not edit; see PROVENANCE.md.
export default "{{#*inline \"onyomi-hiragana\"}}\n    {{~#each definition.onyomi}}{{hiragana .}}{{#unless @last}}, {{/unless}}{{/each~}}\n{{/inline}}";
