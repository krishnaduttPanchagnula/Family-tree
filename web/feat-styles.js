// Feature module: tree styles.
//
// The look of the chart: which way the generations run, how the cards are
// joined, and whether the cards are rounded or square. The state lives in
// app.js (treeStyle) so the canvas renderer and the layout agree on it.
//
// v0.4 adds the chart options: how thick the connectors are, whether they
// keep their relation colours, and how many generations are shown around the
// selected person.
(function () {
    'use strict';

    var STYLE_OPTIONS = {
        direction: [
            { value: 'down', label: 'Top to bottom', hint: 'Generations run downwards, like a family chart on a wall.' },
            { value: 'right', label: 'Left to right', hint: 'Generations run to the right, like a timeline of a line of descent.' }
        ],
        connector: [
            { value: 'straight', label: 'Straight', hint: 'A direct line between two cards.' },
            { value: 'elbow', label: 'Elbow', hint: 'Right-angled lines, the classic chart look.' },
            { value: 'curve', label: 'Curve', hint: 'Soft curves between the cards.' }
        ],
        card: [
            { value: 'rounded', label: 'Rounded', hint: 'Cards with rounded corners.' },
            { value: 'square', label: 'Square', hint: 'Square cards, a plainer look.' }
        ]
    };

    var CHART_KEY = 'familytree.chartOptions';
    var THICKNESS = { thin: 1.4, normal: 2.5, bold: 3.4 };
    var chartOptions = { thickness: 'normal', colour: 'relations', generations: 0 };
    var visibleIds = null;

    var CHART_OPTIONS = {
        thickness: [
            { value: 'thin', label: 'Thin', hint: 'Light connectors for a big tree.' },
            { value: 'normal', label: 'Normal', hint: 'The usual weight.' },
            { value: 'bold', label: 'Bold', hint: 'Easy to follow when the tree is printed.' }
        ],
        colour: [
            { value: 'relations', label: 'By relation', hint: 'Each kind of link keeps its own colour.' },
            { value: 'mono', label: 'One colour', hint: 'Quieter, and easier to print.' }
        ]
    };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function currentStyle() {
        if (typeof window.getTreeStyle === 'function') return window.getTreeStyle();
        return { direction: 'down', connector: 'straight', card: 'rounded' };
    }

    function applyStyle(style) {
        if (typeof window.setTreeStyle === 'function') {
            window.setTreeStyle(style);
        } else {
            currentStyle();
        }
        render();
    }

    function optionsMarkup(group, selected) {
        return STYLE_OPTIONS[group].map(function (option) {
            return '' +
                '<label class="ft-style-option' + (option.value === selected ? ' is-active' : '') + '">' +
                '  <input type="radio" name="ft-style-' + group + '" value="' + esc(option.value) + '"' +
                (option.value === selected ? ' checked' : '') + '>' +
                '  <span class="ft-style-label">' + esc(option.label) + '</span>' +
                '  <span class="ft-style-hint">' + esc(option.hint) + '</span>' +
                '</label>';
        }).join('');
    }

    function loadChartOptions() {
        try {
            var stored = JSON.parse(localStorage.getItem(CHART_KEY) || '{}');
            if (THICKNESS[stored.thickness]) chartOptions.thickness = stored.thickness;
            if (stored.colour === 'mono' || stored.colour === 'relations') chartOptions.colour = stored.colour;
            if ([0, 2, 3, 4].indexOf(Number(stored.generations)) >= 0) chartOptions.generations = Number(stored.generations);
        } catch (err) { /* the defaults are fine */ }
    }

    function saveChartOptions() {
        try {
            localStorage.setItem(CHART_KEY, JSON.stringify(chartOptions));
        } catch (err) { /* the browser may refuse to store it */ }
    }

    function chartOptionsMarkup() {
        var html = Object.keys(CHART_OPTIONS).map(function (group) {
            return '' +
                '<fieldset class="ft-style-group">' +
                '  <legend>' + (group === 'thickness' ? 'Line thickness' : 'Line colour') + '</legend>' +
                CHART_OPTIONS[group].map(function (option) {
                    return '' +
                        '<label class="ft-style-option' + (option.value === chartOptions[group] ? ' is-active' : '') + '">' +
                        '  <input type="radio" name="ft-chart-' + group + '" value="' + esc(option.value) + '"' +
                        (option.value === chartOptions[group] ? ' checked' : '') + '>' +
                        '  <span class="ft-style-label">' + esc(option.label) + '</span>' +
                        '  <span class="ft-style-hint">' + esc(option.hint) + '</span>' +
                        '</label>';
                }).join('') +
                '</fieldset>';
        }).join('');

        var hasSelection = typeof selectedNodeId !== 'undefined' && selectedNodeId !== null;
        html += '' +
            '<fieldset class="ft-style-group">' +
            '  <legend>Generations shown</legend>' +
            '  <select id="ftChartGenerations"' + (hasSelection ? '' : ' disabled') + '>' +
            '    <option value="0"' + (chartOptions.generations === 0 ? ' selected' : '') + '>The whole tree</option>' +
            '    <option value="2"' + (chartOptions.generations === 2 ? ' selected' : '') + '>2 up and down</option>' +
            '    <option value="3"' + (chartOptions.generations === 3 ? ' selected' : '') + '>3 up and down</option>' +
            '    <option value="4"' + (chartOptions.generations === 4 ? ' selected' : '') + '>4 up and down</option>' +
            '  </select>' +
            (hasSelection ? '' : '<p class="ft-style-hint">Select a person on the tree to limit the view to their branch.</p>') +
            '</fieldset>';
        return html;
    }

    // The hooks the renderer calls: the connector weight, the connector
    // colour, and which people are in view.
    window.connectorWidth = function () {
        return THICKNESS[chartOptions.thickness] || 2.5;
    };

    window.connectorColour = function (colour) {
        if (chartOptions.colour !== 'mono') return colour;
        return typeof cssVar === 'function' ? cssVar('--muted', '#6b7280') : '#6b7280';
    };

    function parentChild(rel) {
        var relation = String(rel.relation || '').toLowerCase();
        if (relation === 'child-of' || relation === 'child_of' || relation === 'son' || relation === 'daughter') {
            return { parent: rel.person2_id, child: rel.person1_id };
        }
        if (relation === 'child' || relation.indexOf('child-') === 0 ||
            relation === 'father' || relation === 'mother' || relation === 'parent' ||
            relation === 'parent-of' || relation === 'parent_of' ||
            relation === 'father-of' || relation === 'mother-of') {
            return { parent: rel.person1_id, child: rel.person2_id };
        }
        return null;
    }

    // The people in view when the view is limited to a few generations around
    // the selected person.
    function computeVisible() {
        visibleIds = null;
        if (!chartOptions.generations) return;
        var start = typeof selectedNodeId !== 'undefined' ? selectedNodeId : null;
        if (start === null || start === undefined) return;
        var relations = (typeof currentRelationships !== 'undefined' && currentRelationships) ? currentRelationships : [];

        var depth = { start: 0 };
        var frontier = [start];
        for (var pass = 0; pass < chartOptions.generations; pass++) {
            var next = [];
            frontier.forEach(function (id) {
                relations.forEach(function (rel) {
                    var edge = parentChild(rel);
                    if (!edge) return;
                    var other = null;
                    if (edge.child === id) other = edge.parent;
                    else if (edge.parent === id) other = edge.child;
                    if (other === null || depth[other] !== undefined) return;
                    depth[other] = depth[id] + 1;
                    next.push(other);
                });
            });
            frontier = next;
            if (!frontier.length) break;
        }
        visibleIds = new Set(Object.keys(depth).map(Number));
    }

    window.filterVisiblePersons = function (persons) {
        computeVisible();
        if (!visibleIds) return persons;
        return persons.filter(function (person) { return visibleIds.has(person.id); });
    };

    window.isPersonVisible = function (id) {
        if (!chartOptions.generations) return true;
        if (!visibleIds) computeVisible();
        if (!visibleIds) return true;
        return visibleIds.has(id);
    };

    // The canvas redraws itself through renderTree in app.js.
    function redraw() {
        if (typeof renderTree === 'function') renderTree();
    }

    function render() {
        var host = document.getElementById('ftStylesBody');
        if (!host) return;
        var style = currentStyle();
        host.innerHTML = Object.keys(STYLE_OPTIONS).map(function (group) {
            return '' +
                '<fieldset class="ft-style-group">' +
                '  <legend>' + esc(group === 'direction' ? 'Direction' : group === 'connector' ? 'Connections' : 'Cards') + '</legend>' +
                optionsMarkup(group, style[group]) +
                '</fieldset>';
        }).join('') + chartOptionsMarkup();
    }

    function mount() {
        var host = document.createElement('div');
        host.id = 'ftStyles';
        host.innerHTML =
            '<dialog id="ftStylesDialog" class="ft-style-dialog" aria-labelledby="ftStylesHeading">' +
            '  <form method="dialog" class="dialog-form">' +
            '    <h3 id="ftStylesHeading">Tree styles</h3>' +
            '    <p class="dialog-copy">How the chart is drawn. Changes are saved on this machine.</p>' +
            '    <div id="ftStylesBody"></div>' +
            '    <div class="dialog-actions">' +
            '      <button type="button" class="btn-secondary" id="ftStylesReset">Reset</button>' +
            '      <button type="button" class="btn-secondary" onclick="closeStylesDialog()">Close</button>' +
            '    </div>' +
            '  </form>' +
            '</dialog>';
        document.body.appendChild(host);

        var dialog = document.getElementById('ftStylesDialog');
        var body = document.getElementById('ftStylesBody');

        body.addEventListener('change', function (event) {
            var input = event.target.closest('input[type="radio"]');
            if (!input) return;
            if (input.name.indexOf('ft-chart-') === 0) {
                chartOptions[input.name.replace('ft-chart-', '')] = input.value;
                saveChartOptions();
                render();
                redraw();
                return;
            }
            var style = currentStyle();
            style[input.name.replace('ft-style-', '')] = input.value;
            applyStyle(style);
            render();
        });

        body.addEventListener('change', function (event) {
            if (event.target.id !== 'ftChartGenerations') return;
            chartOptions.generations = Number(event.target.value);
            saveChartOptions();
            render();
            redraw();
        });

        document.getElementById('ftStylesReset').addEventListener('click', function () {
            applyStyle({ direction: 'down', connector: 'straight', card: 'rounded' });
            chartOptions = { thickness: 'normal', colour: 'relations', generations: 0 };
            saveChartOptions();
            render();
            redraw();
        });

        loadChartOptions();

        window.openStylesDialog = openStylesDialog;
        window.closeStylesDialog = closeStylesDialog;
    }

    function openStylesDialog() {
        render();
        var dialog = document.getElementById('ftStylesDialog');
        if (dialog && !dialog.open) dialog.showModal();
    }

    function closeStylesDialog() {
        var dialog = document.getElementById('ftStylesDialog');
        if (dialog && dialog.open) dialog.close();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
