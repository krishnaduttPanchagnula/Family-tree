// Feature module: start fresh.
//
// A local-first app should let you leave cleanly: one action writes a full
// backup, then empties the tree.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    function countsMarkup(persons, events) {
        var count = (list) => (list || []).length;
        return '<div class="ft-health-tiles">' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + count(persons) + '</span>' +
            '<span class="ft-health-label">people</span></div>' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + count(events) + '</span>' +
            '<span class="ft-health-label">events</span></div>' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + count(FT.relations()) + '</span>' +
            '<span class="ft-health-label">connections</span></div>' +
            '</div>';
    }

    async function render() {
        var body = FT.body(dialog);
        body.innerHTML = '<p class="ft-panel-empty">Looking through the tree…</p>';
        var persons = [];
        var events = [];
        try {
            persons = (await FT.api('/api/persons')) || [];
            events = (await FT.api('/api/events')) || [];
        } catch (err) {
            body.innerHTML = '<p class="ft-panel-error" role="alert">Could not read the tree: ' + FT.esc(err.message) + '</p>';
            return;
        }

        body.innerHTML =
            countsMarkup(persons, events) +
            '<p class="ft-wipe-copy">This empties the tree on this machine: the people, their connections, their ' +
            'events and their sources. A snapshot is written first, so you can restore it from Settings → Snapshots ' +
            'later.</p>' +
            '<p class="ft-wipe-copy"><a href="/api/backup/archive" class="ft-source-link">Download a full backup first</a></p>' +
            '<label class="ft-wipe-check"><input type="checkbox" id="ftWipePhotos"> Also delete the photos in the uploads folder</label>' +
            '<label class="field-label" for="ftWipeConfirm">Type <strong>DELETE</strong> to confirm</label>' +
            '<input type="text" id="ftWipeConfirm" autocomplete="off" placeholder="DELETE">';
    }

    async function wipe() {
        var confirmation = document.getElementById('ftWipeConfirm');
        if (!confirmation || confirmation.value.trim() !== 'DELETE') {
            FT.toast('Type DELETE to confirm', true);
            return;
        }
        var photos = document.getElementById('ftWipePhotos');
        var ok = await FT.confirm({
            title: 'Empty the tree?',
            message: 'Everything is removed from this machine. The snapshot that was just written can restore it.',
            confirmLabel: 'Empty the tree'
        });
        if (!ok) return;

        try {
            var result = await FT.json('/api/wipe', 'POST', {
                confirm: 'DELETE',
                delete_photos: !!(photos && photos.checked)
            });
            FT.close(dialog);
            await FT.reload();
            FT.toast('The tree is empty. A snapshot was saved as ' + (result && result.snapshot ? result.snapshot : 'a snapshot') +
                '. Restore it from Settings → Snapshots.');
        } catch (err) {
            FT.toast('Could not empty the tree: ' + err.message, true);
        }
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftWipeDialog',
            className: 'ft-wipe-dialog',
            title: 'Start fresh',
            copy: 'Empty the tree and keep a snapshot of it.'
        });
        if (!dialog) return;
        FT.resetActions(dialog);
        FT.action(dialog, 'Cancel', 'btn-secondary', function () { FT.close(dialog); });
        FT.action(dialog, 'Empty the tree', 'btn-danger', wipe);
        FT.open(dialog);
        render();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-export-wipe.css');
        dialog = FT.dialog({
            id: 'ftWipeDialog',
            className: 'ft-wipe-dialog',
            title: 'Start fresh',
            copy: 'Empty the tree and keep a snapshot of it.'
        });
        if (!dialog) return;

        FT.registerTool({
            id: 'export-wipe',
            title: 'Start fresh',
            description: 'Write a backup, then empty the tree.',
            icon: 'i-trash',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
