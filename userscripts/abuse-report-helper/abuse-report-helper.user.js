// ==UserScript==
// @name         Wayfarer Abuse Report Helper
// @namespace    https://github.com/GABRlEL/wayfarer-addons/
// @downloadURL  https://github.com/GABRlEL/wayfarer-addons/raw/refs/heads/main/userscripts/abuse-report-helper/abuse-report-helper.user.js
// @updateURL    https://github.com/GABRlEL/wayfarer-addons/raw/refs/heads/main/userscripts/abuse-report-helper/abuse-report-helper.user.js
// @homepageURL  https://github.com/GABRlEL/wayfarer-addons/
// @version      1.0.0
// @description  Remember contact details, prefill abuse-report preset and QoL for the abuse form.
// @author       https://solo.to/Gab
// @match        https://niantic.helpshift.com/hc/*/21-wayfarer/faq/2190-reporting-abuse-in-wayfarer*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// ==/UserScript==

// Disclaimer
// You may use any of my creations for your own creations, but please always give proper credit and if applicable, always credit the people I credited too please.
// I use AI for my tools so I can release helpful tools in a higher frequency. I'm always transparent about this.

(function () {
    'use strict';

    // Keep the script limited to the requested page, even if a userscript manager
    // interprets the @match wildcard more broadly than expected.
    const pagePath = location.pathname.replace(/\/+$/, '');
    if (location.hostname !== 'niantic.helpshift.com'
        || !/^\/hc\/[^/]+\/21-wayfarer\/faq\/2190-reporting-abuse-in-wayfarer$/i.test(pagePath)) {
        return;
    }

    const STORAGE_KEYS = {
        profile: 'wayfarerAbuseReportHelper.profile.v1',
        presets: 'wayfarerAbuseReportHelper.presets.v1',
        settings: 'wayfarerAbuseReportHelper.settings.v1',
    };

    const MAX_PRESETS = 100;
    const DEFAULT_SETTINGS = Object.freeze({
        blurEmail: true,
        blurName: false,
        requireReportField: true,
    });
    // The location-details textarea is the second report textarea in every
    // supplied language snapshot, so this remains independent of translations.
    const REQUIRED_REPORT_TEXTAREA_INDEX = 1;
    const REQUIRED_REPORT_FIELD_DISPLAY_NAME = 'Provide details of the location(s)';
    const HELPER_ID = 'nw-wayfarer-abuse-helper';
    const STYLE_ID = 'nw-wayfarer-abuse-helper-style';
    const ARTICLE_BUTTON_ID = 'nw-wayfarer-article-report-button';

    const BUILTIN_PRESETS = Object.freeze([
        Object.freeze({
            name: 'AI Gen Main - OpenAI',
            category: 'Fake Nominations or criteria issues',
            categoryId: 'co-2',
            details: 'This nominations main photo has been AI-generated with OpenAI Tools. This can be verified through OpenAIs verify tool: https://openai.com/research/verify/',
        }),
        Object.freeze({
            name: 'AI Gen Multiple - OpenAI',
            category: 'Fake Nominations or criteria issues',
            categoryId: 'co-2',
            details: 'Multiple photos from this submission have been AI-generated with OpenAI Tools. This can be verified through OpenAIs verify tool: https://openai.com/research/verify/',
        }),
        Object.freeze({
            name: 'AI Gen Main - Google',
            category: 'Fake Nominations or criteria issues',
            categoryId: 'co-2',
            details: 'This nominations main photo has been AI-generated with Gemini. This can be verified using Googles verification tool as explained in these instructions: https://support.google.com/gemini?p=verify_ai',
        }),
        Object.freeze({
            name: 'AI Gen Multiple - Google',
            category: 'Fake Nominations or criteria issues',
            categoryId: 'co-2',
            details: 'Multiple photos from this submission have been AI-generated with Gemini. This can be verified using Googles verification tool as explained in these instructions: https://support.google.com/gemini?p=verify_ai',
        }),
        Object.freeze({
            name: 'Third Party Photo - Street View',
            category: 'Photo Issues',
            categoryId: 'co-3',
            details: 'This submission uses third party pictures. They were taken from Google Street View.',
        }),
        Object.freeze({
            name: 'Third Party Photo - Generic',
            category: 'Photo Issues',
            categoryId: 'co-3',
            details: 'This submission uses third party pictures. They were taken from this source: ',
        }),
    ]);

    const state = {
        helper: null,
        stage: 'waiting',
        formHost: null,
        formRoot: null,
        profile: null,
        presets: clonePresets(BUILTIN_PRESETS),
        settings: { ...DEFAULT_SETTINGS },
        profileLoaded: false,
        presetsLoaded: false,
        settingsLoaded: false,
        selectedPresetIndex: '',
        message: { text: '', tone: 'info' },
        modalOpen: false,
        settingsOpen: false,
        helperExpanded: false,
        helperPlaced: false,
        readyPromise: null,
        enhanceTimer: null,
        formObserver: null,
        observedFormRoot: null,
        requiredFieldOriginals: new WeakMap(),
        requiredFieldGuardCleanup: null,
        requiredFieldGuardRoot: null,
        requiredFieldGuardControl: null,
        requiredFieldGuardSubmitHost: null,
        requiredFieldGuardSubmitButton: null,
        pollTimer: null,
        applyPromise: null,
        applyRunId: 0,
    };

    function clonePresets(presets) {
        return presets.map((preset) => {
            const clone = {
                name: preset.name,
                category: preset.category,
                details: preset.details,
            };
            const categoryId = text(preset.categoryId);
            if (categoryId) {
                clone.categoryId = categoryId;
            }
            return clone;
        });
    }

    function text(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function normalized(value) {
        return text(value).replace(/\s+/g, ' ').toLowerCase();
    }

    function normalizeSettings(value) {
        return {
            blurEmail: value && typeof value.blurEmail === 'boolean'
                ? value.blurEmail
                : DEFAULT_SETTINGS.blurEmail,
            blurName: value && typeof value.blurName === 'boolean'
                ? value.blurName
                : DEFAULT_SETTINGS.blurName,
            requireReportField: value && typeof value.requireReportField === 'boolean'
                ? value.requireReportField
                : DEFAULT_SETTINGS.requireReportField,
        };
    }

    function getGlobalFunction(name) {
        return typeof globalThis[name] === 'function' ? globalThis[name] : null;
    }

    async function storageGet(key, fallback) {
        const gmGet = getGlobalFunction('GM_getValue');
        if (gmGet) {
            return await gmGet(key, fallback);
        }

        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            return fallback;
        }
    }

    async function storageSet(key, value) {
        const gmSet = getGlobalFunction('GM_setValue');
        if (gmSet) {
            await gmSet(key, value);
            return;
        }

        localStorage.setItem(key, JSON.stringify(value));
    }

    async function storageRemove(key) {
        const gmDelete = getGlobalFunction('GM_deleteValue');
        if (gmDelete) {
            await gmDelete(key);
            return;
        }

        localStorage.removeItem(key);
    }

    function normalizeProfile(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }

        const name = text(value.name);
        const email = text(value.email);
        return name && email ? { name, email } : null;
    }

    function normalizePreset(value, index) {
        if (!value || typeof value !== 'object') {
            throw new Error(`Preset ${index + 1} must be an object.`);
        }

        // Accept both the compact internal names and descriptive JSON names so
        // custom preset files are easy to author by hand.
        const name = text(value.name || value.presetName || value['Preset Name'] || value.title);
        const category = text(value.category || value.Category);
        const categoryId = text(value.categoryId || value.category_id || value['Category ID']);
        const rawDetails = value.details
            ?? value.abuseReportDetails
            ?? value.abuse_report_details
            ?? value['Abuse report details']
            ?? value['Abuse Report Details'];
        const details = typeof rawDetails === 'string' ? rawDetails : '';

        if (!name || !category || !details.trim()) {
            throw new Error(`Preset ${index + 1} needs a name, category, and non-empty details value.`);
        }

        const preset = { name, category, details };
        if (categoryId) {
            preset.categoryId = categoryId;
        }
        return preset;
    }

    function parsePresetPayload(payload) {
        let parsed;
        try {
            parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch (error) {
            throw new Error('The preset file is not valid JSON.');
        }

        const entries = Array.isArray(parsed)
            ? parsed
            : parsed && (Array.isArray(parsed.presets) ? parsed.presets : parsed.items);

        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('Use a non-empty JSON array of preset objects.');
        }

        if (entries.length > MAX_PRESETS) {
            throw new Error(`Please import no more than ${MAX_PRESETS} presets.`);
        }

        const presets = entries.map(normalizePreset);
        const names = new Set();
        presets.forEach((preset) => {
            const key = normalized(preset.name);
            if (names.has(key)) {
                throw new Error(`Preset names must be unique: “${preset.name}”.`);
            }
            names.add(key);
        });

        return presets;
    }

    async function loadStoredState() {
        const [storedProfile, storedPresets, storedSettings] = await Promise.all([
            storageGet(STORAGE_KEYS.profile, null),
            storageGet(STORAGE_KEYS.presets, null),
            storageGet(STORAGE_KEYS.settings, null),
        ]);

        state.profile = normalizeProfile(storedProfile);
        state.profileLoaded = true;
        state.settings = normalizeSettings(storedSettings);
        state.settingsLoaded = true;

        try {
            state.presets = storedPresets ? parsePresetPayload(storedPresets) : clonePresets(BUILTIN_PRESETS);
        } catch (error) {
            state.presets = clonePresets(BUILTIN_PRESETS);
        }
        state.presetsLoaded = true;
    }

    function makeElement(tagName, properties = {}, children = []) {
        const element = document.createElement(tagName);
        Object.entries(properties).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'dataset') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    element.dataset[dataKey] = dataValue;
                });
            } else if (key === 'attrs') {
                Object.entries(value).forEach(([attribute, attributeValue]) => {
                    element.setAttribute(attribute, attributeValue);
                });
            } else {
                element[key] = value;
            }
        });
        children.forEach((child) => element.append(child));
        return element;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${HELPER_ID} {
                --nw-action-color: var(--action-color, #f15b2a);
                --nw-content-bg: var(--content-bg-color, #ffffff);
                --nw-primary-text: var(--primary-text-color, #2f3437);
                --nw-secondary-text: var(--secondary-text-color, #69727a);
                --nw-border: var(--primary-text-color-20-opacity, rgba(47, 52, 55, .2));
                position: relative;
                z-index: 2;
                width: 100%;
                box-sizing: border-box;
                margin: 24px 0;
                overflow: visible;
                border: 1px solid var(--nw-border);
                border-radius: 8px;
                background: var(--nw-content-bg);
                box-shadow: 0 4px 18px rgba(0, 0, 0, .12);
                color: var(--nw-primary-text);
                font-family: var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
                font-size: 14px;
                line-height: 1.4;
            }

            #${HELPER_ID}[hidden],
            #${HELPER_ID} [hidden] {
                display: none !important;
            }

            #${HELPER_ID} *,
            #${HELPER_ID} *::before,
            #${HELPER_ID} *::after {
                box-sizing: border-box;
            }

            #${HELPER_ID} .nw-helper-toggle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 34px;
                height: 34px;
                padding: 0;
                border: 1px solid var(--nw-border);
                border-radius: 50%;
                background: transparent;
                color: var(--nw-primary-text);
                cursor: pointer;
                font: inherit;
                font-size: 20px;
                font-weight: 600;
                line-height: 1;
            }

            #${HELPER_ID} .nw-helper-toggle:hover,
            #${HELPER_ID} .nw-helper-toggle[aria-expanded="true"],
            #${HELPER_ID} .nw-helper-primary:hover {
                background: var(--primary-text-color-5-opacity, rgba(47, 52, 55, .05));
            }

            #${HELPER_ID} .nw-helper-panel {
                width: 100%;
                max-height: min(680px, 70vh);
                margin: 0;
                overflow: auto;
                border: 0;
                border-radius: 0;
                background: transparent;
                box-shadow: none;
            }

            #${HELPER_ID} .nw-helper-header {
                position: relative;
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
                padding: 16px 18px 12px;
                border-bottom: 1px solid var(--nw-border);
            }

            #${HELPER_ID} .nw-helper-header-actions {
                position: relative;
                display: flex;
                align-items: center;
                gap: 6px;
                flex: 0 0 auto;
            }

            #${HELPER_ID} .nw-helper-settings-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 34px;
                height: 34px;
                padding: 0;
                border: 1px solid var(--nw-border);
                border-radius: 50%;
                background: transparent;
                color: var(--nw-primary-text);
                cursor: pointer;
                font: inherit;
                font-size: 18px;
                line-height: 1;
            }

            #${HELPER_ID} .nw-helper-settings-button:hover,
            #${HELPER_ID} .nw-helper-settings-button[aria-expanded="true"] {
                background: var(--primary-text-color-5-opacity, rgba(47, 52, 55, .05));
            }

            #${HELPER_ID} .nw-helper-settings {
                position: absolute;
                top: 42px;
                right: 0;
                z-index: 5;
                width: min(310px, calc(100vw - 64px));
                padding: 14px;
                border: 1px solid var(--nw-border);
                border-radius: 8px;
                background: var(--nw-content-bg);
                box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
            }

            #${HELPER_ID} .nw-helper-settings-title {
                margin: 0 0 10px;
                font-size: 14px;
                font-weight: 600;
            }

            #${HELPER_ID} .nw-helper-settings-section + .nw-helper-settings-section {
                margin-top: 14px;
                padding-top: 12px;
                border-top: 1px solid var(--nw-border);
            }

            #${HELPER_ID} .nw-helper-settings-label {
                display: block;
                margin-bottom: 7px;
                color: var(--nw-secondary-text);
                font-size: 12px;
                font-weight: 600;
            }

            #${HELPER_ID} .nw-helper-settings .nw-helper-button-row {
                gap: 6px;
            }

            #${HELPER_ID} .nw-helper-settings .nw-helper-button {
                flex: 1 1 120px;
                min-height: 34px;
                padding: 6px 9px;
                font-size: 12px;
            }

            #${HELPER_ID} .nw-helper-switch {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 30px;
                color: var(--nw-primary-text);
                cursor: pointer;
                font-size: 12px;
            }

            #${HELPER_ID} .nw-helper-switch + .nw-helper-switch {
                margin-top: 5px;
            }

            #${HELPER_ID} .nw-helper-switch input {
                width: 16px;
                height: 16px;
                margin: 0;
                accent-color: var(--nw-action-color);
                cursor: pointer;
            }

            #${HELPER_ID} .nw-helper-heading {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                line-height: 1.35;
            }

            #${HELPER_ID} .nw-helper-subheading,
            #${HELPER_ID} .nw-helper-muted,
            #${HELPER_ID} .nw-helper-hint {
                color: var(--nw-secondary-text);
            }

            #${HELPER_ID} .nw-helper-subheading {
                margin: 3px 0 0;
                font-size: 12px;
            }

            #${HELPER_ID} .nw-helper-body {
                padding: 16px 18px 18px;
            }

            #${HELPER_ID} .nw-helper-body > * + * {
                margin-top: 12px;
            }

            #${HELPER_ID} .nw-helper-label {
                display: block;
                margin-bottom: 5px;
                font-weight: 600;
            }

            #${HELPER_ID} .nw-helper-select,
            #${HELPER_ID} .nw-helper-input,
            #${HELPER_ID} .nw-helper-textarea {
                display: block;
                width: 100%;
                min-height: 42px;
                padding: 9px 11px;
                border: 1px solid var(--nw-border);
                border-radius: 4px;
                background: var(--nw-content-bg);
                color: var(--nw-primary-text);
                font: inherit;
            }

            #${HELPER_ID} .nw-helper-textarea {
                min-height: 180px;
                resize: vertical;
                white-space: pre-wrap;
            }

            #${HELPER_ID} .nw-helper-select:focus,
            #${HELPER_ID} .nw-helper-input:focus,
            #${HELPER_ID} .nw-helper-textarea:focus,
            #${HELPER_ID} button:focus-visible {
                outline: 2px solid var(--nw-action-color);
                outline-offset: 2px;
            }

            #${HELPER_ID} .nw-helper-button-row {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            #${HELPER_ID} .nw-helper-button {
                min-height: 38px;
                padding: 8px 12px;
                border: 1px solid var(--nw-border);
                border-radius: 4px;
                background: transparent;
                color: var(--nw-primary-text);
                cursor: pointer;
                font: inherit;
                font-weight: 600;
            }

            #${HELPER_ID} .nw-helper-primary {
                border-color: var(--nw-action-color);
                background: var(--nw-action-color);
                color: #ffffff;
            }

            #${HELPER_ID} .nw-helper-danger {
                color: #b42318;
            }

            #${HELPER_ID} .nw-helper-status {
                padding: 9px 10px;
                border-radius: 4px;
                background: var(--primary-text-color-5-opacity, rgba(47, 52, 55, .05));
                color: var(--nw-secondary-text);
                font-size: 12px;
                white-space: pre-wrap;
            }

            #${HELPER_ID} .nw-helper-status[data-tone="success"] {
                background: rgba(20, 125, 70, .1);
                color: #167347;
            }

            #${HELPER_ID} .nw-helper-status[data-tone="warning"] {
                background: rgba(180, 120, 0, .12);
                color: #8a5a00;
            }

            #${HELPER_ID} .nw-helper-status[data-tone="error"] {
                background: rgba(190, 35, 35, .1);
                color: #a32121;
            }

            #${HELPER_ID} .nw-helper-preview {
                padding: 10px;
                border: 1px solid var(--nw-border);
                border-radius: 4px;
                font-size: 12px;
            }

            #${HELPER_ID} .nw-helper-preview p {
                margin: 0;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }

            #${HELPER_ID} .nw-helper-preview p + p {
                margin-top: 8px;
            }

            #${HELPER_ID} .nw-helper-modal-backdrop {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                background: rgba(0, 0, 0, .45);
            }

            #${HELPER_ID} .nw-helper-modal {
                width: min(560px, calc(100vw - 32px));
                max-height: calc(100vh - 32px);
                overflow: auto;
                border: 1px solid var(--nw-border);
                border-radius: 8px;
                background: var(--nw-content-bg);
                color: var(--nw-primary-text);
                box-shadow: 0 12px 36px rgba(0, 0, 0, .28);
            }

            #${HELPER_ID} .nw-helper-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 16px 18px;
                border-bottom: 1px solid var(--nw-border);
            }

            #${HELPER_ID} .nw-helper-modal-title {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
            }

            #${HELPER_ID} .nw-helper-close {
                min-width: 34px;
                min-height: 34px;
                padding: 0;
                border: 1px solid var(--nw-border);
                border-radius: 50%;
                background: transparent;
                color: var(--nw-primary-text);
                cursor: pointer;
                font: inherit;
                font-size: 20px;
                line-height: 1;
            }

            #${HELPER_ID} .nw-helper-modal-body {
                padding: 18px;
            }

            #${HELPER_ID} .nw-helper-modal-body > * + * {
                margin-top: 12px;
            }

            #${HELPER_ID} .nw-helper-field-error {
                color: #a32121;
                font-size: 12px;
            }

            .nw-article-report-duplicate {
                display: block;
                width: 100%;
                margin: 0 0 24px;
            }

            .nw-article-report-duplicate hc-button {
                display: block;
                width: 100%;
            }

            .nw-article-report-duplicate .nw-article-report-fallback {
                display: block;
                width: 100%;
                min-height: 42px;
                padding: 10px 16px;
                border: 0;
                border-radius: 4px;
                background: var(--action-color, #f15b2a);
                color: #ffffff;
                cursor: pointer;
                font: inherit;
                font-weight: 600;
                text-align: center;
            }

            @media (max-width: 600px) {
                #${HELPER_ID} {
                    margin-top: 18px;
                    margin-bottom: 18px;
                }
            }
        `;
        const gmAddStyle = getGlobalFunction('GM_addStyle');
        if (gmAddStyle) {
            gmAddStyle(style.textContent);
        } else {
            document.head.append(style);
        }
    }

    function createHelper() {
        if (state.helper) {
            return state.helper;
        }

        injectStyles();

        const helper = makeElement('aside', {
            id: HELPER_ID,
            hidden: true,
            attrs: { 'aria-label': 'Report helper' },
        });

        const toggle = makeElement('button', {
            type: 'button',
            className: 'nw-helper-toggle',
            textContent: '▾',
            dataset: { action: 'toggle-helper' },
            attrs: {
                'aria-label': 'Expand report helper',
                'aria-expanded': 'false',
                'aria-controls': `${HELPER_ID}-panel`,
            },
        });

        const panel = makeElement('div', {
            id: `${HELPER_ID}-panel`,
            className: 'nw-helper-panel',
        });

        const headerTitle = makeElement('div', {}, [
            makeElement('h2', { className: 'nw-helper-heading', textContent: 'Report helper' }),
            makeElement('p', { className: 'nw-helper-subheading', textContent: 'Saves time by prefilling fields.' }),
        ]);
        const settingsButton = makeElement('button', {
            type: 'button',
            className: 'nw-helper-settings-button',
            textContent: '⚙',
            dataset: { action: 'toggle-settings' },
            attrs: {
                'aria-label': 'Open helper settings',
                'aria-expanded': 'false',
                'aria-controls': `${HELPER_ID}-settings`,
            },
        });
        const settingsPanel = makeElement('div', {
            id: `${HELPER_ID}-settings`,
            className: 'nw-helper-settings',
            hidden: true,
            attrs: { role: 'region', 'aria-label': 'Helper settings' },
        });
        const headerActions = makeElement('div', { className: 'nw-helper-header-actions' }, [
            toggle,
            settingsButton,
            settingsPanel,
        ]);
        const header = makeElement('div', { className: 'nw-helper-header' }, [
            headerTitle,
            headerActions,
        ]);

        const body = makeElement('div', { className: 'nw-helper-body' });
        panel.append(body);

        const fileInput = makeElement('input', {
            type: 'file',
            accept: 'application/json,.json',
            hidden: true,
            attrs: { 'aria-label': 'Choose a preset JSON file' },
        });

        const modalBackdrop = makeElement('div', {
            className: 'nw-helper-modal-backdrop',
            hidden: true,
            dataset: { modal: 'backdrop' },
        });
        const modal = makeElement('div', {
            className: 'nw-helper-modal',
            attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${HELPER_ID}-modal-title` },
        });
        const modalHeader = makeElement('div', { className: 'nw-helper-modal-header' });
        const modalTitle = makeElement('h2', { id: `${HELPER_ID}-modal-title`, className: 'nw-helper-modal-title' });
        const closeModalButton = makeElement('button', {
            type: 'button',
            className: 'nw-helper-close',
            textContent: '×',
            dataset: { action: 'close-modal' },
            attrs: { 'aria-label': 'Close dialog' },
        });
        modalHeader.append(modalTitle, closeModalButton);
        const modalBody = makeElement('div', { className: 'nw-helper-modal-body' });
        modal.append(modalHeader, modalBody);
        modalBackdrop.append(modal);

        helper.append(header, panel, fileInput, modalBackdrop);
        document.body.append(helper);

        state.helper = helper;
        helper.addEventListener('click', handleHelperClick);
        helper.addEventListener('change', handleHelperChange);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.modalOpen) {
                closeModal();
            }
        });
        modalBackdrop.addEventListener('click', (event) => {
            if (event.target === modalBackdrop) {
                closeModal();
            }
        });

        return helper;
    }

    function setMessage(message, tone = 'info') {
        state.message = { text: message, tone };
        renderHelperContent();
    }

    function appendStatus(container, fallbackMessage = '') {
        const message = state.message.text || fallbackMessage;
        if (!message) {
            return;
        }

        container.append(makeElement('div', {
            className: 'nw-helper-status',
            textContent: message,
            dataset: { tone: state.message.tone },
            attrs: { role: 'status' },
        }));
    }

    function findRelatedArticlesContainer() {
        return document.querySelector('.related-articles.js-related-articles')
            || document.querySelector('.js-related-articles')
            || document.querySelector('.related-articles');
    }

    function placeHelperBeforeRelatedArticles() {
        const helper = state.helper;
        const related = findRelatedArticlesContainer();
        if (!helper || !related || !related.parentElement || helper === related || helper.contains(related)) {
            return false;
        }

        // The page uses the article and Related articles as two desktop flex
        // columns. Keep the helper inside the Related articles column so it
        // appears above that section without becoming a third flex item.
        if (helper.parentElement !== related || related.firstElementChild !== helper) {
            related.insertBefore(helper, related.firstChild);
        }
        return true;
    }

    function renderSettingsContent() {
        const helper = state.helper;
        if (!helper) {
            return;
        }

        const panel = helper.querySelector('.nw-helper-settings');
        const button = helper.querySelector('.nw-helper-settings-button');
        if (!panel || !button) {
            return;
        }

        const presetSection = makeElement('div', { className: 'nw-helper-settings-section' });
        presetSection.append(makeElement('div', {
            className: 'nw-helper-settings-label',
            textContent: 'Preset management',
        }));
        const presetButtons = makeElement('div', { className: 'nw-helper-button-row' });
        presetButtons.append(
            makeElement('button', {
                type: 'button',
                className: 'nw-helper-button',
                textContent: 'Import JSON presets',
                dataset: { action: 'open-import' },
            }),
            makeElement('button', {
                type: 'button',
                className: 'nw-helper-button',
                textContent: 'Restore built-ins',
                dataset: { action: 'restore-presets' },
            }),
        );
        presetSection.append(presetButtons);

        const privacySection = makeElement('div', { className: 'nw-helper-settings-section' });
        privacySection.append(makeElement('div', {
            className: 'nw-helper-settings-label',
            textContent: 'Privacy',
        }));
        privacySection.append(
            makeElement('label', { className: 'nw-helper-switch' }, [
                makeElement('input', {
                    type: 'checkbox',
                    checked: state.settings.blurEmail,
                    dataset: { control: 'blur-email' },
                    attrs: { role: 'switch', 'aria-label': 'Blur email field' },
                }),
                makeElement('span', { textContent: 'Blur email field (revealed on focus)' }),
            ]),
            makeElement('label', { className: 'nw-helper-switch' }, [
                makeElement('input', {
                    type: 'checkbox',
                    checked: state.settings.blurName,
                    dataset: { control: 'blur-name' },
                    attrs: { role: 'switch', 'aria-label': 'Blur name field' },
                }),
                makeElement('span', { textContent: 'Blur name field (revealed on focus)' }),
            ]),
        );

        const submissionSection = makeElement('div', { className: 'nw-helper-settings-section' });
        submissionSection.append(makeElement('div', {
            className: 'nw-helper-settings-label',
            textContent: 'Submission safeguards',
        }));
        submissionSection.append(makeElement('label', { className: 'nw-helper-switch' }, [
            makeElement('input', {
                type: 'checkbox',
                checked: state.settings.requireReportField,
                dataset: { control: 'require-report-field' },
                attrs: { role: 'switch', 'aria-label': 'Require location details before submitting' },
            }),
            makeElement('span', {
                textContent: `Require “${REQUIRED_REPORT_FIELD_DISPLAY_NAME}” before submitting`,
            }),
        ]));

        panel.replaceChildren(
            makeElement('h3', { className: 'nw-helper-settings-title', textContent: 'Settings' }),
            presetSection,
            privacySection,
            submissionSection,
        );
        panel.hidden = !state.settingsOpen;
        button.setAttribute('aria-expanded', String(state.settingsOpen));
    }

    function renderProfileContent(container) {
        container.append(makeElement('p', {
            className: 'nw-helper-muted',
            textContent: 'Save the name and email used for reports. Empty fields on this page will be filled automatically on future attempts.',
        }));

        const savedText = state.profile
            ? 'Saved name and email are ready for this form.'
            : (state.profileLoaded ? 'No saved name or email yet.' : 'Loading saved details…');
        container.append(makeElement('div', {
            className: 'nw-helper-status',
            textContent: savedText,
            dataset: { tone: state.profile ? 'success' : 'info' },
            attrs: { role: 'status' },
        }));

        const buttons = makeElement('div', { className: 'nw-helper-button-row' });
        buttons.append(makeElement('button', {
            type: 'button',
            className: 'nw-helper-button nw-helper-primary',
            textContent: state.profile ? 'Update name & email' : 'Set name & email',
            dataset: { action: 'open-profile' },
        }));

        if (state.profile) {
            buttons.append(makeElement('button', {
                type: 'button',
                className: 'nw-helper-button nw-helper-danger',
                textContent: 'Forget saved details',
                dataset: { action: 'clear-profile' },
            }));
        }

        container.append(buttons);
        appendStatus(container);
    }

    function renderReportContent(container) {
        container.append(makeElement('p', {
            className: 'nw-helper-muted',
            textContent: 'Choose a preset to fill the report category and abuse-report details.',
        }));

        const field = makeElement('div');
        field.append(makeElement('label', {
            className: 'nw-helper-label',
            textContent: 'Preset',
            attrs: { for: `${HELPER_ID}-preset-select` },
        }));

        const select = makeElement('select', {
            id: `${HELPER_ID}-preset-select`,
            className: 'nw-helper-select',
            dataset: { control: 'preset-select' },
            attrs: { 'aria-label': 'Choose a report preset' },
        });
        select.append(makeElement('option', {
            value: '',
            textContent: state.presetsLoaded ? 'Choose a preset…' : 'Loading presets…',
        }));

        state.presets.forEach((preset, index) => {
            select.append(makeElement('option', {
                value: String(index),
                textContent: preset.name,
            }));
        });

        if (state.selectedPresetIndex !== '' && state.presets[state.selectedPresetIndex]) {
            select.value = String(state.selectedPresetIndex);
        }
        field.append(select);
        container.append(field);

        const selected = state.presets[state.selectedPresetIndex];
        if (selected) {
            const preview = makeElement('div', { className: 'nw-helper-preview' });
            preview.append(
                makeElement('p', { textContent: `Category: ${selected.category}` }),
                makeElement('p', { textContent: selected.details }),
            );
            container.append(preview);
        }

        const applyButtons = makeElement('div', { className: 'nw-helper-button-row' });
        applyButtons.append(makeElement('button', {
            type: 'button',
            className: 'nw-helper-button nw-helper-primary',
            textContent: 'Apply preset',
            dataset: { action: 'apply-preset' },
            disabled: !selected,
        }));
        container.append(applyButtons);

        appendStatus(container, 'Selecting or applying a preset changes fields only. Review the report and submit it yourself.');
    }

    function renderWaitingContent(container) {
        container.append(makeElement('p', {
            className: 'nw-helper-muted',
            textContent: 'Waiting for the abuse-report form to finish loading…',
        }));
        appendStatus(container);
    }

    function renderHelperContent() {
        const helper = state.helper || createHelper();
        const panel = helper.querySelector('.nw-helper-panel');
        const body = helper.querySelector('.nw-helper-body');
        const toggle = helper.querySelector('.nw-helper-toggle');

        state.helperPlaced = placeHelperBeforeRelatedArticles();
        renderSettingsContent();
        helper.hidden = !state.helperPlaced;
        body.replaceChildren();

        if (state.stage === 'profile') {
            renderProfileContent(body);
        } else if (state.stage === 'report') {
            renderReportContent(body);
        } else {
            renderWaitingContent(body);
        }

        toggle.textContent = state.helperExpanded ? '▴' : '▾';
        toggle.setAttribute('aria-expanded', String(state.helperExpanded));
        toggle.setAttribute(
            'aria-label',
            state.helperExpanded ? 'Collapse report helper' : 'Expand report helper',
        );
        panel.hidden = !state.helperExpanded;
    }

    function findReportCtaButton() {
        const form = findSmartForm();
        const root = form && form.shadowRoot;
        if (!root) {
            return null;
        }

        const directButton = root.querySelector('hc-button.smart-form__cta-btn');
        if (directButton) {
            return directButton;
        }

        // The class is the primary component contract. The label comparison
        // is only a structural fallback and intentionally uses the localized
        // label exposed by the host instead of a translated string.
        const ctaLabel = text(form.getAttribute('cta-label'));
        return ctaLabel
            ? Array.from(root.querySelectorAll('hc-button')).find((button) => (
                text(button.getAttribute('label')) === ctaLabel
            )) || null
            : null;
    }

    function openReportFormFromArticleButton() {
        const cta = findReportCtaButton();
        if (!cta) {
            return false;
        }

        const button = cta.shadowRoot && cta.shadowRoot.querySelector('button');
        clickElement(button || cta);
        return true;
    }

    function createArticleReportButton(originalCta) {
        const originalWrapper = originalCta && originalCta.parentElement;
        const wrapper = originalWrapper
            ? originalWrapper.cloneNode(false)
            : makeElement('div');
        wrapper.id = ARTICLE_BUTTON_ID;
        wrapper.classList.add('nw-article-report-duplicate');

        // Clone the custom-element host so its localized label, icon, RTL
        // setting, disabled state, and any future CTA attributes stay in sync
        // with the page's own button. cloneNode(false) does not copy the
        // original shadow tree or event listeners.
        const control = originalCta
            ? originalCta.cloneNode(false)
            : makeElement('button', {
                type: 'button',
                className: 'nw-article-report-fallback',
                textContent: 'Report',
            });

        control.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openReportFormFromArticleButton();
        });
        wrapper.append(control);
        return wrapper;
    }

    function injectArticleReportButton() {
        const existing = document.getElementById(ARTICLE_BUTTON_ID);
        const articleBody = document.querySelector('.faq-body.js-faq-body')
            || document.querySelector('.js-faq-body');
        const intro = articleBody && articleBody.querySelector('p');
        const originalCta = findReportCtaButton();

        // Keep the duplicate on the article page only while the original CTA
        // exists. Once the form opens, the original CTA is replaced by the
        // form steps and the duplicate is no longer useful.
        if (!articleBody || !intro || !intro.parentElement || !originalCta) {
            if (existing) {
                existing.remove();
            }
            return;
        }

        const parent = intro.parentElement;
        if (existing && existing.parentElement === parent && existing.nextElementSibling === intro) {
            return;
        }

        if (existing) {
            existing.remove();
        }
        parent.insertBefore(createArticleReportButton(originalCta), intro);
    }

    function setModal(title, content) {
        const helper = state.helper || createHelper();
        const backdrop = helper.querySelector('.nw-helper-modal-backdrop');
        const titleElement = helper.querySelector('.nw-helper-modal-title');
        const body = helper.querySelector('.nw-helper-modal-body');
        titleElement.textContent = title;
        body.replaceChildren(content);
        backdrop.hidden = false;
        state.modalOpen = true;
    }

    function closeModal() {
        if (!state.helper) {
            return;
        }

        const backdrop = state.helper.querySelector('.nw-helper-modal-backdrop');
        const body = state.helper.querySelector('.nw-helper-modal-body');
        backdrop.hidden = true;
        body.replaceChildren();
        state.modalOpen = false;
    }

    function makeModalActions(cancelLabel = 'Cancel') {
        const actions = makeElement('div', { className: 'nw-helper-button-row' });
        actions.append(makeElement('button', {
            type: 'button',
            className: 'nw-helper-button',
            textContent: cancelLabel,
            dataset: { action: 'close-modal' },
        }));
        return actions;
    }

    function makeLabeledInput(labelText, inputElement) {
        const wrapper = makeElement('div');
        const id = inputElement.id;
        wrapper.append(makeElement('label', {
            className: 'nw-helper-label',
            textContent: labelText,
            attrs: { for: id },
        }));
        wrapper.append(inputElement);
        return wrapper;
    }

    function openProfileModal() {
        const wrapper = makeElement('div');
        const nameInput = makeElement('input', {
            id: `${HELPER_ID}-profile-name`,
            className: 'nw-helper-input',
            type: 'text',
            value: state.profile ? state.profile.name : '',
            autocomplete: 'name',
            required: true,
        });
        const emailInput = makeElement('input', {
            id: `${HELPER_ID}-profile-email`,
            className: 'nw-helper-input',
            type: 'email',
            value: state.profile ? state.profile.email : '',
            autocomplete: 'email',
            required: true,
        });
        wrapper.append(
            makeElement('p', {
                className: 'nw-helper-muted',
                textContent: 'These details are stored by your userscript manager for this helper and are used only to prefill the two contact fields.',
            }),
            makeLabeledInput('Name', nameInput),
            makeLabeledInput('Email', emailInput),
        );

        const error = makeElement('div', { className: 'nw-helper-field-error', hidden: true, attrs: { role: 'alert' } });
        wrapper.append(error);
        const actions = makeModalActions();
        const saveButton = makeElement('button', {
            type: 'button',
            className: 'nw-helper-button nw-helper-primary',
            textContent: 'Save details',
        });
        actions.append(saveButton);
        wrapper.append(actions);

        saveButton.addEventListener('click', async () => {
            const name = text(nameInput.value);
            const email = text(emailInput.value);
            if (!name || !email || !emailInput.checkValidity()) {
                error.textContent = 'Enter both a name and a valid email address.';
                error.hidden = false;
                return;
            }

            try {
                const profile = { name, email };
                await storageSet(STORAGE_KEYS.profile, profile);
                state.profile = profile;
                closeModal();
                fillProfileFields(state.formRoot, profile, true);
                setMessage('Name and email saved. The current empty contact fields were filled.', 'success');
            } catch (storageError) {
                error.textContent = 'Could not save the details in browser storage.';
                error.hidden = false;
            }
        });

        setModal('Set name & email', wrapper);
        nameInput.focus();
    }

    function openImportModal() {
        const wrapper = makeElement('div');
        const textarea = makeElement('textarea', {
            id: `${HELPER_ID}-preset-json`,
            className: 'nw-helper-textarea',
            spellcheck: false,
            placeholder: '[{"name":"My preset","category":"Photo Issues","categoryId":"co-3","details":"Details for the report"}]',
        });
        const hint = makeElement('p', {
            className: 'nw-helper-hint',
            textContent: 'Importing replaces the active preset list. Each object needs name (or presetName), category, and details (or abuseReportDetails). Add categoryId when a preset should follow the category across page languages.',
        });
        wrapper.append(hint, textarea);
        const error = makeElement('div', { className: 'nw-helper-field-error', hidden: true, attrs: { role: 'alert' } });
        wrapper.append(error);

        const actions = makeModalActions();
        actions.insertBefore(makeElement('button', {
            type: 'button',
            className: 'nw-helper-button',
            textContent: 'Choose JSON file',
            dataset: { action: 'choose-preset-file' },
        }), actions.firstChild);
        actions.append(makeElement('button', {
            type: 'button',
            className: 'nw-helper-button nw-helper-primary',
            textContent: 'Replace presets',
            dataset: { action: 'import-pasted-presets' },
        }));
        wrapper.append(actions);

        // Keep the modal's current text available to the delegated action handler.
        wrapper.dataset.modalContent = 'preset-import';
        setModal('Import custom presets', wrapper);
        textarea.focus();
    }

    async function importPresetText(payload, errorElement) {
        try {
            const presets = parsePresetPayload(payload);
            await storageSet(STORAGE_KEYS.presets, presets);
            state.presets = presets;
            state.presetsLoaded = true;
            state.selectedPresetIndex = '';
            closeModal();
            setMessage(`${presets.length} custom preset${presets.length === 1 ? '' : 's'} imported and activated.`, 'success');
        } catch (error) {
            errorElement.textContent = error.message || 'Could not import the presets.';
            errorElement.hidden = false;
        }
    }

    async function importPresetFile(file) {
        if (!file) {
            return;
        }

        const errorElement = state.helper.querySelector('.nw-helper-modal-body .nw-helper-field-error');
        try {
            const payload = await file.text();
            await importPresetText(payload, errorElement);
        } catch (error) {
            if (errorElement) {
                errorElement.textContent = 'Could not read that JSON file.';
                errorElement.hidden = false;
            }
        }
    }

    async function restoreBuiltInPresets() {
        if (!window.confirm('Replace the current presets with the original built-in presets?')) {
            return;
        }

        try {
            await storageRemove(STORAGE_KEYS.presets);
            state.presets = clonePresets(BUILTIN_PRESETS);
            state.presetsLoaded = true;
            state.selectedPresetIndex = '';
            setMessage('The original built-in presets have been restored.', 'success');
        } catch (error) {
            setMessage('Could not restore the built-in presets.', 'error');
        }
    }

    async function updateSetting(setting, enabled) {
        if (setting !== 'blurEmail'
            && setting !== 'blurName'
            && setting !== 'requireReportField') {
            return;
        }

        const previous = state.settings[setting];
        state.settings[setting] = Boolean(enabled);
        applyPrivacySettings(state.formRoot);
        configureRequiredReportField(state.formRoot);

        try {
            await storageSet(STORAGE_KEYS.settings, state.settings);
        } catch (error) {
            state.settings[setting] = previous;
            applyPrivacySettings(state.formRoot);
            configureRequiredReportField(state.formRoot);
            setMessage('Could not save the setting.', 'error');
        }
    }

    async function clearProfile() {
        if (!window.confirm('Forget the saved name and email?')) {
            return;
        }

        try {
            await storageRemove(STORAGE_KEYS.profile);
            state.profile = null;
            setMessage('Saved name and email were removed. Existing fields were left untouched.', 'success');
        } catch (error) {
            setMessage('Could not remove the saved details.', 'error');
        }
    }

    function handleHelperClick(event) {
        const actionElement = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('[data-action]')
            : null;
        if (!actionElement || !state.helper.contains(actionElement)) {
            return;
        }

        const action = actionElement.dataset.action;
        if (action === 'toggle-helper') {
            state.helperExpanded = !state.helperExpanded;
            renderHelperContent();
            return;
        }

        if (action === 'toggle-settings') {
            state.settingsOpen = !state.settingsOpen;
            renderSettingsContent();
            return;
        }

        if (action === 'open-profile') {
            openProfileModal();
            return;
        }

        if (action === 'clear-profile') {
            void clearProfile();
            return;
        }

        if (action === 'open-import') {
            openImportModal();
            return;
        }

        if (action === 'choose-preset-file') {
            state.helper.querySelector('input[type="file"]').click();
            return;
        }

        if (action === 'import-pasted-presets') {
            const modalBody = state.helper.querySelector('.nw-helper-modal-body');
            const textarea = modalBody.querySelector('textarea');
            const errorElement = modalBody.querySelector('.nw-helper-field-error');
            void importPresetText(textarea.value, errorElement);
            return;
        }

        if (action === 'restore-presets') {
            void restoreBuiltInPresets();
            return;
        }

        if (action === 'apply-preset') {
            const preset = state.presets[state.selectedPresetIndex];
            if (preset) {
                void applyPreset(preset);
            }
            return;
        }

        if (action === 'close-modal') {
            closeModal();
        }
    }

    function handleHelperChange(event) {
        const target = event.target;
        if (target && target.tagName === 'INPUT' && target.type === 'checkbox') {
            const setting = target.dataset.control === 'blur-email'
                ? 'blurEmail'
                : target.dataset.control === 'blur-name'
                    ? 'blurName'
                    : target.dataset.control === 'require-report-field'
                        ? 'requireReportField'
                        : '';
            if (setting) {
                void updateSetting(setting, target.checked);
            }
            return;
        }

        if (target && target.tagName === 'INPUT' && target.type === 'file') {
            const file = target.files && target.files[0];
            target.value = '';
            void importPresetFile(file);
            return;
        }

        if (!target || target.tagName !== 'SELECT'
            || target.dataset.control !== 'preset-select') {
            return;
        }

        state.selectedPresetIndex = target.value === '' ? '' : Number(target.value);
        renderHelperContent();
        const preset = state.presets[state.selectedPresetIndex];
        if (preset) {
            void applyPreset(preset);
        }
    }

    function findSmartForm() {
        return Array.from(document.querySelectorAll('smart-form')).find((element) => (
            element.classList.contains('js-smart-form')
            || !!element.shadowRoot
        )) || null;
    }

    function getFormStage() {
        const host = findSmartForm();
        const root = host && host.shadowRoot;
        if (!host || !root) {
            return { stage: 'waiting', host: null, root: null };
        }

        if (root.querySelector('hc-input.smart-form__user-field-input')
            && root.querySelector('hc-button.smart-form__user-info-btn')) {
            return { stage: 'profile', host, root };
        }

        if (root.querySelector('static-dropdown')
            && root.querySelector('hc-textarea')) {
            return { stage: 'report', host, root };
        }

        return { stage: 'waiting', host, root };
    }

    function getNativeControl(customElement) {
        if (!customElement) {
            return null;
        }

        return (customElement.shadowRoot && customElement.shadowRoot.querySelector('input, textarea, select'))
            || (customElement.matches && customElement.matches('input, textarea, select') ? customElement : null);
    }

    function setNativeValue(control, value) {
        if (!control) {
            return;
        }

        const stringValue = String(value);
        const view = control.ownerDocument && control.ownerDocument.defaultView
            ? control.ownerDocument.defaultView
            : window;
        const prototype = control.tagName === 'TEXTAREA'
            ? view.HTMLTextAreaElement.prototype
            : view.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(control, stringValue);
        } else {
            control.value = stringValue;
        }

        try {
            control.focus();
        } catch (error) {
            // Focus is only a compatibility aid; some custom controls reject it.
        }

        try {
            control.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                data: stringValue,
                inputType: 'insertText',
            }));
        } catch (error) {
            control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        control.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    function setCustomControlValue(customElement, value) {
        if (!customElement) {
            return false;
        }

        const stringValue = String(value);

        // Set the host first. Lit-based controls can schedule a render when
        // their public value property changes; setting it before the inner
        // control prevents that render from restoring the old value.
        try {
            if ('value' in customElement) {
                customElement.value = stringValue;
            }
        } catch (error) {
            // Ignore read-only host properties.
        }

        const control = getNativeControl(customElement);
        if (control) {
            setNativeValue(control, stringValue);
        }

        // Keep the host and native control in sync for component versions that
        // listen at either level of the open shadow tree.
        try {
            if (customElement && 'value' in customElement) {
                customElement.value = stringValue;
            }
        } catch (error) {
            // Ignore read-only host properties.
        }

        customElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        customElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return !!control;
    }

    async function fillCustomControl(customElement, value) {
        if (!customElement) {
            return false;
        }

        const desired = String(value);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (!setCustomControlValue(customElement, desired)) {
                return false;
            }

            // The form controls are Lit components and may replace their
            // inner textarea on the next microtask. Verify the current node,
            // then retry against the same host if it was re-rendered.
            await wait(0);
            const currentControl = getNativeControl(customElement);
            if (currentControl && currentControl.value === desired) {
                return true;
            }
        }

        return false;
    }

    function findProfileControls(root) {
        const hosts = Array.from(root.querySelectorAll('hc-input.smart-form__user-field-input'));
        const controls = hosts.map((host) => {
            const control = getNativeControl(host);
            return {
                host,
                control,
                autocomplete: normalized(
                    host.getAttribute('autocomplete')
                        || (control && control.getAttribute('autocomplete')),
                ),
                type: normalized(control && control.getAttribute('type')),
                placeholder: text(
                    host.getAttribute('placeholder')
                        || (control && control.getAttribute('placeholder')),
                ),
            };
        });

        const email = controls.find((item) => (
            item.type === 'email'
            || item.autocomplete === 'email'
            || item.placeholder.includes('@')
        )) || controls[1] || null;
        const name = controls.find((item) => (
            item !== email && item.autocomplete === 'name'
        )) || controls.find((item) => item !== email) || controls[0] || null;

        return {
            name,
            email: email === name ? controls.find((item) => item !== name) || null : email,
        };
    }

    function fillProfileFields(root, profile = state.profile, overwrite = false) {
        if (!root || !profile) {
            return;
        }

        const controls = findProfileControls(root);
        [
            [controls.name, profile.name],
            [controls.email, profile.email],
        ].forEach(([entry, value]) => {
            if (!entry || !entry.control || (!overwrite && text(entry.control.value))) {
                return;
            }
            const setting = entry === controls.email ? 'blurEmail' : 'blurName';
            bindPrivacyControl(entry, setting);
            entry.control.dataset.nwPrivacyAutofill = 'true';
            entry.control.dataset.nwPrivacyRevealed = 'false';
            updatePrivacyBlur(entry.control);
            try {
                // The privacy filter is already applied before the value is
                // written, so the email never paints unblurred during autofill.
                setCustomControlValue(entry.host, value);
            } finally {
                try {
                    entry.control.blur();
                } catch (error) {
                    // Blurring is only used to keep an automatically filled
                    // value private until the user focuses the field.
                }
                entry.control.dataset.nwPrivacyAutofill = 'false';
                entry.control.dataset.nwPrivacyRevealed = 'false';
                updatePrivacyBlur(entry.control);
            }
        });
    }

    function updatePrivacyBlur(control) {
        if (!control) {
            return;
        }

        const setting = control.dataset.nwPrivacySetting;
        const enabled = setting ? !!state.settings[setting] : false;
        const revealed = control.dataset.nwPrivacyRevealed === 'true';
        const focused = typeof control.matches === 'function' && control.matches(':focus');
        const shouldBlur = enabled && !revealed && !focused;
        const filter = shouldBlur ? 'blur(10px)' : 'none';
        control.style.setProperty('filter', filter, 'important');
        control.style.setProperty('-webkit-filter', filter, 'important');
        // Do not animate this: the value should be private before it is
        // painted, especially when the helper fills the field automatically.
        control.style.removeProperty('transition');
        control.style.removeProperty('-webkit-transition');
    }

    function bindPrivacyControl(entry, setting) {
        if (!entry || !entry.control) {
            return;
        }

        const control = entry.control;
        control.dataset.nwPrivacySetting = setting;
        if (control.dataset.nwPrivacyBound !== 'true') {
            control.addEventListener('focus', () => {
                if (control.dataset.nwPrivacyAutofill === 'true') {
                    return;
                }
                control.dataset.nwPrivacyRevealed = 'true';
                updatePrivacyBlur(control);
            });
            control.addEventListener('click', () => {
                if (control.dataset.nwPrivacyAutofill === 'true') {
                    return;
                }
                control.dataset.nwPrivacyRevealed = 'true';
                updatePrivacyBlur(control);
            });
            control.addEventListener('blur', () => {
                control.dataset.nwPrivacyRevealed = 'false';
                updatePrivacyBlur(control);
            });
            control.dataset.nwPrivacyBound = 'true';
        }
        updatePrivacyBlur(control);
    }

    function applyPrivacySettings(root) {
        if (!root) {
            return;
        }

        const controls = findProfileControls(root);
        bindPrivacyControl(controls.email, 'blurEmail');
        bindPrivacyControl(controls.name, 'blurName');
    }

    function findFieldByLabel(root, label) {
        const expected = normalized(label);
        return Array.from(root.querySelectorAll('form-field')).find((field) => (
            normalized(field.getAttribute('label')) === expected
        )) || null;
    }

    function findControlAfterField(root, label, tagName) {
        const field = findFieldByLabel(root, label);
        if (!field) {
            return null;
        }

        let sibling = field.nextElementSibling;
        while (sibling) {
            if (sibling.matches('form-field, hc-hcaptcha, .smart-form__submit-btn-wrapper')) {
                break;
            }
            if (sibling.matches(tagName)) {
                return sibling;
            }
            sibling = sibling.nextElementSibling;
        }

        return null;
    }

    function findReportDetailsControl(root) {
        if (!root) {
            return null;
        }

        // The first report textarea is the Abuse report details field in the
        // supplied English and German snapshots. Using structure instead of
        // the translated label keeps this language-independent.
        return root.querySelector('hc-textarea');
    }

    function findRequiredReportField(root) {
        if (!root) {
            return null;
        }

        const controls = Array.from(root.querySelectorAll('hc-textarea'));
        const control = controls[REQUIRED_REPORT_TEXTAREA_INDEX] || null;
        const field = control && control.closest('form-field');
        if (!control || !field) {
            return null;
        }

        return {
            field,
            control,
            native: getNativeControl(control),
            label: text(field.getAttribute('label')) || REQUIRED_REPORT_FIELD_DISPLAY_NAME,
        };
    }

    function saveRequiredFieldOriginals(descriptor) {
        let record = state.requiredFieldOriginals.get(descriptor.field);
        if (!record) {
            record = {
                field: {
                    isOptional: descriptor.field.getAttribute('is-optional'),
                    required: descriptor.field.getAttribute('required'),
                    ariaRequired: descriptor.field.getAttribute('aria-required'),
                },
                controls: new WeakMap(),
            };
            state.requiredFieldOriginals.set(descriptor.field, record);
        }

        if (!record.controls.has(descriptor.control)) {
            record.controls.set(descriptor.control, {
                required: descriptor.control.getAttribute('required'),
                ariaRequired: descriptor.control.getAttribute('aria-required'),
                native: descriptor.native
                    ? {
                        required: descriptor.native.getAttribute('required'),
                        ariaRequired: descriptor.native.getAttribute('aria-required'),
                    }
                    : null,
            });
        } else if (descriptor.native) {
            const controlRecord = record.controls.get(descriptor.control);
            if (!controlRecord.native) {
                controlRecord.native = {
                    required: descriptor.native.getAttribute('required'),
                    ariaRequired: descriptor.native.getAttribute('aria-required'),
                };
            }
        }

        return record;
    }

    function restoreAttribute(element, attribute, originalValue) {
        if (!element) {
            return;
        }

        if (originalValue === null) {
            element.removeAttribute(attribute);
        } else {
            element.setAttribute(attribute, originalValue);
        }
    }

    function setRequiredFlag(element, required) {
        if (!element) {
            return;
        }

        if (required) {
            if (!element.hasAttribute('required')) {
                element.setAttribute('required', '');
            }
        } else if (element.hasAttribute('required')) {
            element.removeAttribute('required');
        }

        try {
            if ('required' in element && Boolean(element.required) !== required) {
                element.required = required;
            }
        } catch (error) {
            // The attribute is still enough for custom elements that expose
            // no writable required property.
        }
    }

    function setAttributeIfDifferent(element, attribute, value) {
        if (!element || element.getAttribute(attribute) === value) {
            return;
        }
        element.setAttribute(attribute, value);
    }

    function setRequiredFieldInvalid(descriptor, invalid) {
        [descriptor.field, descriptor.control, descriptor.native]
            .filter(Boolean)
            .forEach((element) => {
                if (invalid) {
                    element.setAttribute('aria-invalid', 'true');
                } else {
                    element.removeAttribute('aria-invalid');
                }
            });
    }

    function requiredFieldValue(descriptor) {
        const native = descriptor.native || getNativeControl(descriptor.control);
        return text(native ? native.value : descriptor.control.value);
    }

    function requiredFieldIsFilled(descriptor) {
        return !!descriptor && !!requiredFieldValue(descriptor);
    }

    function enforceRequiredReportField(descriptor) {
        if (!descriptor) {
            return;
        }

        const original = saveRequiredFieldOriginals(descriptor);
        setAttributeIfDifferent(descriptor.field, 'is-optional', 'false');
        setAttributeIfDifferent(descriptor.field, 'required', '');
        setAttributeIfDifferent(descriptor.field, 'aria-required', 'true');
        setRequiredFlag(descriptor.control, true);
        setAttributeIfDifferent(descriptor.control, 'aria-required', 'true');
        setRequiredFlag(descriptor.native, true);
        if (descriptor.native) {
            setAttributeIfDifferent(descriptor.native, 'aria-required', 'true');
        }

        // Keep the record live for a control whose shadow textarea appears
        // after the host is first rendered.
        if (!original.controls.get(descriptor.control).native && descriptor.native) {
            original.controls.get(descriptor.control).native = {
                required: descriptor.native.getAttribute('required'),
                ariaRequired: descriptor.native.getAttribute('aria-required'),
            };
        }
    }

    function restoreRequiredReportField(descriptor) {
        if (!descriptor) {
            return;
        }

        const original = state.requiredFieldOriginals.get(descriptor.field);
        const controlOriginal = original && original.controls.get(descriptor.control);
        if (!original || !controlOriginal) {
            return;
        }

        restoreAttribute(descriptor.field, 'is-optional', original.field.isOptional);
        restoreAttribute(descriptor.field, 'required', original.field.required);
        restoreAttribute(descriptor.field, 'aria-required', original.field.ariaRequired);
        restoreAttribute(descriptor.control, 'required', controlOriginal.required);
        restoreAttribute(descriptor.control, 'aria-required', controlOriginal.ariaRequired);
        if (descriptor.native && controlOriginal.native) {
            restoreAttribute(descriptor.native, 'required', controlOriginal.native.required);
            restoreAttribute(descriptor.native, 'aria-required', controlOriginal.native.ariaRequired);
        }

        try {
            if ('required' in descriptor.control) {
                descriptor.control.required = controlOriginal.required !== null;
            }
            if (descriptor.native && 'required' in descriptor.native) {
                descriptor.native.required = controlOriginal.native
                    ? controlOriginal.native.required !== null
                    : false;
            }
        } catch (error) {
            // Restoring the attributes is sufficient for custom controls that
            // do not expose writable properties.
        }
    }

    function clearRequiredReportFieldGuard() {
        if (state.requiredFieldGuardCleanup) {
            state.requiredFieldGuardCleanup();
        }
        state.requiredFieldGuardCleanup = null;
        state.requiredFieldGuardRoot = null;
        state.requiredFieldGuardControl = null;
        state.requiredFieldGuardSubmitHost = null;
        state.requiredFieldGuardSubmitButton = null;
    }

    function eventPathContains(event, element) {
        if (!element) {
            return false;
        }

        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        return path.includes(element);
    }

    function eventTargetsSubmit(event, submitHost, submitButton) {
        if (event.type === 'submit') {
            return true;
        }

        if (event.currentTarget === submitHost || event.currentTarget === submitButton) {
            return true;
        }

        if (eventPathContains(event, submitHost) || eventPathContains(event, submitButton)) {
            return true;
        }

        const target = event.target;
        return !!(target && target.closest && target.closest('hc-button.smart-form__submit-btn'));
    }

    function blockRequiredReportSubmit(root) {
        const descriptor = findRequiredReportField(root);
        if (!descriptor || requiredFieldIsFilled(descriptor)) {
            return;
        }

        setRequiredFieldInvalid(descriptor, true);
        const message = `Submission blocked: “${descriptor.label}” is required before submitting.`;
        if (state.message.text !== message) {
            setMessage(message, 'warning');
        }

        window.setTimeout(() => {
            const latest = findRequiredReportField(root);
            const control = latest && (latest.native || latest.control);
            if (control && typeof control.focus === 'function') {
                try {
                    control.focus();
                } catch (error) {
                    // Focus is only a convenience after blocking submission.
                }
            }
        }, 0);
    }

    function configureRequiredReportField(root) {
        if (!root || state.stage !== 'report' || !state.settings.requireReportField) {
            if (!state.settings.requireReportField) {
                const previous = state.requiredFieldGuardControl
                    ? findRequiredReportField(state.requiredFieldGuardRoot)
                    : null;
                restoreRequiredReportField(previous);
            }
            clearRequiredReportFieldGuard();
            return;
        }

        const descriptor = findRequiredReportField(root);
        if (!descriptor) {
            clearRequiredReportFieldGuard();
            return;
        }

        enforceRequiredReportField(descriptor);

        const submitHost = root.querySelector('hc-button.smart-form__submit-btn')
            || root.querySelector('.smart-form__submit-btn-wrapper hc-button');
        const submitButton = submitHost && submitHost.shadowRoot
            ? submitHost.shadowRoot.querySelector('button')
            : null;

        if (state.requiredFieldGuardRoot === root
            && state.requiredFieldGuardControl === descriptor.control
            && state.requiredFieldGuardSubmitHost === submitHost
            && state.requiredFieldGuardSubmitButton === submitButton) {
            return;
        }

        clearRequiredReportFieldGuard();

        const guard = (event) => {
            if (!state.settings.requireReportField) {
                return;
            }

            const keyActivation = event.type === 'keydown'
                && (event.key === 'Enter' || event.key === ' ' || event.code === 'Space');
            if (event.type !== 'submit'
                && event.type !== 'click'
                && !keyActivation) {
                return;
            }

            if (event.type !== 'submit'
                && !eventTargetsSubmit(event, submitHost, submitButton)) {
                return;
            }

            const current = findRequiredReportField(root);
            if (!current || requiredFieldIsFilled(current)) {
                if (current) {
                    setRequiredFieldInvalid(current, false);
                }
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            blockRequiredReportSubmit(root);
        };

        const nodes = [root, submitHost, submitButton].filter(Boolean);
        const eventTypes = ['click', 'submit', 'keydown'];
        nodes.forEach((node) => {
            eventTypes.forEach((type) => node.addEventListener(type, guard, true));
        });

        const inputNodes = [descriptor.control, descriptor.native].filter(Boolean);
        const clearInvalid = () => {
            const current = findRequiredReportField(root);
            if (current && requiredFieldIsFilled(current)) {
                setRequiredFieldInvalid(current, false);
            }
        };
        inputNodes.forEach((node) => {
            node.addEventListener('input', clearInvalid, true);
            node.addEventListener('change', clearInvalid, true);
        });

        state.requiredFieldGuardRoot = root;
        state.requiredFieldGuardControl = descriptor.control;
        state.requiredFieldGuardSubmitHost = submitHost;
        state.requiredFieldGuardSubmitButton = submitButton;
        state.requiredFieldGuardCleanup = () => {
            nodes.forEach((node) => {
                eventTypes.forEach((type) => node.removeEventListener(type, guard, true));
            });
            inputNodes.forEach((node) => {
                node.removeEventListener('input', clearInvalid, true);
                node.removeEventListener('change', clearInvalid, true);
            });
        };
    }

    function findCategoryDropdown(root) {
        return root.querySelector('static-dropdown');
    }

    function visible(element) {
        if (!element || element.nodeType !== 1) {
            return false;
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
    }

    function clickElement(element) {
        if (!element) {
            return;
        }

        try {
            element.focus();
        } catch (error) {
            // Not every custom option is focusable.
        }

        if (!invokeNativeClick(element)) {
            dispatchClick(element);
        }
    }

    function elementWindow(element) {
        return element
            && element.ownerDocument
            && element.ownerDocument.defaultView
            ? element.ownerDocument.defaultView
            : null;
    }

    function eventConstructor(element, name, fallback) {
        const view = elementWindow(element);
        return (view && typeof view[name] === 'function') ? view[name] : fallback;
    }

    function eventInit(element, init) {
        const view = elementWindow(element);
        return view ? { ...init, view } : init;
    }

    function invokeNativeClick(element) {
        if (!element) {
            return false;
        }

        const view = elementWindow(element);
        const prototype = view && view.HTMLElement && view.HTMLElement.prototype;
        if (prototype && typeof prototype.click === 'function') {
            try {
                prototype.click.call(element);
                return true;
            } catch (error) {
                // Fall through to the element wrapper below.
            }
        }

        if (typeof element.click === 'function') {
            try {
                element.click();
                return true;
            } catch (error) {
                // The dispatchClick fallback below still gives the component
                // a composed event to handle.
            }
        }

        return false;
    }

    function dispatchClick(element) {
        if (!element) {
            return;
        }

        const MouseEventConstructor = eventConstructor(element, 'MouseEvent', MouseEvent);
        element.dispatchEvent(new MouseEventConstructor('click', eventInit(element, {
            bubbles: true,
            cancelable: true,
            composed: true,
        })));
    }

    function dispatchPointerClick(element) {
        if (!element) {
            return;
        }

        const rect = element.getBoundingClientRect
            ? element.getBoundingClientRect()
            : { left: 0, top: 0, width: 0, height: 0 };
        const mouseInit = eventInit(element, {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            clientX: Math.round(rect.left + rect.width / 2),
            clientY: Math.round(rect.top + rect.height / 2),
        });

        dispatchPointerEvent(element, 'pointerdown', {
            ...mouseInit,
            isPrimary: true,
            pointerId: 1,
            pointerType: 'mouse',
        });
        const MouseEventConstructor = eventConstructor(element, 'MouseEvent', MouseEvent);
        element.dispatchEvent(new MouseEventConstructor('mousedown', mouseInit));

        dispatchPointerEvent(element, 'pointerup', {
            ...mouseInit,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            pointerType: 'mouse',
        });
        element.dispatchEvent(new MouseEventConstructor('mouseup', {
            ...mouseInit,
            buttons: 0,
        }));
        dispatchClick(element);
    }

    function dispatchPointerEvent(element, type, init) {
        const PointerEventConstructor = eventConstructor(
            element,
            'PointerEvent',
            typeof PointerEvent === 'function' ? PointerEvent : null,
        );
        if (typeof PointerEventConstructor !== 'function') {
            return;
        }

        try {
            element.dispatchEvent(new PointerEventConstructor(type, init));
        } catch (error) {
            // Mouse events below remain a compatible fallback in Edge builds
            // that expose PointerEvent but reject an isolated-world init.
        }
    }

    function dispatchKeyboardKey(element, key, code, keyCode) {
        if (!element) {
            return;
        }

        try {
            element.focus();
        } catch (error) {
            // Some custom options are not focusable in every browser build.
        }

        const KeyboardEventConstructor = eventConstructor(element, 'KeyboardEvent', KeyboardEvent);
        element.dispatchEvent(new KeyboardEventConstructor('keydown', {
            bubbles: true,
            cancelable: true,
            composed: true,
            code,
            key,
            keyCode,
            which: keyCode,
        }));
        element.dispatchEvent(new KeyboardEventConstructor('keyup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            code,
            key,
            keyCode,
            which: keyCode,
        }));
    }

    function dispatchEnterKey(element) {
        dispatchKeyboardKey(element, 'Enter', 'Enter', 13);
    }

    function dispatchEscapeKey(element) {
        dispatchKeyboardKey(element, 'Escape', 'Escape', 27);
    }

    function dropdownDisplayedText(dropdown) {
        const shadow = dropdown && dropdown.shadowRoot;
        if (!shadow) {
            return '';
        }
        const title = shadow.querySelector('.hc-static-dropdown__search-input-title');
        if (!title) {
            return '';
        }

        return normalized(title.textContent || title.getAttribute('title') || '');
    }

    function optionLabel(element) {
        if (!element) {
            return '';
        }

        return normalized(
            element.getAttribute('aria-label')
                || (element.querySelector && element.querySelector('.hc-static-dropdown__item-title')
                    ? element.querySelector('.hc-static-dropdown__item-title').textContent
                    : element.textContent),
        );
    }

    function categoryDefinition(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }

        const id = text(value.id || value.value || value.key);
        const title = text(value.title || value.label || value.name || value.text);
        return title ? { id, title } : null;
    }

    function categoryDefinitionArrays(value) {
        if (Array.isArray(value)) {
            return [value];
        }
        if (!value || typeof value !== 'object') {
            return [];
        }

        const arrays = [];
        ['options', 'items', 'values', 'categories', 'data'].forEach((property) => {
            if (Array.isArray(value[property])) {
                arrays.push(value[property]);
            }
        });
        return arrays;
    }

    function getDropdownOptionDefinitions(dropdown) {
        if (!dropdown) {
            return [];
        }

        const definitions = [];
        const seen = new Set();
        const addDefinitions = (value) => {
            categoryDefinitionArrays(value).forEach((entries) => {
                entries.forEach((entry) => {
                    const definition = categoryDefinition(entry);
                    if (!definition) {
                        return;
                    }
                    const key = `${normalized(definition.id)}|${normalized(definition.title)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        definitions.push(definition);
                    }
                });
            });
        };

        const scopes = [dropdown, dropdown.shadowRoot].filter((scope) => scope);
        scopes.forEach((scope) => {
            if (typeof scope.querySelectorAll === 'function') {
                scope.querySelectorAll('script[type="application/json"]').forEach((script) => {
                    try {
                        addDefinitions(JSON.parse(script.textContent || ''));
                    } catch (error) {
                        // Ignore unrelated JSON blobs inside the component.
                    }
                });
            }
        });

        ['options', 'items', 'values', 'categories'].forEach((property) => {
            try {
                addDefinitions(dropdown[property]);
            } catch (error) {
                // Ignore component properties that are not readable.
            }
        });

        return definitions;
    }

    function resolveCategoryTarget(dropdown, category, categoryId) {
        const fallback = {
            id: text(categoryId),
            title: text(category),
        };
        const expectedId = normalized(categoryId);
        const expectedCategory = normalized(category);
        const definition = getDropdownOptionDefinitions(dropdown).find((entry) => (
            (expectedId && normalized(entry.id) === expectedId)
                || (expectedCategory && normalized(entry.title) === expectedCategory)
        ));

        return definition || fallback;
    }

    function optionValueCandidates(element) {
        if (!element || typeof element.getAttribute !== 'function') {
            return [];
        }

        return [
            element.id,
            element.getAttribute('value'),
            element.getAttribute('data-value'),
            element.getAttribute('data-id'),
            element.getAttribute('data-option'),
            element.getAttribute('data-option-id'),
            element.getAttribute('data-key'),
            element.getAttribute('aria-valuenow'),
        ].map((value) => text(value)).filter((value) => value);
    }

    function optionMatches(element, desired, categoryId) {
        const expected = normalized(desired);
        if (!expected) {
            return false;
        }
        if (optionLabel(element) === expected) {
            return true;
        }

        const expectedId = normalized(categoryId);
        return !!expectedId && optionValueCandidates(element).some((value) => (
            normalized(value) === expectedId
        ));
    }

    function valueMatches(value, expected, depth = 0) {
        if (value === null || value === undefined || depth > 2) {
            return false;
        }

        if (typeof value === 'string' || typeof value === 'number') {
            return normalized(String(value)) === expected;
        }

        if (Array.isArray(value)) {
            // An options collection is not itself a selection. Only inspect
            // the component's explicit selected/value properties below.
            return false;
        }

        if (typeof value !== 'object') {
            return false;
        }

        return ['title', 'label', 'name', 'value', 'text', 'id'].some((property) => {
            try {
                return valueMatches(value[property], expected, depth + 1);
            } catch (error) {
                return false;
            }
        });
    }

    function dropdownValueMatches(dropdown, expected) {
        const expectedValues = (Array.isArray(expected) ? expected : [expected])
            .map((value) => normalized(value))
            .filter((value) => value);
        if (!expectedValues.length) {
            return false;
        }

        const properties = [
            'value',
            'selected',
            'selectedValue',
            'selectedOption',
            'selectedItem',
            'currentValue',
        ];
        const attributes = [
            'value',
            'selected',
            'data-value',
            'data-selected',
            'aria-valuetext',
        ];

        for (const property of properties) {
            try {
                if (expectedValues.some((value) => valueMatches(dropdown[property], value))) {
                    return true;
                }
            } catch (error) {
                // Ignore properties that are not exposed by this component.
            }
        }

        for (const attribute of attributes) {
            if (expectedValues.some((value) => valueMatches(dropdown.getAttribute(attribute), value))) {
                return true;
            }
        }

        return false;
    }

    function dropdownSelectionMatches(dropdown, desired, categoryId) {
        const expected = normalized(desired);
        const expectedId = normalized(categoryId);
        if (!dropdown) {
            return false;
        }

        if (dropdownDisplayedText(dropdown) === expected
            || dropdownValueMatches(dropdown, [expected, expectedId])) {
            return true;
        }

        const scopes = [];
        if (dropdown.shadowRoot) {
            scopes.push(dropdown.shadowRoot);
        }
        collectOpenShadowRoots(document).forEach((scope) => {
            if (!scopes.includes(scope)) {
                scopes.push(scope);
            }
        });

        const selectors = [
            '[role="option"][aria-selected="true"]',
            '[role="option"][data-selected="true"]',
            '[role="option"][aria-current="true"]',
            '[role="option"].selected',
        ];
        return scopes.some((scope) => selectors.some((selector) => (
            Array.from(scope.querySelectorAll(selector)).some((element) => (
                optionMatches(element, desired, categoryId)
            ))
        )));
    }

    function collectOpenShadowRoots(scope, roots = [], seen = new Set()) {
        if (!scope || seen.has(scope)) {
            return roots;
        }

        seen.add(scope);
        roots.push(scope);
        if (typeof scope.querySelectorAll !== 'function') {
            return roots;
        }

        scope.querySelectorAll('*').forEach((element) => {
            if (element.shadowRoot) {
                collectOpenShadowRoots(element.shadowRoot, roots, seen);
            }
        });

        return roots;
    }

    function findDropdownOption(dropdown, desired, categoryId) {
        const scopes = [];
        if (dropdown && dropdown.shadowRoot) {
            scopes.push(dropdown.shadowRoot);
        }
        collectOpenShadowRoots(document).forEach((scope) => {
            if (!scopes.includes(scope)) {
                scopes.push(scope);
            }
        });

        const selectors = [
            'li.hc-static-dropdown__popover-item',
            '[role="option"]',
            'li',
            'button',
            '[data-value]',
            '[data-option]',
            '[class*="option"]',
            '[class*="item"]',
        ];
        const candidates = [];
        const seen = new Set();

        scopes.forEach((scope) => {
            selectors.forEach((selector) => {
                scope.querySelectorAll(selector).forEach((element) => {
                    if (seen.has(element) || !visible(element)) {
                        return;
                    }
                    seen.add(element);
                    if (element.closest && element.closest(`#${HELPER_ID}`)) {
                        return;
                    }

                    if (optionMatches(element, desired, categoryId)) {
                        candidates.push(element);
                    }
                });
            });
        });

        return candidates.find((element) => element.getAttribute('role') === 'option')
            || candidates.find((element) => /option|item/i.test(
                typeof element.className === 'string' ? element.className : ''
            ))
            || candidates[0]
            || null;
    }

    function wait(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    function getDropdownTrigger(dropdown) {
        const shadow = dropdown && dropdown.shadowRoot;
        return (shadow && shadow.querySelector('[role="combobox"]')) || dropdown;
    }

    function getDropdownClickTargets(dropdown) {
        const shadow = dropdown && dropdown.shadowRoot;
        const trigger = getDropdownTrigger(dropdown);
        const targets = [
            trigger,
            shadow && shadow.querySelector('.hc-static-dropdown__search-input-title-container'),
            shadow && shadow.querySelector('.hc-static-dropdown__search-input-title'),
            dropdown,
        ];

        return targets.filter((target, index) => (
            target && targets.indexOf(target) === index
        ));
    }

    async function waitForDropdownOpen(dropdown, trigger, category, categoryId, timeout = 1000) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            if (trigger && trigger.getAttribute('aria-expanded') === 'true') {
                return true;
            }
            if (findDropdownOption(dropdown, category, categoryId)) {
                return true;
            }
            await wait(40);
        }
        return false;
    }

    async function ensureDropdownOpen(dropdown, trigger, category, categoryId) {
        if (trigger.getAttribute('aria-expanded') === 'true'
            || findDropdownOption(dropdown, category, categoryId)) {
            return true;
        }

        // The rendered control has a clickable title container inside the
        // ARIA combobox. Try both nodes because component versions differ in
        // which node owns the Lit event listener.
        for (const target of getDropdownClickTargets(dropdown)) {
            clickElement(target);
            if (await waitForDropdownOpen(dropdown, trigger, category, categoryId, 500)) {
                return true;
            }

            // Try an event constructed in the page realm. This is important
            // when the page listener checks event prototypes across the
            // Tampermonkey isolated-world boundary.
            dispatchClick(target);
            if (await waitForDropdownOpen(dropdown, trigger, category, categoryId, 500)) {
                return true;
            }

            // Last pointer/mouse fallback, followed by keyboard activation.
            dispatchPointerClick(target);
            if (await waitForDropdownOpen(dropdown, trigger, category, categoryId, 500)) {
                return true;
            }

            dispatchEnterKey(target);
            if (await waitForDropdownOpen(dropdown, trigger, category, categoryId, 500)) {
                return true;
            }
        }

        return false;
    }

    async function closeDropdownIfOpen(dropdown) {
        const trigger = getDropdownTrigger(dropdown);
        if (!trigger || trigger.getAttribute('aria-expanded') !== 'true') {
            return true;
        }

        dispatchEscapeKey(trigger);
        const closeStarted = Date.now();
        while (Date.now() - closeStarted < 400
            && trigger.getAttribute('aria-expanded') === 'true') {
            await wait(30);
        }

        if (trigger.getAttribute('aria-expanded') === 'true') {
            // A few component builds do not handle Escape but do toggle
            // closed when their native trigger is clicked.
            clickElement(trigger);
            const toggleStarted = Date.now();
            while (Date.now() - toggleStarted < 400
                && trigger.getAttribute('aria-expanded') === 'true') {
                await wait(30);
            }
        }

        return trigger.getAttribute('aria-expanded') !== 'true';
    }

    async function closeCurrentCategoryDropdown() {
        const form = getFormStage();
        const root = form.root || state.formRoot;
        const dropdown = root ? findCategoryDropdown(root) : null;
        return dropdown ? closeDropdownIfOpen(dropdown) : true;
    }

    async function waitForDropdownSelection(dropdown, category, categoryId, timeout = 900) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            if (dropdownSelectionMatches(dropdown, category, categoryId)) {
                await closeDropdownIfOpen(dropdown);
                return true;
            }
            await wait(40);
        }
        return false;
    }

    function activateDropdownOption(option, attempt) {
        const label = option.querySelector
            && option.querySelector('.hc-static-dropdown__item-title');
        const target = label || option;

        if (attempt === 0) {
            // The component normally handles a click on the option itself.
            clickElement(option);
            return;
        }

        if (attempt === 1) {
            // Some builds attach the listener to the visible title node.
            clickElement(target);
            return;
        }

        if (attempt === 2) {
            // Some builds use pointer/mouse handlers instead of a click
            // listener. Dispatch the full composed interaction sequence.
            dispatchPointerClick(target);
            return;
        }

        // Keyboard activation is the closest fallback to a real user
        // selection and also works for options with tabindex="0".
        dispatchEnterKey(option);
    }

    async function waitForDropdownOption(dropdown, category, categoryId, timeout = 5000) {
        const trigger = getDropdownTrigger(dropdown);
        const started = Date.now();

        for (let attempt = 0; attempt < 4 && Date.now() - started < timeout; attempt += 1) {
            if (dropdownSelectionMatches(dropdown, category, categoryId)) {
                return true;
            }

            if (!await ensureDropdownOpen(dropdown, trigger, category, categoryId)) {
                await wait(80);
                continue;
            }

            const option = findDropdownOption(dropdown, category, categoryId);
            if (!option) {
                await wait(80);
                attempt -= 1;
                continue;
            }

            activateDropdownOption(option, attempt);
            if (await waitForDropdownSelection(dropdown, category, categoryId)) {
                return true;
            }

            // A failed attempt may close the list without changing the
            // component value. The next iteration reopens it and finds a
            // fresh option node instead of reusing a stale one.
            await wait(80);
        }

        return dropdownSelectionMatches(dropdown, category, categoryId);
    }

    async function selectCategory(root, category, categoryId) {
        const dropdown = findCategoryDropdown(root);
        if (!dropdown) {
            return false;
        }

        let target = resolveCategoryTarget(dropdown, category, categoryId);
        if (dropdownSelectionMatches(dropdown, target.title, target.id)) {
            return true;
        }

        const shadow = dropdown.shadowRoot;
        const trigger = getDropdownTrigger(dropdown);
        if (!await ensureDropdownOpen(dropdown, trigger, target.title, target.id)) {
            return false;
        }

        // Some page builds attach the option data only once the picker has
        // opened. Resolve it again before typing or matching the option.
        target = resolveCategoryTarget(dropdown, category, categoryId);

        // Searchable versions of this control expose an input after opening.
        // Typing the exact category makes option lookup work even when the
        // dropdown renders a long list or a modal-style option picker.
        const searchInput = shadow && shadow.querySelector('input');
        if (searchInput) {
            setNativeValue(searchInput, target.title);
        }

        return await waitForDropdownOption(dropdown, target.title, target.id);
    }

    function applyPreset(preset) {
        // Selecting a preset and clicking the visible Apply button can happen
        // close together. Keep one run active so a stale second run cannot
        // reopen the category after the first run has finished.
        if (state.applyPromise) {
            return state.applyPromise;
        }

        const runId = state.applyRunId + 1;
        state.applyRunId = runId;
        state.applyPromise = applyPresetRun(preset)
            .catch(() => {
                setMessage('The preset could not be applied. Please review the fields manually.', 'error');
            })
            .finally(() => {
                if (state.applyRunId === runId) {
                    state.applyPromise = null;
                }
            });
        return state.applyPromise;
    }

    async function applyPresetRun(preset) {
        if (state.stage !== 'report' || !state.formRoot) {
            setMessage('The report form is not ready yet.', 'warning');
            return;
        }

        setMessage(`Applying “${preset.name}”…`, 'info');
        const categorySelected = await selectCategory(state.formRoot, preset.category, preset.categoryId);
        const details = findReportDetailsControl(state.formRoot);
        const detailsFilled = await fillCustomControl(details, preset.details);

        // Text input can cause the hosted form to render asynchronously. Keep
        // the operation alive briefly and close a newly-rendered dropdown as
        // well as the original one before declaring the preset complete.
        await closeCurrentCategoryDropdown();
        await wait(160);
        await closeCurrentCategoryDropdown();

        if (!categorySelected && !detailsFilled) {
            setMessage('Neither the category nor the abuse-report details could be filled. Please choose the category and enter the details manually.', 'warning');
            return;
        }

        if (!categorySelected) {
            setMessage('The abuse-report details were filled, but the category dropdown could not be selected. Choose the category manually and review the fields.', 'warning');
            return;
        }

        if (!detailsFilled) {
            setMessage('The category was selected, but the abuse-report details could not be filled. Enter the details manually and review the report.', 'warning');
            return;
        }

        setMessage(`Preset “${preset.name}” applied. Review the fields before submitting.`, 'success');
    }

    function scheduleEnhance() {
        if (state.enhanceTimer) {
            window.clearTimeout(state.enhanceTimer);
        }
        state.enhanceTimer = window.setTimeout(enhance, 60);
    }

    function enhance() {
        state.enhanceTimer = null;
        createHelper();
        const wasPlaced = state.helperPlaced;
        state.helperPlaced = placeHelperBeforeRelatedArticles();
        const placementChanged = state.helperPlaced !== wasPlaced;
        injectArticleReportButton();

        const form = getFormStage();
        const changed = form.stage !== state.stage || form.root !== state.formRoot;
        state.formHost = form.host;
        state.formRoot = form.root;

        if (form.root !== state.observedFormRoot) {
            if (state.formObserver) {
                state.formObserver.disconnect();
                state.formObserver = null;
            }
            state.observedFormRoot = form.root;
            if (form.root) {
                state.formObserver = new MutationObserver(scheduleEnhance);
                state.formObserver.observe(form.root, {
                    attributes: true,
                    childList: true,
                    subtree: true,
                });
            }
        }

        if (changed) {
            state.stage = form.stage;
            state.selectedPresetIndex = '';
            state.message = { text: '', tone: 'info' };
            state.helperExpanded = form.stage === 'profile' || form.stage === 'report';
        }

        if (state.stage === 'report') {
            configureRequiredReportField(state.formRoot);
        } else {
            configureRequiredReportField(null);
        }

        if (changed || placementChanged) {
            renderHelperContent();
        }

        if (state.stage === 'profile') {
            // Apply privacy styling before any automatic value assignment so
            // the browser never paints the saved email unblurred first.
            applyPrivacySettings(state.formRoot);
            if (state.profileLoaded) {
                fillProfileFields(state.formRoot);
            }
            applyPrivacySettings(state.formRoot);
        }
    }

    function start() {
        state.readyPromise = loadStoredState()
            .catch(() => {
                state.profileLoaded = true;
                state.presetsLoaded = true;
                state.settingsLoaded = true;
            })
            .finally(() => {
                renderHelperContent();
                enhance();
            });

        createHelper();
        renderHelperContent();

        const observer = new MutationObserver(scheduleEnhance);
        observer.observe(document.body, { childList: true, subtree: true });
        state.pollTimer = window.setInterval(enhance, 500);
        window.addEventListener('pagehide', () => {
            if (state.pollTimer) {
                window.clearInterval(state.pollTimer);
                state.pollTimer = null;
            }
            if (state.formObserver) {
                state.formObserver.disconnect();
                state.formObserver = null;
            }
            clearRequiredReportFieldGuard();
        }, { once: true });
        scheduleEnhance();
    }

    start();
})();
