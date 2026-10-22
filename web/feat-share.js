// ============================================================
// Family Tree Builder - read-only link + kiosk view
// ============================================================
// The link lives on the local network only: the server hands out a
// token, sets a cookie when the link is opened, and refuses every
// write while that cookie is present. This module only has to make
// the UI agree with that: hide the write controls, and offer a
// full-screen view for a tablet or TV.
// ============================================================

(function () {
    'use strict';

    const SHARE_ENDPOINT = '/api/share';
    const SHARE_COOKIE = 'ft_share';

    let shareState = null;  // last known {enabled, token, url}
    let renderSeq = 0;      // guards against out-of-order renders

    // ---------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------

    function el(id) {
        return document.getElementById(id);
    }

    function param(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    }

    function hasShareCookie() {
        return (document.cookie || '').split(';').some(function (part) {
            return part.trim().indexOf(SHARE_COOKIE + '=') === 0;
        });
    }

    // The server only sets the cookie for a valid ?share= token, but the
    // cookie outlives the query string, so both are checked.
    function isReadOnlyRequest() {
        return !!param('share') || hasShareCookie();
    }

    function isKioskRequest() {
        return param('kiosk') === '1';
    }

    // ---------------------------------------------------------
    // Settings panel: read-only link
    // ---------------------------------------------------------

    const SHARE_NOTES = `
        <p class="settings-note">Anyone on your network with this link can view the tree but cannot change it. The link stops working when you stop sharing.</p>
        <p class="settings-note">The link only works on the network this app is running on.</p>
        <p class="settings-note">Open <code>&lt;app-url&gt;/?kiosk=1</code> to show the tree full screen.</p>`;

    function shareToolsMarkup(state) {
        const on = !!(state && state.enabled);

        if (!on) {
            return `
                <div class="ft-share">
                    <p class="ft-share-status"><span class="ft-share-dot" aria-hidden="true"></span> Sharing is off</p>
                    <button type="button" class="btn-primary" onclick="createShareLink()">
                        <svg class="icon" aria-hidden="true"><use href="#i-share"/></svg> Create link
                    </button>
                    ${SHARE_NOTES}
                </div>`;
        }

        const url = escapeAttr(state.url || '');
        return `
            <div class="ft-share">
                <p class="ft-share-status"><span class="ft-share-dot on" aria-hidden="true"></span> Sharing is on</p>
                <label class="field-label" for="ftShareUrl">Read-only link</label>
                <input type="text" id="ftShareUrl" class="ft-share-url" value="${url}" readonly
                       onfocus="this.select()">
                <div class="ft-share-actions">
                    <button type="button" class="btn-secondary" onclick="copyLink()">
                        <svg class="icon" aria-hidden="true"><use href="#i-link"/></svg> Copy link
                    </button>
                    <button type="button" class="btn-danger" onclick="stopSharing()">
                        <svg class="icon" aria-hidden="true"><use href="#i-close"/></svg> Stop sharing
                    </button>
                </div>
                ${SHARE_NOTES}
            </div>`;
    }

    function loadingMarkup() {
        return `
            <div class="ft-share">
                <p class="ft-share-status ft-share-muted" role="status">Checking the sharing status…</p>
            </div>`;
    }

    function errorMarkup(message) {
        return `
            <div class="ft-share">
                <p class="ft-share-status ft-share-muted">Sharing status unavailable</p>
                <p class="ft-share-error" role="alert">${escapeHtml(message || 'The server did not answer.')}</p>
                <button type="button" class="btn-secondary" onclick="renderShareTools()">
                    <svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg> Try again
                </button>
            </div>`;
    }

    // Renders the settings section. Called on load and whenever the
    // settings dialog opens, so the state is never stale.
    function renderShareTools() {
        const host = el('shareTools');
        if (!host) return;

        const seq = ++renderSeq;
        host.innerHTML = loadingMarkup();

        fetch(SHARE_ENDPOINT)
            .then(function (res) {
                if (!res.ok) throw new Error((res.statusText || 'Request failed').trim());
                return res.json();
            })
            .then(function (data) {
                if (seq !== renderSeq) return;
                shareState = data || null;
                host.innerHTML = shareToolsMarkup(shareState);
            })
            .catch(function (err) {
                if (seq !== renderSeq) return;
                host.innerHTML = errorMarkup(err && err.message ? err.message : '');
            });
    }

    async function createShareLink() {
        try {
            const res = await fetch(SHARE_ENDPOINT, { method: 'POST' });
            if (!res.ok) throw new Error((await res.text()) || 'The server refused the request.');
            shareState = await res.json();
            renderShareTools();
            showToast('Read-only link created');
        } catch (err) {
            showToast('Could not create the link: ' + (err.message || 'unknown error'), true);
            renderShareTools();
        }
    }

    async function stopSharing() {
        const ok = await showConfirm({
            title: 'Stop sharing?',
            message: 'The read-only link stops working straight away. Anyone still holding it will no longer see the tree.',
            confirmLabel: 'Stop sharing',
            danger: true
        });
        if (!ok) return;

        try {
            const res = await fetch(SHARE_ENDPOINT, { method: 'DELETE' });
            if (!res.ok && res.status !== 204) throw new Error((await res.text()) || 'The server refused the request.');
            shareState = null;
            renderShareTools();
            showToast('Sharing stopped');
        } catch (err) {
            showToast('Could not stop sharing: ' + (err.message || 'unknown error'), true);
        }
    }

    function copyLink() {
        const input = el('ftShareUrl');
        const url = (input && input.value) || (shareState && shareState.url) || '';
        if (!url) return showToast('There is no link to copy', true);

        copyText(url).then(function (done) {
            showToast(done ? 'Link copied' : 'Could not copy the link — select it and copy it by hand', !done);
        });
    }

    // Clipboard API first, hidden textarea as the fallback for browsers
    // that refuse clipboard access outside a secure context.
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text)
                .then(function () { return true; })
                .catch(function () { return legacyCopy(text); });
        }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        try {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '-1000px';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const done = document.execCommand('copy');
            document.body.removeChild(area);
            return done;
        } catch (err) {
            return false;
        }
    }

    // ---------------------------------------------------------
    // Read-only mode
    // ---------------------------------------------------------

    function showReadOnlyBanner() {
        if (el('ftReadOnlyBanner')) return;

        const banner = document.createElement('div');
        banner.id = 'ftReadOnlyBanner';
        banner.className = 'ft-ro-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML =
            '<svg class="icon" aria-hidden="true"><use href="#i-lock"/></svg>' +
            '<span>Read-only view — you are looking at someone else’s family tree.</span>';

        const header = document.querySelector('.app-header');
        const brand = header ? header.querySelector('.brand') : null;
        if (header) {
            header.insertBefore(banner, brand ? brand.nextSibling : header.firstChild);
        } else {
            banner.classList.add('ft-ro-banner-floating');
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }

    // Puts the page into read-only mode: the write controls are hidden by
    // CSS (body.ft-readonly) and a quiet banner explains why.
    function applyShareMode() {
        if (!isReadOnlyRequest()) return false;
        document.body.classList.add('ft-readonly');
        if (!isKioskRequest()) showReadOnlyBanner();
        return true;
    }

    // ---------------------------------------------------------
    // Kiosk mode
    // ---------------------------------------------------------

    function fitTreeToScreen() {
        if (typeof centerTree === 'function') {
            try { centerTree(); } catch (err) { /* the tree is not ready yet */ }
        }
    }

    // The tree is drawn after the first load, so fit again whenever nodes
    // are (re)drawn.
    function watchTreeForFit() {
        const nodes = el('treeNodes');
        if (!nodes || typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(function () { fitTreeToScreen(); });
        observer.observe(nodes, { childList: true });
    }

    function applyKioskMode() {
        if (!isKioskRequest()) return false;
        document.body.classList.add('ft-kiosk');
        addKioskExitButton();
        fitTreeToScreen();
        watchTreeForFit();
        return true;
    }

    // A TV has no keyboard, so there is a button as well as the Escape key.
    function addKioskExitButton() {
        if (el('ftKioskExit')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ftKioskExit';
        btn.className = 'ft-kiosk-exit';
        btn.setAttribute('aria-label', 'Leave full screen');
        btn.title = 'Leave full screen (Esc)';
        btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
        btn.addEventListener('click', exitKiosk);
        document.body.appendChild(btn);
    }

    function exitKiosk() {
        document.body.classList.remove('ft-kiosk');
        const exitBtn = el('ftKioskExit');
        if (exitBtn) exitBtn.remove();

        const url = new URL(window.location.href);
        url.searchParams.delete('kiosk');
        try {
            window.history.replaceState({}, '', url.toString());
        } catch (err) {
            /* history is unavailable in some embedded browsers */
        }

        // The chrome takes its space back, so fit the tree again.
        setTimeout(fitTreeToScreen, 60);
    }

    function onKeyDown(e) {
        if (e.key !== 'Escape') return;
        if (!document.body.classList.contains('ft-kiosk')) return;
        if (document.querySelector('dialog[open]')) return; // let dialogs close themselves
        exitKiosk();
    }

    // ---------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------

    function init() {
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', function () {
            if (document.body.classList.contains('ft-kiosk')) fitTreeToScreen();
        });

        applyShareMode();
        applyKioskMode();

        renderShareTools();

        // Re-read the state every time the settings dialog opens.
        const dialog = el('settingsDialog');
        if (dialog && typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver(function () {
                if (dialog.open) renderShareTools();
            });
            observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
        }
    }

    window.renderShareTools = renderShareTools;
    window.applyShareMode = applyShareMode;
    window.createShareLink = createShareLink;
    window.stopSharing = stopSharing;
    window.copyLink = copyLink;
    window.applyKioskMode = applyKioskMode;
    window.exitKiosk = exitKiosk;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
