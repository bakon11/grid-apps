/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function() {

gapp.register("mesh.build",[
    "moto.broker",  // dep: moto.broker
    "mesh.util",    // dep: mesh.util
    "mesh.api",     // dep: mesh.api
]);

let mesh = self.mesh = self.mesh || {};
if (mesh.build) return;

let broker = gapp.broker;
let call = broker.send;
let { api, util } = mesh;
let rad = 180 / Math.PI;
let und = undefined;

broker.listeners({
    ui_build
});

let spin_timer;

// add download / blob export to util
util.download = (data, filename = "mesh-data") => {
    let url = window.URL.createObjectURL(new Blob([data], {type: "octet/stream"}));
    $('download').innerHTML = `<a id="_data_export_" href="${url}" download="${filename}">x</a>`;
    $('_data_export_').click();
};

// add modal dialog functions to api
let modal = api.modal = {
    show(title, contents) {
        if (this.info.showing) {
            throw `modal conflict showing "${title}"`;
        }
        let bound = h.bind($('modal'), contents);
        $('modal_title_text').innerText = title;
        $('modal_page').style.display = 'flex';
        $('modal_frame').style.display = 'flex';
        $('spinner').style.display = 'none';
        modal.info = { title, contents, showing: true };
        broker.publish('modal_show');
        return bound;
    },

    hide(cancel = false) {
        if (!modal.info.showing) {
            return;
        }
        clearTimeout(spin_timer);
        $('modal_page').style.display = 'none';
        modal.info.showing = false;
        modal.info.cancelled = cancel;
        broker.publish('modal_hide');
        if (modal._dialog) {
            modal._dialog.resolve(modal._dialog.bound);
            modal._dialog = undefined;
        }
    },

    cancel() {
        // hide but set a flag denoting cancellation
        modal.hide(true);
    },

    info: {
        showing: false
    },

    get title() {
        return modal.info.title;
    },

    get showing() {
        return modal.info.showing;
    },

    spin(bool, delay) {
        if (bool) {
            if (delay) {
                spin_timer = setTimeout(() => {
                    modal.spin(true);
                }, delay);
                return;
            }
            $('modal_page').style.display = 'flex';
            $('modal_frame').style.display = 'none';
            $('spinner').style.display = 'block';
            broker.publish('modal_show', 'spinner');
        } else {
            modal.hide();
        }
    },

    dialog(opt = {}) {
        let { title, body } = opt;
        let contents = [];
        if (typeof body === 'string') {
            contents.push(h.div(body))
        } else if (Array.isArray(body)) {
            contents.appendAll(body);
        } else {
            throw "invalid dialog contents";
        }
        return new Promise((resolve, reject) => {
            let bound = this.show(title, contents);
            modal._dialog = { resolve, reject, bound };
        });
    },

    get bound() {
        return modal._dialog ? modal._dialog.bound : undefined;
    }
};

// transient logging window bottom/left
let log = api.log = {
    age: 10000, // age out lines more than 10 seconds old

    data: [],   // last n messages

    wait: 3000, // time before windows closes

    lines: 20,  // max log lines before forced-age out

    emit(msg) {
        let { age, data, lines, render } = log;
        let now = Date.now();
        data.push({
            text: `${dbug.since()} | ${msg}`,
            time: now
        });
        while (!log.pinned && data.length && (data.length > lines || now - data[0].time > age)) {
            data.shift();
        }
        return render();
    },

    hide() {
        $('logger').style.display = 'none';
        return log;
    },

    toggle() {
        return log.pinned ? log.unpin() && log.hide() : log.pin();
    },

    pin() {
        log.pinned = true;
        return log.show();
    },

    unpin() {
        log.pinned = false;
        return log.show();
    },

    // show log window for `time` milliseconds or default
    show(time) {
        clearTimeout(log.timer);
        log.timer = log.pinned ? null : setTimeout(log.hide, time || log.wait);
        $('logger').style.display = 'flex';
        return log;
    },

    // re-render and show current log messages
    render() {
        let area = $('logtext');
        h.bind(area, log.data.map(rec => h.div({ _: rec.text })));
        area.scrollTop = area.scrollHeight;
        return log.show();
    },
};

// bind endpoint for worker to log in the ui
gapp.broker.subscribe("mesh.log", log.emit);

// bind settings endpoint to api
api.settings = function() {
    let { prefs } = api;
    let { space } = prefs.map;
    modal.show('settings', h.div({ class: "settings" }, [
        h.label('dark mode'),
        h.input({ type: "checkbox",
            onchange: ev => call.set_darkmode(ev.target.checked),
            [ space.dark ? 'checked' : 'unchecked' ] : 1
        }),
        h.label('auto floor'),
        h.input({ type: "checkbox",
            onchange: ev => prefs.save( space.floor = !space.floor ),
            [ space.floor !== false ? 'checked' : 'unchecked' ] : 1
        }),
        h.label('auto center'),
        h.input({ type: "checkbox",
            onchange: ev => prefs.save( space.center = !space.center ),
            [ space.center !== false ? 'checked' : 'unchecked' ] : 1
        }),
    ]));
}

// create html elements
function ui_build() {
    // set app version
    $h('app-name', "Mesh:Tool");
    $h('app-vers', 'beta' /* gapp.version */);

    // add a help button
    h.bind($('top-right'), [
        h.div({ id: "top-settings", onclick: api.settings }, [
            h.div({ class: "fas fa-sliders-h" }),
        ]),
        h.div({ id: "top-help", onclick: api.help }, [
            h.div({ class: "far fa-question-circle" }),
        ]),
    ]);

    // create top level app areas
    let bound = h.bind($('app-body'), [
        // modal dialog and page blocker
        h.div({ id: 'modal_page' }, [
            h.div({ id: 'modal_frame' }, [
                h.div({ id: 'modal_title'}, [
                    h.div({ id: 'modal_title_text', _: 'title' }),
                    h.div({ id: 'modal_title_close', onclick: modal.cancel }, [
                        h.i({ class: "far fa-window-close" })
                    ])
                ]),
                h.div({ id: 'modal' }, [
                    h.div({ _: 'this is a modal test' })
                ])
            ]),
            h.div({ id: 'spinner', class: 'spin' })
        ]),
        // display and action areas
        h.div({ id: 'modes' }),
        h.div({ id: 'actions' }),
        h.div({ id: 'grouplist'}),
        h.div({ id: 'selectlist'}),
        h.div({ id: 'logger', onmouseover() { log.show() } }),
        h.div({ id: 'download', class: "hide" })
    ]);

    let { modes, actions, grouplist, selectlist, logger } = bound;

    // create slid in/out logging window
    h.bind(logger, [ h.div({ id: 'logtext' }) ]);

    // a few shortcuts to api calls
    let { file, selection, mode, tool, prefs } = api;

    // top/center mode selector
    h.bind(modes, [
        h.button({ _: 'object', id: "mode-object", onclick() { mode.object() } }),
        h.button({ _: 'face', id: "mode-face", onclick() { mode.face() } }),
        h.button({ _: 'line', id: "mode-line", onclick() { mode.line() } }),
        h.button({ _: 'vertex', id: "mode-vertex", onclick() { mode.vertex() } }),
    ]);

    // create hotkey/action menu (top/left)
    h.bind(actions, [
        h.div([
            // create and bind file loading elements
            h.div({ _: "file", class: "head" }),
            // h.div({ class: "vsep" }),
            h.button({ _: 'import', onclick: file.import }, [
                h.input({
                    id: "import", type: "file", class: ["hide"], multiple: true,
                    onchange(evt) { broker.send.load_files(evt.target.files) }
                })
            ]),
            h.button({ _: 'export', onclick: file.export }),
        ]),
        h.div([
            h.div({ _: "view", class: "head" }),
            // h.div({ class: "vsep" }),
            h.button({ _: 'visible', onclick() { selection.visible({ toggle: true }) } }),
            h.button({ _: 'bounds', onclick() { selection.boundsBox({ toggle: true }) } }),
            h.button({ _: 'gridlines', onclick() { api.grid() } }),
            h.button({ _: 'wireframe', onclick() { api.wireframe() } }),
            h.button({ _: 'normals', onclick() { api.normals() } }),
        ]),
        h.div([
            h.div({ _: "edit", class: "head" }),
            // h.div({ class: "vsep" }),
            h.button({ _: 'duplicate', onclick: tool.duplicate }),
            h.button({ _: 'regroup', onclick: tool.regroup }),
            h.button({ _: 'merge', onclick: tool.merge }),
            h.button({ _: 'mirror', onclick: tool.mirror }),
            h.button({ _: 'split', onclick: call.edit_split }),
            h.button({ _: 'invert', onclick: tool.invert }),
        ]),
        h.div([
            h.div({ _: "fix", class: "head" }),
            // h.div({ class: "vsep" }),
            h.button({ _: 'analyze', onclick: tool.analyze }),
            h.button({ _: 'repair', onclick: tool.repair }),
            h.button({ _: 'clean', onclick: tool.clean }),
        ]),
    ]);

    // for group/model/box/area/mesh dashboard grids
    function grid(v1, v2, side = [ "pos", "rot"], top = [ "X", "Y", "Z" ], root) {
        let v = 'val', l = 'lbl';
        let [ X, Y, Z ] = top;
        let [ pos, rot ] = side;
        return h.div({ class: "grid"}, [
            h.div({ _: "" }),
            h.div({ _: X, class: "top noselect", id: root ? [ root, l, X ] : und }),
            h.div({ _: Y, class: "top noselect", id: root ? [ root, l, Y ] : und }),
            h.div({ _: Z, class: "top noselect", id: root ? [ root, l, Z ] : und }),
            h.div({ _: side[0], class: "side noselect" }),
            h.label({ _: v1[0], id: root ? [ root, v, X, pos ] : und }),
            h.label({ _: v1[1], id: root ? [ root, v, Y, pos ] : und }),
            h.label({ _: v1[2], id: root ? [ root, v, Z, pos ] : und }),
            h.div({ _: side[1], class: "side noselect" }),
            h.label({ _: v2[0], id: root ? [ root, v, X, rot ] : und }),
            h.label({ _: v2[1], id: root ? [ root, v, Y, rot ] : und }),
            h.label({ _: v2[2], id: root ? [ root, v, Z, rot ] : und }),
        ]);
    }

    function update_all() {
        update_selector();
        update_selection();
    }

    // update model selector list (top/right)
    function update_selector() {
        let selHas = selection.contains;
        // map groups to divs
        let groups = api.group.list()
            .map(g => h.div([
                h.button({ _: g.name || `group`, title: g.id,
                    class: [ "group", selHas(g) ? 'selected' : undefined ],
                    onclick(e) {
                        e.shiftKey ? selection.toggle(g) : selection.set([g])
                    }
                }),
                h.div({ class: "vsep" }),
                h.div({ class: "models"},
                    // map models to buttons
                    g.models.map(m => h.button({ _: m.file || m.id,
                        class: [
                            selHas(m) ? 'selected' : undefined,
                            m.visible() ? undefined : 'hidden'
                        ],
                        onclick(e) {
                            let sel = selection.list();
                            e.shiftKey || (sel.length === 1 && m === sel[0]) ?
                                selection.toggle(m) :
                                selection.set([m])
                        }
                    }))
                )
            ]));
        h.bind(grouplist, groups);
    }

    // return function bound to field editing clicks
    // builds a modal dialog that updates the object and field
    function field_edit(title, set, opt = {}) {
        return function(ev) {
            let floor = api.prefs.map.space.floor !== false;
            let value = ev.target.innerText;
            let onclick = (ev) => {
                let tempval = parseFloat($('tempval').value);
                api.modal.hide(modal.info.cancelled);
                if (modal.info.cancelled) {
                    return;
                }
                for (let g of api.selection.groups()) {
                    set(g, tempval, value);
                    if (floor && opt.floor !== false) {
                        g.floor(mesh.group);
                    }
                    defer_selection(); // update ui
                }
            };
            let onkeydown = (ev) => {
                if (ev.key === 'Enter') {
                    estop(ev);
                    onclick();
                }
            };
            let { tempval } = api.modal.show(title, h.div({ class: "tempedit" }, [
                h.input({ id: 'tempval', value, size: 10, onkeydown }),
                h.button({ _: 'set', onclick })
            ]));
            tempval.setSelectionRange(0, tempval.value.length);
            tempval.focus();
        }
    }

    // update model information dashboard (bottom)
    function update_selection() {
        let map = { fixed: 2 };
        let s_grp = selection.groups();
        let s_mdl = selection.models();
        if (s_mdl.length === 0) {
            return h.bind(selectlist, []);
        }
        // toggle-able stat block generator
        let sdata = {};
        function sblock(label, title, grid) {
            let map = sdata[label] = {
                hide: `${label}_hide`,
                show: `${label}_show`,
                data: `${label}_data`
            };
            return [
                h.button({ id: map.show, class: "side" }, [ h.div(label)] ),
                h.div({ id: map.data }, [
                    h.button({ id: map.hide, _: label, title }),
                    grid
                ])
            ];
        }
        // map selection to divs
        let g_pos = util.average(s_grp.map(g => g.object.position));
        let g_rot = util.average(s_grp.map(g => g.object.rotation));
        let g_id = s_grp.map(g => g.id).join(' ');
        let h_grp = sblock('group', g_id, grid(
            util.extract(g_pos, map),
            util.extract(g_rot).map(r => (r * rad).round(2).toFixed(map.fixed)),
            und, und, 'group'
        ));

        let m_pos = util.average(s_mdl.map(m => m.object.position));
        let m_rot = util.average(s_mdl.map(m => m.object.rotation));
        let m_id = s_mdl.map(m => m.id).join(' ');
        let h_mdl = sblock('model', m_id, grid(
            util.extract(m_pos, map),
            util.extract(m_rot, map)
        ));

        let bounds = util.bounds(s_mdl);
        let h_bnd = sblock('box', m_id, grid(
            util.extract(bounds.min, map),
            util.extract(bounds.max, map),
            [ "min", "max" ]
        ));
        let h_ara = sblock('span', m_id, grid(
            util.extract(bounds.center, map),
            util.extract(bounds.size, map),
            [ "center", "size" ], und, 'span'
        ));

        let t_vert = s_mdl.map(m => m.vertices).reduce((a,v) => a+v);
        let t_face = s_mdl.map(m => m.faces).reduce((a,v) => a+v);
        let h_msh = [h.div([
            h.button({ _: `mesh` }),
            h.div({ class: ["grid","grid2"]}, [
                h.div({ _: "" }),
                h.div({ _: "count", class: "top" }),
                h.div({ _: "vertex", class: "side" }),
                h.label({ _: util.comma(t_vert) }),
                h.div({ _: "face", class: "side" }),
                h.label({ _: util.comma(t_face) }),
            ])
        ])];
        // bind elements to selectlist div
        let bound = h.bind(selectlist, [
            ...h_grp,
            ...h_mdl,
            ...h_bnd,
            ...h_ara,
            ...h_msh
        ]);

        // bind rotation editable fields
        let { group_val_X_rot, group_val_Y_rot, group_val_Z_rot } = bound;
        [ group_val_X_rot, group_val_Y_rot, group_val_Z_rot ].forEach(e => {
            e.classList.add('editable');
        });
        group_val_X_rot.onclick = field_edit('x rotation', (group, val) => {
            let r = group.rotation();
            group.rotation(val/rad, r.y, r.z);
        });
        group_val_Y_rot.onclick = field_edit('y rotation', (group, val) => {
            let r = group.rotation();
            group.rotation(r.x, val/rad, r.z);
        });
        group_val_Z_rot.onclick = field_edit('z rotation', (group, val) => {
            let r = group.rotation();
            group.rotation(r.x, r.y, val/rad);
        });

        // bind position editable fields
        let { group_val_X_pos, group_val_Y_pos, group_val_Z_pos } = bound;
        [ group_val_X_pos, group_val_Y_pos, group_val_Z_pos ].forEach(e => {
            e.classList.add('editable');
        });
        group_val_X_pos.onclick = field_edit('x position', (group, val) => {
            let r = group.position();
            group.position(val, r.y, r.z);
        }, { floor: false });
        group_val_Y_pos.onclick = field_edit('y position', (group, val) => {
            let r = group.position();
            group.position(r.x, val, r.z);
        }, { floor: false });
        group_val_Z_pos.onclick = field_edit('z position', (group, val) => {
            let r = group.position();
            group.position(r.x, r.y, val);
        }, { floor: false });

        // bind scale editable fields
        let pedit = prefs.map.edit;
        let { span_val_X_size, span_val_Y_size, span_val_Z_size } = bound;
        [ span_val_X_size, span_val_Y_size, span_val_Z_size ].forEach(e => {
            e.classList.add('editable');
        });
        let axgrp = {};
        // activate axis grouping toggles
        [ "X", "Y", "Z" ].forEach(axis => {
            let prefkey = `scale_group_${axis}`;
            let agv = axgrp[axis] = pedit[prefkey];
            let lbl = bound[`span_lbl_${axis}`];
            lbl.classList.add('editable');
            if (agv) {
                lbl.classList.add('grouped');
            } else {
                bound[`span_lbl_${axis}`].classList.add('ungrouped');
            }
            lbl.onclick = () => {
                pedit[prefkey] = !agv;
                defer_selection(); // update ui
            };
        });
        span_val_X_size.onclick = field_edit('x size', (group, val, oval) => {
            let rel = val / parseFloat(oval);
            if (axgrp.X) {
                group.scale(rel, axgrp.Y ? rel : 1, axgrp.Z ? rel : 1);
            } else {
                group.scale(rel, 1, 1);
            }
        });
        span_val_Y_size.onclick = field_edit('y size', (group, val, oval) => {
            let rel = val / parseFloat(oval);
            if (axgrp.Y) {
                group.scale(axgrp.X ? rel : 1, rel, axgrp.Z ? rel : 1);
            } else {
                group.scale(1, rel, 1);
            }
        });
        span_val_Z_size.onclick = field_edit('z size', (group, val, oval) => {
            let rel = val / parseFloat(oval);
            if (axgrp.Z) {
                group.scale(axgrp.X ? rel : 1, axgrp.Y ? rel : 1, rel);
            } else {
                group.scale(1, 1, rel);
            }
        });

        let pmap = prefs.map.info;
        // map buttons to show/hide selection info
        function toggle(label, h, s, d) {
            s.onclick = () => {
                s.style.display = 'none';
                d.style.display = 'flex';
                prefs.save( pmap[label] = 'show' ); // <- :)
            };
            h.onclick = () => {
                d.style.display = 'none';
                s.style.display = 'flex';
                prefs.save( pmap[label] = 'hide' );
            };
            if (pmap[label] === 'show') {
                s.onclick();
            } else {
                h.onclick();
            }
        }
        for (let [label, map] of Object.entries(sdata)) {
            let { data, hide, show } = map;
            toggle(label, bound[hide], bound[show], bound[data]);
        }
    }

    // listen for api calls
    // create a deferred wrapper to merge multiple rapid events
    let defer_all = util.deferWrap(update_all);
    let defer_selector = util.deferWrap(update_selector);
    let defer_selection = util.deferWrap(update_selection);

    broker.listeners({
        model_add: defer_all,
        group_add: defer_all,
        model_remove: defer_all,
        group_remove: defer_all,
        selection_update: defer_all,
        selection_move: defer_selection,
        selection_scale: defer_selection,
        selection_rotate: defer_selection,
        selection_qrotate: defer_selection,
    });
}

})();
