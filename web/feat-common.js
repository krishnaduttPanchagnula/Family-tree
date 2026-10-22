// Shared helpers for the v0.4 feature modules.
//
// The modules are plain scripts, so this file gives them the handful of
// helpers they all need: a safe escape, one fetch wrapper, a dialog builder
// and a way to add a section to the person panel.

(function () {
    'use strict';

    var FT = {};

    // --- text and data ---

    FT.esc = function (value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    FT.api = async function (path, options) {
        var res = await fetch(path, options || {});
        if (!res.ok) {
            var message = '';
            try { message = await res.text(); } catch (err) { /* the body is optional */ }
            throw new Error(message || res.statusText);
        }
        if (res.status === 204) return null;
        return res.json().catch(function () { return null; });
    };

    FT.json = function (path, method, body) {
        return FT.api(path, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
    };

    FT.people = function () {
        return (typeof currentPersons !== 'undefined' && currentPersons) ? currentPersons : [];
    };

    FT.relations = function () {
        return (typeof currentRelationships !== 'undefined' && currentRelationships) ? currentRelationships : [];
    };

    FT.selectedId = function () {
        return (typeof selectedNodeId !== 'undefined') ? selectedNodeId : null;
    };

    FT.readOnly = function () {
        return typeof isReadOnlyView === 'function' && isReadOnlyView();
    };

    FT.reload = async function () {
        if (typeof loadTree === 'function') await loadTree();
        if (typeof render === 'function') render();
    };

    FT.toast = function (message, isError) {
        if (typeof showToast === 'function') showToast(message, isError);
    };

    FT.confirm = function (options) {
        if (typeof showConfirm !== 'function') return Promise.resolve(false);
        return showConfirm(options);
    };

    // --- dialogs ---

    FT.ensureStylesheet = function (href) {
        if (document.querySelector('link[href="' + href + '"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    };

    // FT.dialog builds a dialog with a body and an action bar. The caller
    // fills both in.
    FT.dialog = function (options) {
        var id = options.id;
        var existing = document.getElementById(id);
        if (existing) return existing;

        var host = document.createElement('div');
        host.innerHTML =
            '<dialog id="' + id + '" class="' + (options.className || '') + '" aria-labelledby="' + id + 'Heading">' +
            '  <form method="dialog" class="dialog-form">' +
            '    <h3 id="' + id + 'Heading">' + FT.esc(options.title) + '</h3>' +
            (options.copy ? '    <p class="dialog-copy">' + FT.esc(options.copy) + '</p>' : '') +
            '    <div id="' + id + 'Body"></div>' +
            '    <div id="' + id + 'Actions" class="dialog-actions"></div>' +
            '  </form>' +
            '</dialog>';
        document.body.appendChild(host.firstChild);
        return document.getElementById(id);
    };

    FT.body = function (dialog) {
        return document.getElementById(dialog.id + 'Body');
    };

    FT.action = function (dialog, label, className, onClick) {
        var actions = document.getElementById(dialog.id + 'Actions');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = className || 'btn-secondary';
        button.textContent = label;
        button.addEventListener('click', onClick);
        actions.appendChild(button);
        return button;
    };

    // FT.resetActions clears the action bar, so a dialog that is opened
    // again does not collect a second set of buttons.
    FT.resetActions = function (dialog) {
        var actions = document.getElementById(dialog.id + 'Actions');
        if (actions) actions.innerHTML = '';
        return actions;
    };

    FT.open = function (dialog) {
        if (dialog && !dialog.open) dialog.showModal();
    };

    FT.close = function (dialog) {
        if (dialog && dialog.open) dialog.close();
    };

    // --- the person panel ---

    // FT.addTab gives a module its own tab in the person panel and returns
    // the panel element to fill.
    FT.addTab = function (id, label) {
        var bar = document.querySelector('.sidebar-tabs');
        var host = document.getElementById('sidebarContent');
        if (!bar || !host) return null;

        var button = bar.querySelector('.tab-btn[data-tab="' + id + '"]');
        if (!button) {
            button = document.createElement('button');
            button.className = 'tab-btn';
            button.dataset.tab = id;
            button.setAttribute('role', 'tab');
            button.textContent = label;
            button.addEventListener('click', function () {
                if (typeof switchTab === 'function') switchTab(id);
            });
            bar.appendChild(button);
        }

        var panel = host.querySelector('.tab-panel[data-panel="' + id + '"]');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'tab-panel';
            panel.dataset.panel = id;
            panel.style.display = 'none';
            host.appendChild(panel);
        }
        return panel;
    };

    // FT.onPanel registers a renderer for the person panel. It runs every
    // time a person is selected.
    FT.panels = [];
    FT.onPanel = function (fn) {
        FT.panels.push(fn);
    };

    window.onPersonPanelRendered = function (person) {
        FT.panels.forEach(function (fn) {
            try {
                fn(person);
            } catch (err) {
                console.error('a person panel section failed', err);
            }
        });
    };

    // --- the tools launcher ---

    FT.registerTool = function (tool) {
        if (window.FamilyTools && typeof window.FamilyTools.register === 'function') {
            window.FamilyTools.register(tool);
        }
    };

    window.FT = FT;
})();
