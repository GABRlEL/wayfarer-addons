'use strict';

const PENDING_TTL_MS = 2 * 60 * 1000;
const pendingImageUrls = new Map();

function normalizeUrl(value) {
    if (typeof value !== 'string' || !value) return null;

    try {
        return new URL(value).href;
    } catch (_) {
        return null;
    }
}

function isWayfarerReferrer(value) {
    const url = normalizeUrl(value);
    if (!url) return false;

    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname.toLowerCase() !== 'wayfarer.nianticlabs.com') return false;

    // The root path is included because strict-origin referrer policies can
    // reduce a cross-origin referrer to just https://wayfarer.nianticlabs.com/.
    return parsed.pathname === '/'
        || parsed.pathname === '/new'
        || parsed.pathname.startsWith('/new/');
}

function isGoogleusercontentUrl(value) {
    const url = normalizeUrl(value);
    if (!url) return false;

    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'googleusercontent.com'
        || hostname.endsWith('.googleusercontent.com');
}

function purgeExpiredPendingUrls(now = Date.now()) {
    for (const [url, expiresAt] of pendingImageUrls) {
        if (expiresAt <= now) pendingImageUrls.delete(url);
    }
}

function rememberImageUrl(value) {
    const url = normalizeUrl(value);
    if (!url || !/^https?:$/.test(new URL(url).protocol)) return;

    purgeExpiredPendingUrls();
    pendingImageUrls.set(url, Date.now() + PENDING_TTL_MS);
}

function consumePendingMatch(candidates) {
    const now = Date.now();
    purgeExpiredPendingUrls(now);

    for (const candidate of candidates) {
        const url = normalizeUrl(candidate);
        if (!url || !pendingImageUrls.has(url)) continue;

        pendingImageUrls.delete(url);
        return true;
    }

    return false;
}

function isImageDownload(item, candidates) {
    const mime = String(item.mime || '').toLowerCase();
    if (mime) return mime.startsWith('image/');
    return candidates.some(isGoogleusercontentUrl);
}

function imageExtension(item, candidates) {
    const mime = String(item.mime || '').toLowerCase().split(';', 1)[0];
    const byMime = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
    };

    if (byMime[mime]) return byMime[mime];

    for (const candidate of candidates) {
        const url = normalizeUrl(candidate);
        if (!url) continue;

        const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
        if (!match) continue;

        const extension = match[1].toLowerCase();
        if (extension === 'jpeg') return 'jpg';
        if (['jpg', 'png', 'webp', 'gif', 'avif'].includes(extension)) {
            return extension;
        }
    }

    return 'jpg';
}

function localTimestamp(date = new Date()) {
    const pad = (value, length) => String(value).padStart(length, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1, 2),
        pad(date.getDate(), 2),
    ].join('-') + 'T' + [
        pad(date.getHours(), 2),
        pad(date.getMinutes(), 2),
        pad(date.getSeconds(), 2),
    ].join('') + '.' + pad(date.getMilliseconds(), 3);
}

function shouldRename(item) {
    const candidates = [item.url, item.finalUrl].filter(Boolean);
    const wasRightClickedOnWayfarer = consumePendingMatch(candidates);

    if (wasRightClickedOnWayfarer) {
        return isImageDownload(item, candidates);
    }

    return isWayfarerReferrer(item.referrer)
        && isImageDownload(item, candidates)
        && candidates.some(isGoogleusercontentUrl);
}

chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'wayfarer-image-context') return;
    rememberImageUrl(message.url);
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const candidates = [item.url, item.finalUrl].filter(Boolean);

    if (!shouldRename(item)) {
        suggest();
        return;
    }

    const extension = imageExtension(item, candidates);
    suggest({
        filename: `unnamed - ${localTimestamp()}.${extension}`,
        conflictAction: 'uniquify',
    });
});
