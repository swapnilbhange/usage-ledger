/*
 * Which site are we on, and which tokenizer belongs to the selected model?
 * Pure functions (no DOM, no chrome.*) so the mapping is unit-tested.
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.LedgerProviders = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict';

	const NAMES = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };
	const PROVIDERS = Object.keys(NAMES);

	function detect(hostname) {
		const h = String(hostname || '').toLowerCase();
		if (h === 'claude.ai') return 'claude';
		if (h === 'chatgpt.com' || h === 'chat.openai.com') return 'openai';
		if (h === 'gemini.google.com') return 'gemini';
		return null;
	}

	// OpenAI: cl100k_base only for the legacy GPT-4 / GPT-3.5 generation; everything newer is o200k_base.
	const OPENAI_CL100K = /^gpt-(3\.5|4)(?![o.\d])/;
	const OPENAI_O200K = /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|chatgpt-4o|codex|o[134](?:$|-))/;
	// Gemini: Google's SDK counts these locally with the Gemma 3 vocabulary.
	const GEMINI_GEMMA3 = /gemini-(2(?:\.\d+)?|3)(?:-|$)/;

	/**
	 * @param {'claude'|'openai'|'gemini'} provider
	 * @param {string|null} model  model slug or the label shown in the site's model picker
	 * @param {{claudeApi?: boolean}} [opts]
	 * @returns {{id:string,label:string,exact:boolean,kind:string}}
	 */
	function specFor(provider, model, opts) {
		const m = String(model || '').toLowerCase().trim();
		if (provider === 'openai') {
			if (OPENAI_CL100K.test(m)) return { id: 'openai:cl100k_base', label: 'OpenAI cl100k_base', exact: true, kind: 'cl100k' };
			if (OPENAI_O200K.test(m)) return { id: 'openai:o200k_base', label: 'OpenAI o200k_base', exact: true, kind: 'o200k' };
			return { id: 'openai:o200k_base', label: 'OpenAI o200k_base (assumed for this model)', exact: false, kind: 'o200k' };
		}
		if (provider === 'gemini') {
			const ok = GEMINI_GEMMA3.test(m);
			return {
				id: 'gemini:gemma3',
				label: ok ? 'Gemma 3 SentencePiece (Gemini tokenizer)' : 'Gemma 3 SentencePiece (approximate for this model)',
				exact: ok,
				kind: 'gemma3'
			};
		}
		if (opts && opts.claudeApi) return { id: 'claude:api', label: 'Anthropic count_tokens API (near-exact)', exact: true, kind: 'claude-api' };
		return { id: 'claude:o200k-proxy', label: 'o200k proxy for Claude (estimate)', exact: false, kind: 'o200k' };
	}

	return { NAMES, PROVIDERS, detect, specFor };
});
