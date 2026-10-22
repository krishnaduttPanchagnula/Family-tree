// Feature module: the Tools launcher.
//
// v0.4 adds a set of tools that each deserve their own dialog but not their
// own button on the rail. Each module registers itself here; the rail keeps a
// single "Tools" entry point and this dialog is the index.
(function () {
    'use strict';

    var tools = [];

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function mount() {
        var rail = document.querySelector('.tool-rail');
        if (rail && !document.getElementById('ftToolsBtn')) {
            var button = document.createElement('button');
            button.id = 'ftToolsBtn';
            button.type = 'button';
            button.className = 'rail-btn';
            button.title = 'More tools';
            button.setAttribute('aria-label', 'More tools');
            button.setAttribute('aria-haspopup', 'dialog');
            button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-tools"/></svg>';
            button.addEventListener('click', openToolsDialog);
            var spacer = rail.querySelector('.rail-spacer');
            if (spacer) rail.insertBefore(button, spacer);
            else rail.appendChild(button);
        }

        if (!document.getElementById('ftToolsDialog')) {
            var host = document.createElement('div');
            host.innerHTML =
                '<dialog id="ftToolsDialog" class="ft-tools-dialog" aria-labelledby="ftToolsHeading">' +
                '  <form method="dialog" class="dialog-form">' +
                '    <h3 id="ftToolsHeading">Tools</h3>' +
                '    <p class="dialog-copy">Everything the tree can do beyond drawing it. Each tool works on this machine only.</p>' +
                '    <div id="ftToolsGrid" class="ft-tools-grid"></div>' +
                '    <div class="dialog-actions">' +
                '      <button type="button" class="btn-secondary" onclick="closeToolsDialog()">Close</button>' +
                '    </div>' +
                '  </form>' +
                '</dialog>';
            document.body.appendChild(host.firstChild);
        }

        render();
    }

    function render() {
        var grid = document.getElementById('ftToolsGrid');
        if (!grid) return;
        if (!tools.length) {
            grid.innerHTML = '<p class="ft-tools-empty">No tools loaded.</p>';
            return;
        }
        grid.innerHTML = tools.map(function (tool) {
            return '' +
                '<button type="button" class="ft-tool-card" data-tool="' + esc(tool.id) + '">' +
                '  <span class="ft-tool-icon"><svg class="icon" aria-hidden="true"><use href="#' + esc(tool.icon || 'i-sparkle') + '"/></svg></span>' +
                '  <span class="ft-tool-text">' +
                '    <span class="ft-tool-title">' + esc(tool.title) + '</span>' +
                '    <span class="ft-tool-desc">' + esc(tool.description || '') + '</span>' +
                '  </span>' +
                '</button>';
        }).join('');

        grid.querySelectorAll('.ft-tool-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var tool = tools.find(function (entry) { return entry.id === card.dataset.tool; });
                if (!tool || typeof tool.open !== 'function') return;
                closeToolsDialog();
                // Let the launcher finish closing before the tool grabs focus,
                // otherwise the closing modal sends focus back to the rail.
                setTimeout(function () { tool.open(); }, 0);
            });
        });
    }

    function openToolsDialog() {
        render();
        var dialog = document.getElementById('ftToolsDialog');
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();
        var first = dialog.querySelector('.ft-tool-card');
        if (first) first.focus();
    }

    function closeToolsDialog() {
        var dialog = document.getElementById('ftToolsDialog');
        if (dialog && dialog.open) dialog.close();
    }

    // Modules call this as they load. Registering twice with the same id keeps
    // the first entry, so a double script include cannot duplicate a card.
    function register(tool) {
        if (!tool || !tool.id) return;
        if (tools.some(function (entry) { return entry.id === tool.id; })) return;
        tools.push(tool);
        tools.sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
        render();
    }

    window.FamilyTools = { register: register, open: openToolsDialog, list: function () { return tools.slice(); } };
    window.openToolsDialog = openToolsDialog;
    window.closeToolsDialog = closeToolsDialog;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
