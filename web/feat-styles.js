// Feature module: tree styles.
//
// The look of the chart: which way the generations run, how the cards are
// joined, and whether the cards are rounded or square. The state lives in
// app.js (treeStyle) so the canvas renderer and the layout agree on it.
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
        }).join('');
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
            var style = currentStyle();
            style[input.name.replace('ft-style-', '')] = input.value;
            applyStyle(style);
            render();
        });

        document.getElementById('ftStylesReset').addEventListener('click', function () {
            applyStyle({ direction: 'down', connector: 'straight', card: 'rounded' });
            render();
        });

        dialog.addEventListener('close', function () {
            if (typeof window.showToast === 'function') { /* keep the last toast */ }
        });

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
