// Feature module: the photo manager.
//
// Every photo the app has ever received sits in the uploads folder, and
// nothing ever removed one. This shows what is there, who uses it, and what
// nobody uses.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    function size(bytes) {
        if (!bytes) return '0 KB';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function card(photo) {
        var used = photo.used_by.map(function (user) {
            return '<button type="button" class="ft-find-person" data-person="' + user.person_id + '">' +
                FT.esc(user.name) + '</button>';
        }).join('');

        var media = (photo.event_media || []).map(function (item) {
            return '<span class="ft-photo-use">on a life event</span>';
        }).join('');

        var remove = FT.readOnly() ? '' :
            '<button type="button" class="ft-link-btn ft-danger-link" data-action="delete-photo" data-file="' +
            FT.esc(photo.file) + '">Delete</button>';

        return '<li class="ft-photo-card' + (photo.orphan ? ' is-orphan' : '') + '">' +
            '<a class="ft-photo-thumb" href="' + FT.esc(photo.url) + '" target="_blank" rel="noopener noreferrer">' +
            '  <img src="' + FT.esc(photo.url) + '" alt="" loading="lazy">' +
            '</a>' +
            '<div class="ft-photo-meta">' +
            '  <span class="ft-photo-name" title="' + FT.esc(photo.file) + '">' + FT.esc(photo.file) + '</span>' +
            '  <span class="ft-photo-size">' + FT.esc(size(photo.size)) + '</span>' +
            (photo.orphan ? '<span class="ft-photo-orphan">not used by anyone</span>' : '') +
            '  <span class="ft-photo-users">' + used + media + '</span>' +
            '  ' + remove +
            '</div>' +
            '</li>';
    }

    function render(report) {
        var body = FT.body(dialog);
        var totals = report.totals || {};
        var photos = report.photos || [];

        if (!photos.length) {
            body.innerHTML = '<p class="ft-panel-empty">No files in the uploads folder yet. Photos you add to people ' +
                'or to life events end up here.</p>';
            return;
        }

        var deleteUnused = FT.readOnly() || !totals.orphans ? '' :
            '<button type="button" class="btn-outline full" data-action="delete-orphans">Delete the ' +
            totals.orphans + ' unused file(s) — ' + FT.esc(size(totals.orphan_bytes)) + '</button>';

        body.innerHTML =
            '<p class="ft-photo-summary">' + photos.length + ' file(s) · ' + FT.esc(size(totals.bytes)) +
            ' · ' + (totals.orphans || 0) + ' not used by anyone</p>' +
            '<ul class="ft-photo-grid">' + photos.map(card).join('') + '</ul>' +
            deleteUnused;
    }

    async function load() {
        var body = FT.body(dialog);
        body.innerHTML = '<p class="ft-panel-empty">Looking through the uploads folder…</p>';
        try {
            var report = await FT.api('/api/photos');
            render(report);
        } catch (err) {
            body.innerHTML = '<p class="ft-panel-error" role="alert">Could not read the photos: ' + FT.esc(err.message) + '</p>';
        }
    }

    async function remove(file, force) {
        var ok = await FT.confirm({
            title: 'Delete this photo?',
            message: force ?
                'The people using it will lose their photo, and the file is deleted from this machine. The backup keeps a copy.' :
                'The file is deleted from this machine. The backup keeps a copy.',
            confirmLabel: 'Delete the photo'
        });
        if (!ok) return;
        try {
            await FT.json('/api/photos?file=' + encodeURIComponent(file) + (force ? '&force=1' : ''), 'DELETE');
            FT.toast('Photo deleted');
            await load();
            await FT.reload();
        } catch (err) {
            if (String(err.message).indexOf('used by') >= 0) {
                var again = await FT.confirm({
                    title: 'This photo is in use',
                    message: err.message + ' Remove it from them as well?',
                    confirmLabel: 'Remove it everywhere'
                });
                if (again) await remove(file, true);
                return;
            }
            FT.toast('Could not delete the photo: ' + err.message, true);
        }
    }

    async function removeOrphans() {
        var ok = await FT.confirm({
            title: 'Delete every unused photo?',
            message: 'The files nobody uses are deleted from this machine. The backup keeps a copy.',
            confirmLabel: 'Delete the unused files'
        });
        if (!ok) return;
        try {
            var report = await FT.api('/api/photos');
            var orphans = (report.photos || []).filter(function (photo) { return photo.orphan; });
            for (var i = 0; i < orphans.length; i++) {
                await FT.json('/api/photos?file=' + encodeURIComponent(orphans[i].file), 'DELETE');
            }
            FT.toast('Removed ' + orphans.length + ' unused file(s)');
            await load();
        } catch (err) {
            FT.toast('Could not delete the unused files: ' + err.message, true);
        }
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftPhotosDialog',
            className: 'ft-photos-dialog',
            title: 'Photos',
            copy: 'Every file in the uploads folder, and who uses it.'
        });
        if (!dialog) return;
        FT.resetActions(dialog);
        FT.action(dialog, 'Refresh', 'btn-secondary', load);
        FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
        FT.open(dialog);
        load();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-photo-manager.css');
        dialog = FT.dialog({
            id: 'ftPhotosDialog',
            className: 'ft-photos-dialog',
            title: 'Photos',
            copy: 'Every file in the uploads folder, and who uses it.'
        });
        if (!dialog) return;

        var body = FT.body(dialog);
        body.addEventListener('click', function (event) {
            var person = event.target.closest('[data-person]');
            if (person) {
                FT.close(dialog);
                if (typeof jumpToPerson === 'function') jumpToPerson(Number(person.dataset.person));
                return;
            }
            var button = event.target.closest('[data-action]');
            if (!button) return;
            if (button.dataset.action === 'delete-photo') remove(button.dataset.file, false);
            if (button.dataset.action === 'delete-orphans') removeOrphans();
        });

        FT.registerTool({
            id: 'photo-manager',
            title: 'Photos',
            description: 'See every file on disk, who uses it, and what is left over.',
            icon: 'i-image',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
