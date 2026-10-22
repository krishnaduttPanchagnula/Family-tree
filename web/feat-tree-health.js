// Feature module: check my tree.
//
// The check looks for the problems that make a family tree hard to trust:
// missing dates, people nobody linked, impossible dates, and two records
// that look like the same person.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    var SEVERITY_LABEL = { error: 'Needs a fix', warning: 'Worth a look', notice: 'Missing information' };

    function personButtons(ids) {
        return ids.map(function (id) {
            var person = FT.people().find(function (p) { return p.id === id; });
            if (!person) return '';
            return '<button type="button" class="ft-find-person" data-id="' + id + '">' +
                FT.esc(person.name) + '</button>';
        }).join('');
    }

    function findingMarkup(finding) {
        var merge = '';
        if (finding.action === 'merge' && finding.person_ids.length === 2 && !FT.readOnly()) {
            merge = '<button type="button" class="btn-outline ft-merge-action" data-action="merge" ' +
                'data-a="' + finding.person_ids[0] + '" data-b="' + finding.person_ids[1] + '">Merge these two</button>';
        }
        return '<li class="ft-finding ft-finding-' + FT.esc(finding.severity) + '">' +
            '<div class="ft-finding-head">' +
            '  <span class="ft-finding-severity">' + FT.esc(SEVERITY_LABEL[finding.severity] || finding.severity) + '</span>' +
            '  <span class="ft-finding-title">' + FT.esc(finding.title) + '</span>' +
            '</div>' +
            '<p class="ft-finding-detail">' + FT.esc(finding.detail) + '</p>' +
            '<div class="ft-finding-people">' + personButtons(finding.person_ids) + '</div>' +
            merge +
            '</li>';
    }

    function render(report) {
        var body = FT.body(dialog);
        var summary = report.summary || {};
        var bySeverity = summary.by_severity || {};

        var head = '<div class="ft-health-tiles">' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + FT.esc(summary.people || 0) + '</span>' +
            '<span class="ft-health-label">people</span></div>' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + FT.esc(bySeverity.error || 0) + '</span>' +
            '<span class="ft-health-label">to fix</span></div>' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + FT.esc(bySeverity.warning || 0) + '</span>' +
            '<span class="ft-health-label">to look at</span></div>' +
            '<div class="ft-health-tile"><span class="ft-health-number">' + FT.esc(bySeverity.notice || 0) + '</span>' +
            '<span class="ft-health-label">incomplete</span></div>' +
            '</div>';

        if (!report.findings || !report.findings.length) {
            body.innerHTML = head +
                '<p class="ft-health-clear">Nothing to fix. Every person has dates, a place and a connection.</p>';
            return;
        }

        body.innerHTML = head + '<ul class="ft-finding-list">' +
            report.findings.map(findingMarkup).join('') + '</ul>';
    }

    async function check() {
        var body = FT.body(dialog);
        body.innerHTML = '<p class="ft-panel-empty">Looking through the tree…</p>';
        try {
            var report = await FT.api('/api/tree-health');
            render(report);
        } catch (err) {
            body.innerHTML = '<p class="ft-panel-error" role="alert">The check failed: ' + FT.esc(err.message) + '</p>';
        }
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftHealthDialog',
            className: 'ft-health-dialog',
            title: 'Check my tree',
            copy: 'A quick look for what is missing, what is impossible, and who appears twice.'
        });
        if (!dialog) return;
        FT.resetActions(dialog);
        FT.action(dialog, 'Recheck', 'btn-secondary', check);
        FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
        FT.open(dialog);
        check();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-tree-health.css');
        dialog = FT.dialog({
            id: 'ftHealthDialog',
            className: 'ft-health-dialog',
            title: 'Check my tree',
            copy: 'A quick look for what is missing, what is impossible, and who appears twice.'
        });
        if (!dialog) return;

        var body = FT.body(dialog);
        body.addEventListener('click', function (event) {
            var person = event.target.closest('.ft-find-person');
            if (person) {
                FT.close(dialog);
                if (typeof jumpToPerson === 'function') jumpToPerson(Number(person.dataset.id));
                return;
            }
            var merge = event.target.closest('[data-action="merge"]');
            if (merge && typeof window.openMergeDialog === 'function') {
                FT.close(dialog);
                window.openMergeDialog(Number(merge.dataset.a), Number(merge.dataset.b));
            }
        });

        FT.registerTool({
            id: 'tree-health',
            title: 'Check my tree',
            description: 'Find missing dates, unlinked people and duplicates.',
            icon: 'i-check',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
