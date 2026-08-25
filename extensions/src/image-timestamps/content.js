'use strict';

(function () {
    function isWayfarerNewRoute() {
        return location.protocol === 'https:'
            && location.hostname === 'wayfarer.scopely.com'
            && (location.pathname === '/new' || location.pathname.startsWith('/new/'));
    }

    function imageUrl(image) {
        return image.currentSrc || image.src || '';
    }

    document.addEventListener('contextmenu', (event) => {
        if (!isWayfarerNewRoute()) return;

        const target = event.target;
        const image = target instanceof Element ? target.closest('img') : null;
        if (!image) return;

        const url = imageUrl(image);
        if (!/^https?:\/\//i.test(url)) return;

        // This only marks the image for the background download listener. It
        // does not cancel or replace Edge's native context menu.
        chrome.runtime.sendMessage({
            type: 'wayfarer-image-context',
            url,
        });
    }, true);
})();
