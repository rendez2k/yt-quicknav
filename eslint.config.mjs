import globals from 'globals';

export default [{
  files: ['plan-cache.js','prepare-worker.js','preparation.js','topics.js', 'content.js', 'injected.js', 'background.js', 'popup.js', 'cut-controls.js', 'analysis-engine.js', 'video-tools-model.js', 'ai-client.js', 'video-tools.js', 'usage-ledger.js'],
  languageOptions: {ecmaVersion: 'latest', sourceType: 'script',
    globals: {...globals.browser, ...globals.webextensions, YqnCache:'readonly',YqnTopics: 'readonly', YqnControls: 'readonly', YqnAnalysis: 'readonly', YqnToolsModel: 'readonly', YqnVideoTools: 'readonly', YqnAI: 'readonly', importScripts: 'readonly'}},
  rules: {'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-unused-vars': ['error', {argsIgnorePattern: '^_'}]}
}];
