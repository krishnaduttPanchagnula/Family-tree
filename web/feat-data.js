/* ============================================================
   Family Tree Builder - files, backups and import/export
   Renders into the Settings dialog (#dataTools) and into its
   own dialog. Everything it touches lives on this machine.
   ============================================================ */
(function () {
    'use strict';

    var snapshots = [];
    var refreshInFlight = null;

    // --- small helpers -------------------------------------------------
    function icon(name) {
        return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
    }
    function escText(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(value) {
        return escText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function plural(count, one, many) {
        return count === 1 ? one : many;
    }
    function formatBytes(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function formatTime(value) {
        if (!value) return '';
        var date = new Date(value);
        return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function setStatus(role, text, isError) {
        document.querySelectorAll('[data-ft-role="' + role + '"]').forEach(function (el) {
            el.textContent = text || '';
            el.classList.toggle('ft-status-error', !!isError);
            el.hidden = !text;
        });
    }

    function setBusy(action, busy) {
        document.querySelectorAll('[data-ft-action="' + action + '"]').forEach(function (btn) {
            btn.disabled = !!busy;
            btn.setAttribute('aria-busy', String(!!busy));
        });
    }

    function rowButtons(action, name) {
        return Array.prototype.filter.call(
            document.querySelectorAll('[data-ft-action="' + action + '"]'),
            function (btn) { return btn.dataset.name === name; }
        );
    }

    function setRowBusy(action, name, busy) {
        rowButtons(action, name).forEach(function (btn) {
            btn.disabled = !!busy;
            btn.setAttribute('aria-busy', String(!!busy));
        });
    }

    function errorText(err) {
        return (err && err.message ? err.message : String(err || 'Unknown error')).trim();
    }

    // A non-2xx response carries a plain-text error message; show that
    // instead of the bare status text.
    function failWith(res, fallback) {
        return res.text().then(function (text) {
            throw new Error((text || '').trim() || res.statusText || fallback);
        });
    }

    // currentPersons is a top-level `let` in app.js, so it lives in the global
    // lexical scope rather than on window.
    function personCount() {
        try { return currentPersons.length; } catch (err) { return 0; }
    }

    // A copy of the tree as it is now, so a restore can be undone with Ctrl+Z.
    function currentState() {
        try {
            return {
                persons: JSON.parse(JSON.stringify(currentPersons)),
                relationships: JSON.parse(JSON.stringify(currentRelationships))
            };
        } catch (err) {
            return { persons: [], relationships: [] };
        }
    }

    // --- markup ---------------------------------------------------------
    function panelMarkup() {
        return '' +
            '<p class="ft-note">Everything stays on this machine. Backups, snapshots and exports are plain files you can copy to a USB stick or a network drive.</p>' +

            '<section class="ft-group" aria-label="Files">' +
                '<h4 class="ft-group-title">Files</h4>' +

                '<div class="ft-item">' +
                    '<p class="ft-item-title">Import a family tree (GEDCOM)</p>' +
                    '<p class="ft-item-text">Reads a .ged file and adds its people and connections to this tree.</p>' +
                    '<label class="file-label ft-file-label">' +
                        '<span class="file-label-btn ft-file-btn">' + icon('upload') +
                            '<span data-ft-role="import-label">Choose a .ged file…</span>' +
                        '</span>' +
                        '<input type="file" class="ft-gedcom-input" accept=".ged,.gedcom,text/plain" aria-label="Choose a GEDCOM file to import">' +
                    '</label>' +
                    '<p class="ft-status" data-ft-role="import-status" role="status" aria-live="polite" hidden></p>' +
                    '<ul class="ft-warnings" data-ft-role="import-warnings" hidden></ul>' +
                '</div>' +

                '<div class="ft-item">' +
                    '<p class="ft-item-title">Export GEDCOM</p>' +
                    '<p class="ft-item-text">GEDCOM is the format other genealogy tools read.</p>' +
                    '<button type="button" class="btn-outline ft-btn" data-ft-action="export-gedcom">' +
                        icon('gedcom') + ' Export GEDCOM' +
                    '</button>' +
                    '<p class="ft-status" data-ft-role="gedcom-status" role="status" aria-live="polite" hidden></p>' +
                '</div>' +

                '<div class="ft-item">' +
                    '<p class="ft-item-title">Download a full backup (with photos)</p>' +
                    '<p class="ft-item-text">This zip holds the database and every uploaded photo, unlike the plain JSON backup.</p>' +
                    '<button type="button" class="btn-outline ft-btn" data-ft-action="download-archive">' +
                        icon('archive') + ' Download full backup' +
                    '</button>' +
                    '<p class="ft-status" data-ft-role="archive-status" role="status" aria-live="polite" hidden></p>' +
                '</div>' +
            '</section>' +

            '<section class="ft-group" aria-label="Local snapshots">' +
                '<h4 class="ft-group-title">Local snapshots</h4>' +
                '<div class="ft-item">' +
                    '<div class="ft-btn-row">' +
                        '<button type="button" class="btn-outline ft-btn" data-ft-action="snapshot-now">' +
                            icon('history') + ' Snapshot now' +
                        '</button>' +
                        '<button type="button" class="ft-action-btn" data-ft-action="refresh-snapshots" ' +
                            'title="Reload the snapshot list" aria-label="Reload the snapshot list">' +
                            icon('refresh') + ' Reload' +
                        '</button>' +
                    '</div>' +
                    '<p class="ft-status" data-ft-role="snapshot-status" role="status" aria-live="polite" hidden></p>' +
                    '<ul class="ft-snapshot-list" data-ft-role="snapshot-list" aria-live="polite">' +
                        '<li class="ft-empty">Loading snapshots…</li>' +
                    '</ul>' +
                '</div>' +
            '</section>';
    }

    function snapshotRow(snapshot) {
        var name = String(snapshot.name || '');
        var meta = [formatTime(snapshot.created_at), formatBytes(snapshot.size)]
            .filter(Boolean).join(' · ');
        return '' +
            '<li class="ft-snapshot">' +
                '<span class="ft-snapshot-info">' +
                    '<span class="ft-snapshot-name" title="' + escAttr(name) + '">' + escText(name) + '</span>' +
                    '<span class="ft-snapshot-meta">' + escText(meta) + '</span>' +
                '</span>' +
                '<span class="ft-snapshot-actions">' +
                    '<button type="button" class="ft-action-btn" data-ft-action="restore" data-name="' + escAttr(name) + '">Restore</button>' +
                    '<button type="button" class="ft-action-btn ft-action-danger" data-ft-action="delete" data-name="' + escAttr(name) + '">Delete</button>' +
                '</span>' +
            '</li>';
    }

    function renderSnapshotList() {
        document.querySelectorAll('[data-ft-role="snapshot-list"]').forEach(function (list) {
            if (!snapshots.length) {
                list.innerHTML = '<li class="ft-empty">No snapshots yet. The app writes one automatically every 30 minutes.</li>';
                return;
            }
            list.innerHTML = snapshots.map(snapshotRow).join('');
        });
    }

    function renderSnapshotError(message) {
        document.querySelectorAll('[data-ft-role="snapshot-list"]').forEach(function (list) {
            list.innerHTML = '' +
                '<li class="ft-empty ft-empty-error">' + escText(message) +
                '<button type="button" class="ft-action-btn ft-empty-retry" data-ft-action="refresh-snapshots">Try again</button>' +
                '</li>';
        });
    }

    // --- rendering ------------------------------------------------------
    function targets() {
        var list = [];
        var settings = document.getElementById('dataTools');
        if (settings) list.push(settings);
        var dialogBody = document.getElementById('ftDataToolsDialogBody');
        if (dialogBody) list.push(dialogBody);
        return list;
    }

    function renderDataTools() {
        targets().forEach(function (target) {
            target.innerHTML = panelMarkup();
        });
        refreshSnapshots();
    }

    function openDataToolsDialog() {
        var dialog = document.getElementById('ftDataToolsDialog');
        if (!dialog) return;
        renderDataTools();
        if (!dialog.open) dialog.showModal();
    }

    // --- snapshots ------------------------------------------------------
    // `force` starts a new request even when one is still running, so a
    // freshly written or deleted snapshot shows up right away.
    function refreshSnapshots(force) {
        if (refreshInFlight && !force) return refreshInFlight;
        var request = fetch('/api/snapshots')
            .then(function (res) {
                if (!res.ok) return failWith(res, 'could not load snapshots');
                return res.json();
            })
            .then(function (data) {
                snapshots = (Array.isArray(data) ? data : []).slice().sort(function (a, b) {
                    var byDate = String(b.created_at || '').localeCompare(String(a.created_at || ''));
                    if (byDate) return byDate;
                    return String(b.name || '').localeCompare(String(a.name || ''));
                });
                renderSnapshotList();
            })
            .catch(function (err) {
                snapshots = [];
                var message = errorText(err);
                renderSnapshotError('Could not load snapshots: ' + message);
                showToast('Could not load snapshots: ' + message, true);
            })
            .then(function () {
                if (refreshInFlight === request) refreshInFlight = null;
            });
        refreshInFlight = request;
        return request;
    }

    function createSnapshot() {
        setBusy('snapshot-now', true);
        setStatus('snapshot-status', 'Writing snapshot…', false);
        return fetch('/api/snapshot', { method: 'POST' })
            .then(function (res) {
                if (!res.ok) return failWith(res, 'the snapshot was not written');
                return res.json().catch(function () { return null; });
            })
            .then(function (data) {
                setStatus('snapshot-status', '', false);
                showToast(data && data.name ? 'Snapshot saved: ' + data.name : 'Snapshot saved');
                return refreshSnapshots(true);
            })
            .catch(function (err) {
                var message = errorText(err);
                setStatus('snapshot-status', 'Could not write a snapshot: ' + message, true);
                showToast('Could not write a snapshot: ' + message, true);
            })
            .then(function () {
                setBusy('snapshot-now', false);
            });
    }

    function restoreSnapshot(name) {
        var people = personCount();
        return showConfirm({
            title: 'Restore this snapshot?',
            message: 'Restoring "' + name + '" replaces the ' + people + ' ' +
                plural(people, 'person', 'people') + ' in your current tree with the people and ' +
                'connections in the snapshot. You can undo it straight afterwards with Ctrl+Z.',
            confirmLabel: 'Restore',
            danger: true
        }).then(function (ok) {
            if (!ok) return null;
            setRowBusy('restore', name, true);
            setStatus('snapshot-status', 'Restoring ' + name + '…', false);
            var before = currentState();
            return fetch('/api/snapshots/' + encodeURIComponent(name))
                .then(function (res) {
                    if (!res.ok) return failWith(res, 'the snapshot could not be read');
                    return res.json();
                })
                .then(function (payload) {
                    return fetch('/api/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                })
                .then(function (res) {
                    if (!res.ok) return failWith(res, 'the restore was rejected');
                    return window.loadTree();
                })
                .then(function () {
                    setStatus('snapshot-status', '', false);
                    // Put the previous tree back on the app's undo stack, so
                    // Ctrl+Z really does undo the restore.
                    if (typeof pushUndo === 'function') {
                        pushUndo({
                            label: 'the restore',
                            run: function () {
                                return fetch('/api/restore', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(before)
                                }).then(function (res) {
                                    if (!res.ok) throw new Error('could not undo the restore');
                                    return window.loadTree();
                                });
                            }
                        });
                    }
                    showToast('Snapshot restored: ' + name);
                })
                .catch(function (err) {
                    var message = errorText(err);
                    setStatus('snapshot-status', 'Restore failed: ' + message, true);
                    showToast('Restore failed: ' + message, true);
                })
                .then(function () {
                    setRowBusy('restore', name, false);
                });
        });
    }

    function deleteSnapshot(name) {
        return showConfirm({
            title: 'Delete this snapshot?',
            message: 'The snapshot "' + name + '" is deleted from disk. It cannot be recovered.',
            confirmLabel: 'Delete',
            danger: true
        }).then(function (ok) {
            if (!ok) return null;
            setRowBusy('delete', name, true);
            return fetch('/api/snapshots/' + encodeURIComponent(name), { method: 'DELETE' })
                .then(function (res) {
                    if (!res.ok && res.status !== 204) return failWith(res, 'the snapshot was not deleted');
                })
                .then(function () {
                    showToast('Snapshot deleted: ' + name);
                    return refreshSnapshots(true);
                })
                .catch(function (err) {
                    var message = errorText(err);
                    setStatus('snapshot-status', 'Could not delete the snapshot: ' + message, true);
                    showToast('Could not delete the snapshot: ' + message, true);
                })
                .then(function () {
                    setRowBusy('delete', name, false);
                });
        });
    }

    // --- import / export ------------------------------------------------
    function showImportDuplicates(duplicates, skipped, file) {
        var FT = window.FT;
        if (!FT) return;

        var skippedRows = duplicates.filter(function (item) { return item.severity === 'duplicate'; });
        var warnedRows = duplicates.filter(function (item) { return item.severity !== 'duplicate'; });

        var dialog = FT.dialog({
            id: 'ftImportDupesDialog',
            className: 'ft-import-dupes-dialog',
            title: 'People who are already in the tree',
            copy: skippedRows.length
                ? skippedRows.length + ' ' + plural(skippedRows.length, 'person', 'people') + ' from the file ' +
                  (skippedRows.length === 1 ? 'was' : 'were') + ' kept as the record you already had.'
                : 'Somebody from the file looks a lot like somebody you already have.'
        });

        var body = FT.body(dialog);
        body.innerHTML =
            '<ul class="ft-import-dupes">' + duplicates.map(function (item) {
                return '<li class="ft-import-dupe' + (item.severity === 'duplicate' ? ' is-same' : '') + '">' +
                    '<span class="ft-import-dupe-name">' + escText(item.name || 'Someone') + '</span>' +
                    (item.dob ? '<span class="ft-import-dupe-meta">' + escText(item.dob) + '</span>' : '') +
                    (item.existing_name ? '<span class="ft-import-dupe-meta">already in the tree as ' + escText(item.existing_name) + '</span>' : '') +
                    '<span class="ft-import-dupe-reason">' + escText(item.reason || '') + '</span>' +
                    '</li>';
            }).join('') + '</ul>' +
            (warnedRows.length
                ? '<p class="ft-panel-empty">The ones marked as a warning were imported anyway, because the dates do not match exactly.</p>'
                : '') +
            '<p class="ft-panel-empty">Merge the two records afterwards with the merge tool in the Family tab.</p>';

        FT.resetActions(dialog);
        FT.action(dialog, 'Keep the tree as it is', 'btn-secondary', function () {
            FT.close(dialog);
        });
        FT.action(dialog, 'Import them anyway', 'btn-primary', function () {
            FT.close(dialog);
            importGedcom(file, true);
        });
        FT.open(dialog);
    }

    function importGedcom(file, allowDuplicates) {
        if (!file) return Promise.resolve();
        var form = new FormData();
        form.append('file', file);
        if (allowDuplicates) form.append('allow_duplicates', '1');

        setStatus('import-status', 'Importing ' + file.name + '…', false);
        var warningLists = document.querySelectorAll('[data-ft-role="import-warnings"]');
        warningLists.forEach(function (list) { list.innerHTML = ''; list.hidden = true; });
        document.querySelectorAll('.ft-gedcom-input').forEach(function (input) { input.disabled = true; });
        document.querySelectorAll('[data-ft-role="import-label"]').forEach(function (label) {
            label.textContent = 'Importing…';
        });
        document.querySelectorAll('.ft-file-btn').forEach(function (btn) { btn.setAttribute('aria-busy', 'true'); });

        return fetch('/api/gedcom/import', { method: 'POST', body: form })
            .then(function (res) {
                if (!res.ok) return failWith(res, 'the file could not be read');
                return res.json().catch(function () { return {}; });
            })
            .then(function (data) {
                var people = Number(data.persons) || 0;
                var connections = Number(data.relationships) || 0;
                var warnings = Array.isArray(data.warnings) ? data.warnings : [];
                var duplicates = Array.isArray(data.duplicates) ? data.duplicates : [];
                var skipped = Number(data.skipped) || 0;
                setStatus('import-status', 'Imported ' + people + ' ' + plural(people, 'person', 'people') +
                    ' and ' + connections + ' ' + plural(connections, 'connection', 'connections') + '.' +
                    (skipped ? ' ' + skipped + ' ' + plural(skipped, 'person', 'people') + ' already existed.' : ''), false);
                warningLists.forEach(function (list) {
                    if (!warnings.length) { list.hidden = true; list.innerHTML = ''; return; }
                    list.innerHTML = warnings.map(function (warning) {
                        return '<li>' + escText(warning) + '</li>';
                    }).join('');
                    list.hidden = false;
                });
                if (duplicates.length) showImportDuplicates(duplicates, skipped, file);
                return window.loadTree();
            })
            .then(function () {
                showToast('GEDCOM imported');
            })
            .catch(function (err) {
                var message = errorText(err);
                setStatus('import-status', 'Import failed: ' + message, true);
                showToast('Import failed: ' + message, true);
            })
            .then(function () {
                document.querySelectorAll('.ft-gedcom-input').forEach(function (input) {
                    input.disabled = false;
                    input.value = '';
                });
                document.querySelectorAll('[data-ft-role="import-label"]').forEach(function (label) {
                    label.textContent = 'Choose a .ged file…';
                });
                document.querySelectorAll('.ft-file-btn').forEach(function (btn) { btn.setAttribute('aria-busy', 'false'); });
            });
    }

    function downloadRemoteFile(url, filename, role, label) {
        setBusy(label.action, true);
        setStatus(role, label.busy, false);
        return fetch(url)
            .then(function (res) {
                if (!res.ok) return failWith(res, 'the download failed');
                return res.blob();
            })
            .then(function (blob) {
                window.downloadBlob(blob, filename);
                setStatus(role, label.done, false);
            })
            .catch(function (err) {
                var message = errorText(err);
                setStatus(role, 'Could not download: ' + message, true);
                showToast(label.failed + ': ' + message, true);
            })
            .then(function () {
                setBusy(label.action, false);
            });
    }

    function exportGedcom() {
        var stamp = new Date().toISOString().slice(0, 10);
        return downloadRemoteFile('/api/gedcom', 'family-tree-' + stamp + '.ged', 'gedcom-status', {
            action: 'export-gedcom',
            busy: 'Preparing the GEDCOM file…',
            done: 'GEDCOM downloaded.',
            failed: 'GEDCOM export failed'
        });
    }

    function downloadArchive() {
        var stamp = new Date().toISOString().slice(0, 10);
        return downloadRemoteFile('/api/backup/archive', 'family-tree-backup-' + stamp + '.zip', 'archive-status', {
            action: 'download-archive',
            busy: 'Building the backup archive…',
            done: 'Backup downloaded.',
            failed: 'Backup download failed'
        });
    }

    // --- wiring ---------------------------------------------------------
    function injectStylesheet() {
        // index.html normally links the stylesheet; add it only if it is missing.
        if (document.querySelector('link[href="/static/feat-data.css"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/static/feat-data.css';
        link.setAttribute('data-ft-style', '1');
        document.head.appendChild(link);
    }

    function injectMarkup() {
        if (document.getElementById('ftDataToolsDialog')) return;
        var host = document.createElement('div');
        host.id = 'ftDataToolsHost';
        host.innerHTML = '' +
            '<dialog id="ftDataToolsDialog">' +
                '<div class="dialog-form">' +
                    '<h3>Files and backups</h3>' +
                    '<div id="ftDataToolsDialogBody"></div>' +
                    '<div class="dialog-actions">' +
                        '<button type="button" class="btn-secondary" data-ft-action="close-dialog">Close</button>' +
                    '</div>' +
                '</div>' +
            '</dialog>';
        document.body.appendChild(host);
    }

    function onClick(event) {
        try {
            var source = event.target;
            if (!source || !source.closest) return;
            var trigger = source.closest('[data-ft-action]');
            if (!trigger) return;
            var action = trigger.getAttribute('data-ft-action');

            if (action === 'close-dialog') {
                var dialog = document.getElementById('ftDataToolsDialog');
                if (dialog && dialog.open) dialog.close();
                return;
            }
            if (action === 'refresh-snapshots') { refreshSnapshots(true); return; }
            if (action === 'snapshot-now') { createSnapshot(); return; }
            if (action === 'export-gedcom') { exportGedcom(); return; }
            if (action === 'download-archive') { downloadArchive(); return; }
            if (action === 'restore') { restoreSnapshot(trigger.dataset.name); return; }
            if (action === 'delete') { deleteSnapshot(trigger.dataset.name); return; }
        } catch (err) {
            showToast('Something went wrong: ' + errorText(err), true);
        }
    }

    function onChange(event) {
        var input = event.target;
        if (!input.classList || !input.classList.contains('ft-gedcom-input')) return;
        var file = input.files && input.files[0];
        if (file) importGedcom(file);
    }

    function start() {
        injectStylesheet();
        injectMarkup();
        document.addEventListener('click', onClick);
        document.addEventListener('change', onChange);
        renderDataTools();

        // The Settings dialog is the main home for this panel; refresh the
        // snapshot list every time it opens.
        var settings = document.getElementById('settingsDialog');
        if (settings) settings.addEventListener('open', renderDataTools);
    }

    window.renderDataTools = renderDataTools;
    window.openDataToolsDialog = openDataToolsDialog;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}());
