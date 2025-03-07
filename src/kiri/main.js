/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function () {

    let MOTO    = self.moto,
        DATA    = self.data,
        KIRI    = self.kiri,
        LOAD    = self.load,
        BASE    = self.base,
        UTIL    = BASE.util,
        LANG    = KIRI.lang.current,
        WIN     = self.window,
        DOC     = self.document,
        LOC     = self.location,
        HOST    = LOC.host.split(':'),
        SETUP   = parseOpt(LOC.search.substring(1)),
        SECURE  = isSecure(LOC.protocol),
        LOCAL   = self.debug && !SETUP.remote,
        EVENT   = KIRI.broker = gapp.broker,
        SDB     = DATA.Local,
        ODB     = KIRI.odb = new DATA.Index(SETUP.d ? SETUP.d[0] : 'kiri'),
        // K3DB    = KIRI.wdb = new DATA.Index('kiri3', { stores:["file","work"] }).init(),
        SPACE   = KIRI.space = MOTO.Space,
        WIDGETS = KIRI.widgets = [],
        CATALOG = KIRI.catalog = KIRI.openCatalog(ODB),
        STATS   = new Stats(SDB),
        SEED    = 'kiri-seed',
        // ---------------
        CONF    = KIRI.conf,
        MODES   = CONF.MODES,
        VIEWS   = CONF.VIEWS,
        clone   = Object.clone,
        settings = clone(CONF.template),
        // ---------------
        Widget    = kiri.Widget,
        newWidget = kiri.newWidget,
        // ---------------
        UI = {},
        UC = KIRI.ui.prefix('kiri').inputAction(updateSettings),
        MODE = MODES.FDM,
        STACKS = KIRI.stacks,
        DRIVER = undefined,
        complete = {},
        selectedMeshes = [],
        localFilterKey ='kiri-gcode-filters',
        localFilters = js2o(SDB.getItem(localFilterKey)) || [],
        // ---------------
        viewMode = VIEWS.ARRANGE,
        local = SETUP.local,
        topZD = 0,
        topZ = 0,
        busy = 0,
        showFavorites = SDB.getItem('dev-favorites') === 'true',
        alerts = [],
        grouping = false,
        saveTimer = null,
        version = KIRI.version = gapp.version,
        noop = () => {};

    // add show() to catalog for API
    CATALOG.show = showCatalog;

    // patch broker for api backward compatibility
    EVENT.on = (topic, listener) => {
        EVENT.subscribe(topic, listener);
        return EVENT;
    };

    const PMODES = {
        SPEED: 1,
        TOOLS: 2
    };

    const feature = {
        seed: true, // seed profiles on first use
        meta: true, // show selected widget metadata
        alert_event: false, // emit alerts as events instead of display
        controls: true, // show or not side menus
        device_filter: undefined, // function to limit devices shown
        drop_group: undefined, // optional array to group multi drop
        drop_layout: true, // layout on new drop
        hover: false, // when true fires mouse hover events
        hoverAdds: false, // when true only searches widget additions
        on_key: undefined, // function override default key handlers
        on_load: undefined, // function override file drop loads
        on_add_stl: undefined, // legacy override stl drop loads
        work_alerts: true, // allow disabling work progress alerts
        modes: [ "fdm", "sla", "cam", "laser" ], // enable device modes
        pmode: PMODES.SPEED // preview modes
    };

    const selection = {
        opacity: setOpacity,
        move: moveSelection,
        scale: scaleSelection,
        rotate: rotateSelection,
        mirror: mirrorSelection,
        duplicate: duplicateSelection,
        meshes: function() { return selectedMeshes.slice() },
        widgets: function(orall) {
            let sel = selectedMeshes.slice().map(m => m.widget);
            return sel.length ? sel : orall ? WIDGETS.slice() : []
        },
        for_groups: forSelectedGroups,
        for_meshes: forSelectedMeshes,
        for_widgets: forSelectedWidgets,
        update_bounds: updateSelectedBounds,
        update_info: updateSelectedInfo,
        delete: function() { platform.delete(selection.widgets()) },
        export: exportSelection
    };

    const platform = {
        add: platformAdd,
        delete: platformDelete,
        layout: platformLayout,
        load: platformLoad,
        load_stl: platformLoadSTL,
        load_url: platformLoadURL,
        deselect: platformDeselect,
        select: platformSelect,
        select_all: platformSelectAll,
        selected_count: platformSelectedCount,
        compute_max_z: platformComputeMaxZ,
        update_origin: platformUpdateOrigin,
        update_bounds: platformUpdateBounds,
        update_size: platformUpdateSize,
        update_top_z: platformUpdateTopZ,
        update_selected: platformUpdateSelected,
        update_speeds: updateSpeeds,
        load_files: platformLoadFiles,
        group: platformGroup,
        group_done: platformGroupDone,
        update: SPACE.platform.update,
        set_font: SPACE.platform.setFont,
        show_axes: SPACE.platform.showAxes,
        show_volume: SPACE.platform.showVolume,
        top_z: () => { return topZ },
        clear: () => { clearWorkspace(); saveWorkspace(true)  }
    };

    const color = {
        wireframe: 0x444444,
        wireframe_opacity: 0.25,
        selected: [ 0xbbff00, 0xbbee00, 0xbbdd00, 0xbb9900 ],
        deselected: [ 0xffff00, 0xffdd00, 0xffbb00, 0xff9900 ],
        slicing: 0xffaaaa,
        preview_opacity: 0.0,
        model_opacity: 1.0,
        slicing_opacity: 0.5,
        sliced_opacity: 0.0,
        cam_preview: 0x0055bb,
        cam_preview_opacity: 0.25,
        cam_sliced_opacity: 0.25
    };

    const lists = {
        shell: [
            { name: "in-out" },
            { name: "out-in" },
        ],
        start: [
            { name: "last" },
            { name: "center" },
            { name: "origin" },
        ],
        infill: [
            { name: "hex" },
            { name: "grid" },
            // { name: "cubic" },
            { name: "linear" },
            { name: "triangle" },
            { name: "gyroid" },
            { name: "vase" }
        ],
        units: [
            { name: "mm" },
            { name: "in" }
        ],
        antialias: [
            { name: "1", id: 1 },
            { name: "2", id: 2 },
            { name: "4", id: 4 },
            { name: "8", id: 8 }
        ],
        detail: [
            { name: "100" },
            { name: "75" },
            { name: "50" },
            { name: "25" },
        ],
        linetype: [
            { name: "path" },
            { name: "flat" },
            { name: "line" }
        ],
        filasrc: [
            { name: "direct" },
            { name: "palette3" }
        ],
        animesh: [
            { name: "100" },
            { name: "200" },
            { name: "300" },
            { name: "400" },
            { name: "500" },
            { name: "600" },
            { name: "700" },
            { name: "800" },
            { name: "900" }
        ],
        trace: [
            { name: "follow" },
            { name: "clear" }
        ],
        traceoff: [
            { name: "center" },
            { name: "inside" },
            { name: "outside" }
        ],
        zanchor: [
            { name: "top" },
            { name: "middle" },
            { name: "bottom" }
        ],
        regaxis: [
            { name: "X" },
            { name: "Y" },
            { name: "-" }
        ],
        regpoints: [
            { name: "2" },
            { name: "3" }
        ],
    };

    const tweak = {
        line_precision: (v) => { API.work.config({base:{clipperClean: v}}) },
        gcode_decimals: (v) => { API.work.config({base:{gcode_decimals: v}}) }
    };

    const devel = {
        xray: (layers) => {
            let proc = API.conf.get().process;
            let size = proc.sliceHeight || 1;
            layers = Array.isArray(layers) ? layers : [ layers ];
            proc.xray = layers.map(l => l * size + size / 2);
            API.function.slice();
        }
    };

    const API = KIRI.api = {
        ui: UI,
        uc: UC,
        sdb: SDB,
        o2js: o2js,
        js2o: js2o,
        ajax: ajax,
        clone: clone,
        focus: () => {},
        stats: STATS,
        catalog: CATALOG,
        busy: {
            val: () => { return busy },
            inc: () => { kiri.api.event.emit("busy", ++busy) },
            dec: () => { kiri.api.event.emit("busy", --busy) }
        },
        conf: {
            dbo: () => { return ls2o('ws-settings') },
            get: getSettings,
            put: putSettings,
            load: loadSettings,
            save: saveSettings,
            show: showSettings,
            update: updateSettings,
            restore: restoreSettings,
            export: settingsExport,
            import: settingsImport
        },
        color,
        const: {
            SEED,
            LANG,
            LOCAL,
            MODES,
            VIEWS,
            SETUP,
            SECURE,
            STACKS,
            SPACE
        },
        devel,
        doit: {
            undo: noop, // set in do.js
            redo: noop  // set in do.js
        },
        var: {
            layer_lo: 0,
            layer_hi: 0,
            layer_max: 0
        },
        device: {
            code: currentDeviceCode,
            get: currentDeviceName,
            set: noop, // set during init
            clone: noop // set during init
        },
        dialog: {
            show: showModal,
            hide: hideModal
        },
        help: {
            show: showHelp,
            file: showHelpFile
        },
        event: {
            on: (t,l) => { return EVENT.on(t,l) },
            emit: (t,m,o) => { EVENT.publish(t,m,o) },
            bind: (t,m,o) => { return EVENT.bind(t,m,o) },
            import: loadFile,
            alerts: updateAlerts,
            settings: triggerSettingsEvent
        },
        feature,
        function: {
            slice: prepareSlices,
            print: preparePreview,
            prepare: preparePreview,
            animate: prepareAnimation,
            export: prepareExport,
            cancel: cancelWorker,
            clear: KIRI.client.clear,
            parse: loadCode
        },
        group: {
            merge: groupMerge,
            split: groupSplit,
        },
        hide: {
            alert: function(rec,recs) { alert2cancel(rec,recs) },
            import: function() { },
            slider: hideSlider
        },
        language: KIRI.lang,
        lists,
        modal: {
            show: showModal,
            hide: hideModal,
            visible: modalShowing
        },
        mode: {
            get_lower: getModeLower,
            get_id: function() { return MODE },
            get: getMode,
            set: setMode,
            switch: switchMode,
            set_expert: noop
        },
        probe: {
            live : "https://live.grid.space",
            grid : function() { return false },
            local : function() { return false }
        },
        process: {
            code: currentProcessCode,
            get: currentProcessName
        },
        platform,
        selection,
        show: {
            alert: alert2,
            devices: noop, // set during init
            progress: setProgress,
            controls: setControlsVisible,
            favorites: getShowFavorites,
            slices: showSlices,
            layer: setVisibleLayer,
            local: showLocal,
            import: function() { UI.import.style.display = '' }
        },
        space: {
            reload: reload,
            restore: restoreWorkspace,
            clear: clearWorkspace,
            save: saveWorkspace,
            set_focus: setFocus,
            update: SPACE.update
        },
        tweak,
        util: {
            isSecure,
            ui2rec: updateSettingsFromFields,
            rec2ui: updateFieldsFromSettings,
            download: downloadBlob,
            b64enc: obj => { return base64js.fromByteArray(new TextEncoder().encode(JSON.stringify(obj))) },
            b64dec: obj => { return JSON.parse(new TextDecoder().decode(base64js.toByteArray(obj))) }
        },
        view: {
            get: function() { return viewMode },
            set: setViewMode,
            update_slider: updateSlider,
            update_fields: updateFields,
            wireframe: setWireframe,
            snapshot: null,
            unit_scale: unitScale,
            isArrange: function() { return viewMode === VIEWS.ARRANGE }
        },
        widgets: {
            map: function() {
                let map = {};
                WIDGETS.forEach(widget => {
                    map[widget.id] = widget;
                });
                return map;
            },
            new: newWidget,
            all: () => { return WIDGETS.slice() },
            add: (widget) => { WIDGETS.push(widget) },
            filter: (fn) => { WIDGETS = WIDGETS.filter(fn) },
            for: forAllWidgets,
            load: Widget.loadFromCatalog,
            heal: healWidgets,
            replace: replaceVertices,
            meshes: meshArray,
            opacity: setOpacity,
            annotate: (id) => {
                let w = WIDGETS.filter(w => w.id === id)[0];
                if (!w) {
                    console.log(`annotate missing widget ${id}`);
                    return {};
                }
                return (w.anno = w.anno || {});
            }
        },
        work: KIRI.work
    };

    function setFocus(widgets, point) {
        if (point) {
            SPACE.platform.setCenter(point.x, point.z, point.y);
            SPACE.view.setFocus(new THREE.Vector3(point.x, point.y, point.z));
            return;
        }
        if (widgets === undefined) {
            widgets = WIDGETS;
        } else if (!Array.isArray) {
            widgets = [ widgets ];
        } else if (widgets.length === 0) {
            widgets = WIDGETS;
        }
        let pos = { x:0, y:0, z:0 };
        for (let widget of widgets) {
            pos.x += widget.track.pos.x;
            pos.y += widget.track.pos.y;
            pos.z += widget.track.pos.z;
        }
        if (widgets.length) {
            pos.x /= widgets.length;
            pos.y /= widgets.length;
            pos.z /= widgets.length;
        }
        SPACE.platform.setCenter(pos.x, -pos.y, topZ / 2);
        SPACE.view.setFocus(new THREE.Vector3(pos.x, topZ / 2, -pos.y));
    }

    function reload() {
        API.event.emit('reload');
        do_reload(100);
    }

    function do_reload(time) {
        // allow time for async saves to complete and busy to to to zero
        setTimeout(() => {
            if (busy === 0) {
                LOC.reload();
            } else {
                console.log(`reload deferred on busy=${busy}`);
                do_reload(250);
            }
        }, time || 100);
    }

    function auto_save() {
        if (!settings.controller.autoSave) {
            return;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            API.space.save(true);
        }, 1000);
    }

    // frame message api
    WIN.addEventListener('message', msg => {
        let { origin, source, target, data } = msg;
        if (source.window === target.window) return;
        let send = source.window.postMessage;
        if (data.mode) { API.mode.set(data.mode.toUpperCase()) }
        if (data.view) { API.view.set(VIEWS[data.view.toUpperCase()]) }
        if (data.function) { API.function[data.function.toLowerCase()]() }
        if (data.event) {
            API.event.on(data.event, (evd) => {
                send({event: data.event, data: evd});
            });
        }
        if (data.emit) API.event.emit(data.emit, data.message)
        if (data.get) switch (data.get) {
            case "mode": send({mode: settings.mode}); break;
            case "device": send({device: settings.device}); break;
            case "process": send({process: settings.process}); break;
            default: send({all: settings}); break;

        }
        if (data.set) switch (data.set) {
            case "features":
                Object.assign(feature, data.features);
                break;
            case "device":
                Object.assign(settings.device, data.options);
                saveSettings();
                break;
            case "process":
                Object.assign(settings.process, data.options);
                saveSettings();
                break;
        }
        if (data.parse) {
            new load.STL().parse(data.parse, vertices => {
                let widget = newWidget().loadVertices(vertices);
                platform.add(widget);
            });
        }
        if (data.load) platformLoad(data.load);
        if (data.clear) platform.clear();
        if (data.alert) alert2(data.alert, data.time);
        if (data.progress >= 0) setProgress(data.progress, data.message);
    });

    /** ******************************************************************
     * Stats accumulator
     ******************************************************************* */

    function Stats(db) {
        this.db = db;
        this.obj = js2o(this.db['stats'] || '{}');
        let o = this.obj, k;
        for (k in o) {
            if (!o.hasOwnProperty(k)) continue;
            if (['dn','lo','re'].indexOf(k) >= 0 || k.indexOf('-') > 0 || k.indexOf('_') > 0) {
                delete o[k];
            }
        }
    }

    Stats.prototype.save = function(quiet) {
        this.db['stats'] = o2js(this.obj);
        if (!quiet) {
            API.event.emit('stats', this.obj);
        }
        return this;
    };

    Stats.prototype.get = function(k) {
        return this.obj[k];
    };

    Stats.prototype.set = function(k,v,quiet) {
        this.obj[k] = v;
        this.save(quiet);
        return this;
    };

    Stats.prototype.add = function(k,v,quiet) {
        this.obj[k] = (this.obj[k] || 0) + (v || 1);
        this.save(quiet);
        return this;
    };

    Stats.prototype.del = function(k, quiet) {
        delete this.obj[k];
        this.save(quiet);
        return this;
    };

    let inits = parseInt(SDB.getItem('kiri-init') || STATS.get('init') || 0) + 1;
    SDB.setItem('kiri-init', inits);

    STATS.set('init', inits);
    STATS.set('kiri', kiri.version);

    // remove version from url, preserve other settings
    WIN.history.replaceState({},'','/kiri/' + encodeOpt(SETUP) + LOC.hash);

    /** ******************************************************************
     * Utility Functions
     ******************************************************************* */

    function unitScale() {
        return MODE === MODES.CAM && settings.controller.units === 'in' ? 25.4 : 1;
    }

    function alert2(message, time) {
        if (message === undefined || message === null) {
            return updateAlerts(true);
        }
        let rec = [message, Date.now(), time, true];
        if (feature.alert_event) {
            API.event.emit('alert', rec);
        } else {
            alerts.push(rec);
            updateAlerts();
        }
        return rec;
    }

    function alert2cancel(rec,recs) {
        if (Array.isArray(recs)) {
            for (let r of recs) {
                alert2cancel(r);
            }
            return;
        }
        if (feature.alert_event) {
            API.event.emit('alert.cancel', rec);
            return;
        }
        if (Array.isArray(rec)) {
            rec[3] = false;
            updateAlerts();
        }
    }

    function updateAlerts(clear) {
        if (clear) {
            alerts = [];
        }
        let now = Date.now();
        // filter out by age and active flag
        alerts = alerts.filter(alert => {
            return alert[3] && (now - alert[1]) < ((alert[2] || 5) * 1000);
        });
        // limit to 5 showing
        while (alerts.length > 5) {
            alerts.shift();
        }
        // return if called before UI configured
        if (!UI.alert) {
            return;
        }
        if (alerts.length > 0) {
            UI.alert.text.innerHTML = alerts.map(v => ['<p>',v[0],'</p>'].join('')).join('');
            UI.alert.dialog.style.display = 'flex';
        } else {
            UI.alert.dialog.style.display = 'none';
        }
    }

    function getShowFavorites(bool) {
        if (bool !== undefined) {
            SDB.setItem('dev-favorites', bool);
            showFavorites = bool;
            return bool;
        }
        return showFavorites;
    }

    function triggerSettingsEvent() {
        API.event.emit('settings', settings);
    }

    function isSecure(proto) {
         return proto.toLowerCase().indexOf("https") === 0;
    }

    function parseOpt(ov) {
        let opt = {}, kv, kva;
        // handle kiri legacy and proper url encoding better
        ov.replace(/&/g,',').split(',').forEach(function(el) {
            kv = decodeURIComponent(el).split(':');
            if (kv.length === 2) {
                kva = opt[kv[0]] = opt[kv[0]] || [];
                kva.push(decodeURIComponent(kv[1]));
            }
        });
        return opt;
    }

    function encodeOpt(opt) {
        let out = [];
        Object.keys(opt).forEach(key => {
            if (key === 'ver') return;
            let val = opt[key];
            out.push(encodeURIComponent(key) + ":" + encodeURIComponent(val));
        });
        return out.length ? '?' + out.join(',') : '';
    }

    function ajax(url, fn, rt, po, hd) {
        return new MOTO.Ajax(fn, rt).request(url, po, hd);
    }

    function o2js(o,def) {
        return o ? JSON.stringify(o) : def || null;
    }

    function js2o(s,def) {
        try {
            return s ? JSON.parse(s) : def || null;
        } catch (e) {
            console.log({malformed_json:s});
            return def || null;
        }
    }

    function ls2o(key,def) {
        return js2o(SDB.getItem(key),def);
    }

    function setProgress(value, msg) {
        if (value) {
            value = UTIL.round(value*100,4);
            UI.loading.display = 'block';
            UI.progress.width = value+'%';
            if (msg) UI.prostatus.innerHTML = msg;
        } else {
            UI.loading.display = 'none';
        }
    }

    function bound(v,min,max) {
        return Math.max(min,Math.min(max,v));
    }

    function getOverlappingRanges(lo, hi) {
        let ranges = [];
        for (let range of settings.process.ranges || []) {
            let in_lo = range.lo >= lo && range.lo <= hi;
            let in_hi = range.hi >= lo && range.hi <= hi;
            if (in_lo || in_hi) {
                ranges.push(range);
            }
        }
        return ranges;
    }

    // set process override values for a range
    function updateRange(lo, hi, values, add) {
        let ranges = settings.process.ranges;
        let slices = {};
        let min = lo;
        let max = hi;

        // special case for belt loops which should not be flattened
        if (values.outputLoops) {
            ranges.push({
                lo, hi, fields: values
            });
            updateFieldsFromSettings(settings.process);
            API.show.alert("update ranges", 2);
            API.event.emit("range.updates", ranges);
            return;
        }

        // just remove values from matching ranges
        if (!add) {
            for (let range of getOverlappingRanges(lo, hi)) {
                for (let key of Object.keys(values)) {
                    delete range.fields[key];
                }
                if (Object.keys(range.fields).length === 0) {
                    let pos = ranges.indexOf(range);
                    if (pos >= 0) {
                        ranges.splice(pos,1);
                    }
                }
            }
            API.event.emit("range.updates", ranges);
            return;
        }

        // set aside belt loops and re-append later
        // since we do not want to collapse/merge loops
        let exclude = ranges.filter(r => r.fields.outputLoops);
        ranges = ranges.filter(r => !r.fields.outputLoops);

        // flatten ranges
        ranges.push({lo, hi, fields: values});
        for (let range of ranges) {
            min = Math.min(range.lo, min);
            max = Math.max(range.hi, max);
            for (let i=range.lo; i<=range.hi; i++) {
                let slice = slices[i];
                if (!slice) {
                    slice = slices[i] = {};
                }
                for (let [key,val] of Object.entries(range.fields)) {
                    slice[key] = val;
                }
            }
        }

        // merge contiguous matching ranges
        ranges = settings.process.ranges = [];
        let range;
        for (let i=min; i<=max; i++) {
            let slice = slices[i];
            if (slice && !range) {
                range = {lo: i, hi: i, fields: slice};
            } else if (slice && range && isEquals(range.fields, slice)) {
                range.hi = i;
            } else if (range) {
                ranges.push(range);
                if (slice) {
                    range = {lo: i, hi: i, fields: slice};
                } else {
                    range = undefined;
                }
            }
        }

        ranges.push(range);
        ranges.appendAll(exclude);

        updateFieldsFromSettings(settings.process);
        API.show.alert("update ranges", 2);
        API.event.emit("range.updates", ranges);
    }

    let overrides = {};

    // updates editable fields that are range dependent
    function updateFieldsFromRange() {
        return;
        if (settings.mode !== 'FDM' || viewMode !== VIEWS.SLICE || !settings.process.ranges) {
            let okeys = Object.keys(overrides);
            if (okeys.length) {
                updateFieldsFromSettings(overrides);
                overrides = {};
            }
            return;
        }
        let match = 0;
        let values = {};
        let restores = Object.clone(overrides);
        let { layer_lo, layer_hi } = API.var;
        for (let range of getOverlappingRanges(API.var.layer_lo, API.var.layer_hi)) {
            for (let key of Object.keys(range.fields)) {
                values[key] = range.fields[key];
                overrides[key] = settings.process[key];
                delete restores[key];
                match++;
            }
        }
        if (match) {
            updateFieldsFromSettings(values);
        }
        let rkeys = Object.keys(restores);
        if (rkeys.length) {
            updateFieldsFromSettings(restores);
            for (let key of rkeys) {
                delete overrides[key];
            }
        }
        UC.refresh();
    }

    function updateSlider() {
        API.event.emit("slider.set", {
            start: (API.var.layer_lo / API.var.layer_max),
            end: (API.var.layer_hi / API.var.layer_max)
        });
        updateFieldsFromRange();
    }

    function setVisibleLayer(h, l) {
        h = h >= 0 ? h : API.var.layer_hi;
        l = l >= 0 ? l : API.var.layer_lo;
        API.var.layer_hi = bound(h, 0, API.var.layer_max);
        API.var.layer_lo = bound(l, 0, h);
        API.event.emit("slider.label");
        updateSlider();
        showSlices();
    }

    function meshArray() {
        let out = [];
        forAllWidgets(function(widget) {
            if (!feature.hoverAdds) {
                out.push(widget.mesh);
            }
            out.appendAll(widget.adds);
        });
        return out;
    }

    function replaceVertices(vertices) {
        let widgets = API.selection.widgets(true);
        if (!widgets.length) {
            return;
        }
        function onload(vertices) {
            for (let w of widgets) {
                let track = Object.clone(w.track);
                let { scale, rot, pos } = track;
                let roto = w.roto.slice();
                w.loadVertices(vertices);
                for (let m of roto) {
                    w.mesh.geometry.applyMatrix4(m.clone());
                }
                w._scale(scale.x, scale.y, scale.z);
            }
            platform.update();
        }
        if (vertices) {
            onload(vertices);
        } else {
            // dialog
            $('load-file').onchange = function(event) {
                LOAD.File.load(event.target.files[0])
                    .then(data => onload(data[0].mesh))
                    .catch(error => console.log({error}));
            };
            $('load-file').click();
        }
    }

    function healWidgets() {
        let widgets = API.widgets.all();
        let marker;
        if (widgets.length) {
            marker = API.show.alert("Analyzing objects", 100000);
        } else {
            return;
        }
        setTimeout(() => {
            Promise.all(widgets.map(w => w.heal())).then(mod => {
                API.hide.alert(marker);
                let healed = mod.filter(m => m).length;
                if (healed) {
                    API.show.alert(`${healed} Object${healed ? 's':''} healed`);
                } else {
                    API.show.alert('Nothing found to heal');
                }
            });
        }, 1);
    }

    function forAllWidgets(f) {
        WIDGETS.slice().forEach(function(widget) {
            f(widget);
        });
    }

    function forSelectedGroups(f) {
        let groups = API.selection.widgets(true).map(w => w.group).uniq();
        for (let group of groups) {
            f(group[0]);
        }
    }

    function forSelectedWidgets(f,noauto) {
        let m = selectedMeshes;
        if (m.length === 0 && WIDGETS.length === 1) {
            m = noauto ? [] : [ WIDGETS[0].mesh ];
        }
        m.slice().forEach(function (mesh) { f(mesh.widget) });
    }

    function forSelectedMeshes(f) {
        selectedMeshes.slice().forEach(function (mesh) { f(mesh) });
    }

    function setWireframe(bool, color, opacity) {
        forAllWidgets(function(w) { w.setWireframe(bool, color, opacity) });
        SPACE.update();
    }

    function updateSliderMax(set) {
        let max = STACKS.getRange().tallest - 1;
        API.var.layer_max = UI.sliderMax.innerText = max;
        if (set || max < API.var.layer_hi) {
            API.var.layer_hi = API.var.layer_max;
            API.event.emit("slider.label");
            updateSlider();
        }
    }

    function hideSlices() {
        STACKS.clear();
        setOpacity(color.model_opacity);
        forAllWidgets(function(widget) {
            widget.setWireframe(false);
        });
    }

    function setWidgetVisibility(bool) {
        forAllWidgets(w => {
            if (bool) {
                w.show();
            } else {
                w.hide();
            }
        });
    }

    /**
     * hide or show slice-layers and their sub-elements
     *
     * @param {number} [layer]
     */
    function showSlices(layer) {
        if (viewMode === VIEWS.ARRANGE) {
            return;
        }

        showSlider();

        if (typeof(layer) === 'string' || typeof(layer) === 'number') {
            layer = parseInt(layer);
        } else {
            layer = API.var.layer_hi;
        }

        layer = bound(layer, 0, API.var.layer_max);
        if (layer < API.var.layer_lo) API.var.layer_lo = layer;
        API.var.layer_hi = layer;
        API.event.emit("slider.label");

        let cam = MODE === MODES.CAM,
            sla = MODE === MODES.SLA,
            hi = cam ? API.var.layer_max - API.var.layer_lo : API.var.layer_hi,
            lo = cam ? API.var.layer_max - API.var.layer_hi : API.var.layer_lo;

        updateSlider();
        STACKS.setRange(API.var.layer_lo, API.var.layer_hi);

        SPACE.update();
    }

    function cancelWorker() {
        if (KIRI.work.isBusy()) {
            KIRI.work.restart();
        }
    }

    function showSlider() {
        UI.layers.style.display = 'flex';
        UI.slider.style.display = 'flex';
    }

    function hideSlider(andmenu) {
        UI.layers.style.display = 'none';
        UI.slider.style.display = 'none';
        UI.speeds.style.display = 'none';
    }

    function updateSpeeds(maxSpeed, minSpeed) {
        UI.speeds.style.display =
            maxSpeed &&
            settings.mode !== 'SLA' &&
            settings.mode !== 'LASER' &&
            viewMode === VIEWS.PREVIEW &&
            UI.showSpeeds.checked ? 'block' : '';
        if (maxSpeed) {
            const colors = [];
            for (let i=0; i<= maxSpeed; i += maxSpeed/20) {
                colors.push(Math.round(Math.max(i,1)));
            }
            KIRI.client.colors(colors, maxSpeed, speedColors => {
                const list = [];
                Object.keys(speedColors).map(v => parseInt(v)).sort((a,b) => b-a).forEach(speed => {
                    const color = speedColors[speed];
                    const hex = color.toString(16).padStart(6,0);
                    const r = (color >> 16) & 0xff;
                    const g = (color >>  8) & 0xff;
                    const b = (color >>  0) & 0xff;
                    const style = `background-color:#${hex}`;
                    list.push(`<label style="${style}">${speed}</label>`);
                });
                UI.speedbar.innerHTML = list.join('');
            });
            API.event.emit('preview.speeds', {min: minSpeed, max: maxSpeed});
        }
    }

    function prepareSlices(callback, scale = 1, offset = 0) {
        if (viewMode == VIEWS.ARRANGE) {
            let snap = SPACE.screenshot();
            API.view.snapshot = snap.substring(snap.indexOf(",") + 1);
            KIRI.work.snap(SPACE.screenshot2({width: 640}));
        }
        if (MODE === MODES.SLA && !callback) {
            callback = preparePreview;
        }

        // force layout in belt mode when widget exceeds bed length
        if (WIDGETS.length && settings.device.bedBelt) {
            let doLayout = false;
            for (let w of WIDGETS) {
                let bb = w.getBoundingBox();
                let yspan = bb.max.y - bb.min.y;
                if (yspan > settings.device.bedDepth) {
                    doLayout = true;
                }
            }
            if (doLayout) {
                platformLayout();
            }
        }

        let process = settings.process,
            device = settings.device,
            isBelt = device.bedBelt,
            mode = settings.mode,
            now = Date.now(),
            totvert = 0,
            track = {},
            totalProgress;

        // clear completion marks
        complete = {};

        hideSlider(true);
        platform.deselect();
        setViewMode(VIEWS.SLICE);

        API.conf.save();
        API.event.emit('slice.begin', getMode());

        let slicing = WIDGETS.slice().filter(w => !w.track.ignore);

        // determing this widgets % of processing time estimated by vertex count
        for (let widget of slicing) {
            totvert += widget.getVertices().count;
        }
        let defvert = totvert / slicing.length;

        setOpacity(color.slicing_opacity);

        let segtimes = {},
            segNumber = 0,
            errored = false,
            startTime = Date.now(),
            toSlice = slicing.slice(),
            camOrLaser = mode === 'CAM' || mode === 'LASER',
            extruders = {},
            lastMsg;

        for (let widget of toSlice) {
            widget.stats.progress = 0;
            widget.setColor(color.slicing);
            extruders[widget.anno.extruder] = widget.anno.extruder;
        }

        // in multi-material belt mode, the anchor needs to be extended
        // to allow room for the purge tower to be built. calculate here
        extruders = Object.values(extruders);
        if (isBelt && extruders.length > 1 && process.outputPurgeTower) {
            process.beltAnchor = Math.max(
                process.firstLayerBeltLead,
                Math.sqrt(process.outputPurgeTower) * extruders.length * (1/Math.sqrt(2)));
        } else {
            process.beltAnchor = process.firstLayerBeltLead;
        }

        STACKS.clear();
        if (isBelt) {
            KIRI.client.clear();
        }
        KIRI.client.sync();
        KIRI.client.rotate(settings);

        sliceNext();

        function sliceNext() {
            if (toSlice.length) {
                sliceWidget(toSlice.shift())
            } else {
                KIRI.client.sliceAll(settings, sliceDone);
            }
        }

        function sliceWidget(widget) {
            widget.stack = STACKS.create(widget.id, widget.mesh);
            let factor = (widget.getVertices().count / defvert);

            // compensate for zcut (widget moved through floor)
            widget.stack.obj.view.position.z = widget.track.zcut || 0;

            widget.slice(settings, function(sliced, error) {
                widget.rotinfo = null;
                let mark = Date.now();
                // update UI info
                if (sliced) {
                    // update segment time
                    if (lastMsg) {
                        segtimes[`${widget.id}_${segNumber++}_${lastMsg}`] = mark - startTime;
                    }
                    API.event.emit('slice', getMode());
                }
                // handle slicing errors
                if (error && !errored) {
                    errored = true;
                    setViewMode(VIEWS.ARRANGE);
                    alert2(error, 5);
                    API.show.progress(0);
                    KIRI.client.restart();
                    API.event.emit('slice.error', error);
                }
                if (errored) {
                    // terminate slicing
                    sliceDone();
                } else {
                    // start next widget slice
                    sliceNext();
                }
            }, function(update, msg) {
                if (msg && msg !== lastMsg) {
                    let mark = Date.now();
                    if (lastMsg) {
                        segtimes[`${widget.id}_${segNumber++}_${lastMsg}`] = mark - startTime;
                    }
                    lastMsg = msg;
                    startTime = mark;
                }
                // on update
                track[widget.id] = (update || 0) * factor;
                totalProgress = 0;
                for (let w of slicing) {
                    totalProgress += (track[w.id] || 0);
                }
                API.show.progress(offset + (totalProgress / WIDGETS.length) * scale, msg);
            });
        }

        function sliceDone() {
            let alert = null;
            if (scale === 1 && feature.work_alerts && slicing.length) {
                alert = API.show.alert("Rendering");
            };
            KIRI.client.unrotate(settings, () => {
                for (let widget of slicing) {
                    // on done
                    segtimes[`${widget.id}_${segNumber++}_draw`] = widget.render(widget.stack);
                    // rotate stack for belt beds
                    if (widget.rotinfo) {
                        widget.stack.obj.rotate(widget.rotinfo);
                    }
                    if (scale === 1) {
                        // clear wireframe
                        widget.setWireframe(false, color.wireframe, color.wireframe_opacity);
                        widget.setOpacity(camOrLaser ? color.cam_sliced_opacity : color.sliced_opacity);
                        widget.setColor(color.deselected);
                        API.hide.alert(alert);
                    }
                }
                updateSliderMax(true);
                setVisibleLayer(-1, 0);
                if (scale === 1) {
                    updateStackLabelState();
                }
            });
            if (scale === 1) {
                API.show.progress(0);
            }
            // cause visuals to update
            SPACE.scene.active();
            // mark slicing complete for prep/preview
            complete.slice = true;
            API.event.emit('slice.end', getMode());
            // print stats
            segtimes.total = Date.now() - now;
            console.log(segtimes);
            if (callback && typeof callback === 'function') {
                callback();
            }
        }
    }

    function preparePreview(callback, scale = 1, offset = 0) {
        if (complete.preview === feature.pmode) {
            if (settings.device.extruders.length > 1) {
                if (++feature.pmode > 2) {
                    feature.pmode = 1;
                }
            } else {
                if (callback) callback();
                return;
            }
        }
        if (!complete.slice) {
            settings.render = false;
            prepareSlices(() => {
                preparePreview(callback, 0.25, 0.75);
            }, 0.75);
            return;
        }

        hideSlider(true);

        let isCam = MODE === MODES.CAM, pMode = getMode();

        setViewMode(VIEWS.PREVIEW);
        API.conf.save();
        API.event.emit('preview.begin', pMode);

        if (isCam) {
            setOpacity(color.cam_preview_opacity);
            forAllWidgets(function(widget) {
                widget.setColor(color.cam_preview);
            });
        } else if (offset === 0) {
            setOpacity(color.preview_opacity);
        }

        let now = Date.now(),
            segNumber = 0,
            segtimes = {},
            startTime,
            lastMsg,
            output = [];

        // pass preview mode to worker
        settings.pmode = feature.pmode;
        settings.render = true;

        KIRI.client.prepare(settings, function(progress, message, layer) {
            if (layer) {
                output.push(KIRI.codec.decode(layer));
            }
            if (message && message !== lastMsg) {
                let mark = Date.now();
                if (lastMsg) {
                    segtimes[`${segNumber++}_${lastMsg}`] = mark - startTime;
                }
                lastMsg = message;
                startTime = mark;
            }
            API.show.progress(offset + progress * scale, message);
        }, function (reply, maxSpeed, minSpeed) {
            // handle worker errors
            if (reply && reply.error) {
                alert2(reply.error, 5);
                setViewMode(VIEWS.ARRANGE);
                API.event.emit('preview.error', reply.error);
                API.show.progress(0);
                SPACE.update();
                return;
            }

            if (lastMsg) {
                segtimes[`${segNumber++}_${lastMsg}`] = Date.now() - startTime;
            }

            API.show.progress(0);
            if (!isCam) setOpacity(0);

            if (output.length) {
                let alert = feature.work_alerts ? API.show.alert("Rendering") : null;
                startTime = Date.now();
                STACKS.clear();
                const stack = STACKS.create('print', SPACE.world)
                output.forEach(layer => {
                    stack.add(layer);
                });
                // rotate stack for belt beds
                if (settings.device.bedBelt && WIDGETS[0].rotinfo) {
                    let ri = WIDGETS[0].rotinfo;
                    ri.dz = 0;
                    ri.dy = settings.device.bedDepth / 2;
                    stack.obj.rotate(WIDGETS[0].rotinfo);
                }
                API.hide.alert(alert);
                segtimes[`${segNumber}_draw`] = Date.now() - startTime;
            }

            // print stats
            segtimes.total = Date.now() - now;
            console.log(segtimes);

            API.event.emit('print', pMode);
            API.event.emit('preview.end', pMode);

            SPACE.update();
            updateSliderMax(true);
            setVisibleLayer(-1, 0);
            if (feature.pmode === PMODES.SPEED) {
                updateSpeeds(maxSpeed, minSpeed);
            } else {
                updateSpeeds();
            }
            updateStackLabelState();

            // mark preview complete for export
            complete.preview = feature.pmode;

            if (typeof(callback) === 'function') {
                callback();
            }
        });
    }

    function prepareAnimation() {
        API.event.emit("function.animate", {mode: settings.mode});
    }

    function prepareExport() {
        const argsave = arguments;
        if (!complete.preview) {
            preparePreview(() => {
                prepareExport(...argsave);
            });
            return;
        }
        API.event.emit("function.export", {mode: settings.mode});
        complete.export = true;
        KIRI.export(...argsave);
    }

    function updateStackLabelState() {
        // match label checkboxes to preference
        for (let label of STACKS.getLabels()) {
            let check = `${settings.mode}-${viewMode}-${label}`;
            STACKS.setVisible(label, settings.labels[check] !== false);
        }
    }

    function loadCode(code, type) {
        API.event.emit("code.load", {code, type});
        setViewMode(VIEWS.PREVIEW);
        setOpacity(0);
        KIRI.client.parse({code, type, settings}, progress => {
            API.show.progress(progress, "parsing");
        }, (layers, maxSpeed, minSpeed) => {
            API.show.progress(0);
            STACKS.clear();
            const stack = STACKS.create('parse', SPACE.world);
            layers.forEach(layer => stack.add(layer));
            updateSliderMax(true);
            updateSpeeds(maxSpeed, minSpeed);
            showSlices();
            updateStackLabelState();
            SPACE.update();
            API.event.emit("code.loaded", {code, type});
        });
    }

    function loadImageDialog(image, name, force) {
        if (!force && image.byteLength > 2500000) {
            return UC.confirm("Large images may fail to import<br>Consider resizing under 1000 x 1000<br>Proceed with import?").then(ok => {
                if (ok) {
                    loadImageDialog(image, name, true);
                }
            });
        }
        const opt = {pre: [
            "<div class='f-col a-center'>",
            "  <h3>Image Conversion</h3>",
            "  <p class='t-just' style='width:300px;line-height:1.5em'>",
            "  This will create a 3D model from a 2D PNG image. Photos must",
            "  be blurred to be usable. Values from 0=off to 50=high are suggested.",
            "  Higher values incur more processing time.",
            "  </p>",
            "  <div class='f-row t-right'><table>",
            "  <tr><th>blur value</th><td><input id='png-blur' value='0' size='3'></td>",
            "      <th>&nbsp;invert image</th><td><input id='png-inv' type='checkbox'></td></tr>",
            "  <tr><th>base size</th><td><input id='png-base' value='0' size='3'></td>",
            "      <th>&nbsp;invert alpha</th><td><input id='alpha-inv' type='checkbox'></td></tr>",
            "  <tr><th>border size</th><td><input id='png-border' value='0' size='3'></td>",
            "      <th></th><td></td></tr>",
            "  </table></div>",
            "</div>"
        ]};
        UC.confirm(undefined, {convert:true, cancel:false}, undefined, opt).then((ok) => {
            if (ok) {
                loadImage(image, {
                    file: name,
                    blur: parseInt($('png-blur').value) || 0,
                    base: parseInt($('png-base').value) || 0,
                    border: parseInt($('png-border').value) || 0,
                    inv_image: $('png-inv').checked,
                    inv_alpha: $('alpha-inv').checked
                });
            }
        });
    }

    function loadImage(image, opt = {}) {
        let info = Object.assign({settings, png:image}, opt);
        KIRI.client.image2mesh(info, progress => {
            API.show.progress(progress, "converting");
        }, output => {
            API.show.progress(0);
            let {bigv, verts, index} = output;
            // let mat = new THREE.MeshPhongMaterial({
            //     shininess: 0x101010,
            //     specular: 0x101010,
            //     transparent: true,
            //     opacity: 1,
            //     color: 0x999999,
            //     side: THREE.DoubleSide
            // });
            //
            // let geo = new THREE.BufferGeometry();
            // geo.setAttribute('position', new THREE.BufferAttribute(bigv, 3));
            // // geo.setIndex([...index]); // doesn't like the Uint32Array
            // geo.computeFaceNormals();
            // geo.computeVertexNormals();
            //
            // let mesh = new THREE.Mesh(geo, mat);
            // mesh.castShadow = true;
            // mesh.receiveShadow = true;
            //
            // SPACE.world.add(mesh);
            let widget = newWidget().loadVertices(bigv)
            widget.meta.file = opt.file;
            platform.add(widget);
        });
    }

    /** ******************************************************************
     * Selection Functions
     ******************************************************************* */

    function groupMerge() {
        Widget.Groups.merge(API.selection.widgets(true));
    }

    function groupSplit() {
        Widget.Groups.split(API.selection.widgets(false));
    }

    function updateSelectedInfo() {
        let bounds = new THREE.Box3(), track;
        forSelectedMeshes(mesh => {
            bounds = bounds.union(mesh.getBoundingBox());
            track = mesh.widget.track;
        });
        if (bounds.min.x === Infinity) {
            if (selectedMeshes.length === 0) {
                UI.sizeX.value = 0;
                UI.sizeY.value = 0;
                UI.sizeZ.value = 0;
                UI.scaleX.value = 1;
                UI.scaleY.value = 1;
                UI.scaleZ.value = 1;
            }
            return;
        }
        let dx = bounds.max.x - bounds.min.x,
            dy = bounds.max.y - bounds.min.y,
            dz = bounds.max.z - bounds.min.z,
            scale = unitScale();
        UI.sizeX.value = UI.sizeX.was = (dx / scale).round(2)
        UI.sizeY.value = UI.sizeY.was = (dy / scale).round(2)
        UI.sizeZ.value = UI.sizeZ.was = (dz / scale).round(2)
        UI.scaleX.value = UI.scaleX.was = track.scale.x.round(2);
        UI.scaleY.value = UI.scaleY.was = track.scale.y.round(2);
        UI.scaleZ.value = UI.scaleZ.was = track.scale.z.round(2);
        updateSelectedBounds();
    }

    function fitDeviceToWidgets() {
        let maxy = 0;
        forAllWidgets(function(widget) {
            let wb = widget.mesh.getBoundingBox().clone();
            maxy = Math.max(maxy, wb.max.y - wb.min.y);
        });
        let dev = settings.device;
        if (maxy > dev.bedDepth) {
            dev.bedDepthSave = dev.bedDepth;
            dev.bedDepth = maxy + 10;
            SPACE.platform.setSize(
                parseInt(dev.bedWidth),
                parseInt(dev.bedDepth),
                parseFloat(dev.bedHeight),
                parseFloat(dev.maxHeight)
            );
            SPACE.platform.update();
            return true;
        }
    }

    function updateSelectedBounds(widgets) {
        // update bounds on selection for drag limiting
        let isBelt = settings.device.bedBelt;
        if (isBelt) {
            if (fitDeviceToWidgets()) {
                platform.update_origin();
                SPACE.update();
            }
        }
        let dvy = settings.device.bedDepth;
        let dvx = settings.device.bedWidth;
        let bounds_sel = new THREE.Box3();
        if (!widgets) {
            widgets = selectedMeshes.map(m => m.widget);
        }
        for (let widget of widgets) {
            let wp = widget.track.pos;
            let bx = widget.track.box;
            let miny = wp.y - bx.h/2 + dvy/2;
            let maxy = wp.y + bx.h/2 + dvy/2;
            let minx = wp.x - bx.w/2 + dvx/2;
            let maxx = wp.x + bx.w/2 + dvx/2;

            // keep widget in bounds when rotated or scaled
            let ylo = miny < 0;
            let yhi = !isBelt && maxy > dvy
            if (ylo && !yhi) {
                widget.move(0, -miny, 0);
            } else if (yhi && !ylo) {
                widget.move(0, dvy - maxy, 0);
            }
            let xlo = minx < 0;
            let xhi = maxx > dvx;
            if (xlo && !xhi) {
                widget.move(-minx, 0, 0);
            } else if (xhi && !xlo) {
                widget.move(dvx - maxx, 0, 0);
            }

            let wb = widget.mesh.getBoundingBox().clone();
            wb.min.x += wp.x;
            wb.max.x += wp.x;
            wb.min.y += wp.y;
            wb.max.y += wp.y;
            bounds_sel.union(wb);
        }
        settings.bounds_sel = bounds_sel;
    }

    function setOpacity(value) {
        forAllWidgets(function (w) { w.setOpacity(value) });
        SPACE.update();
    }

    function duplicateSelection() {
        API.selection.for_widgets(function(widget) {
            let mesh = widget.mesh;
            let bb = mesh.getBoundingBox();
            let ow = widget;
            let nw = API.widgets.new().loadGeometry(mesh.geometry.clone());
            nw.meta.file = ow.meta.file;
            nw.meta.vertices = ow.meta.vertices;
            nw.move(bb.max.x - bb.min.x + 1, 0, 0);
            platform.add(nw,true);
            nw.anno = ow.annotations();
            API.event.emit("widget.duplicate", nw, ow);
        });
    }

    function mirrorSelection() {
        API.selection.for_widgets(function(widget) {
            widget.mirror();
            API.event.emit("widget.mirror", widget);
        });
        SPACE.update();
        auto_save();
    }

    function moveSelection(x, y, z, abs) {
        if (viewMode !== VIEWS.ARRANGE) return;
        forSelectedGroups(function (w) {
            w.move(x, y, z, abs);
        });
        updateSelectedBounds();
        platformUpdateBounds();
        API.event.emit('selection.move', {x, y, z, abs});
        SPACE.update();
        auto_save();
    }

    function scaleSelection() {
        if (viewMode !== VIEWS.ARRANGE) return;
        let args = arguments;
        forSelectedGroups(function (w) {
            w.scale(...args);
        });
        platform.compute_max_z();
        updateSelectedBounds();
        platformUpdateBounds();
        API.event.emit('selection.scale', [...arguments]);
        // skip update if last argument is strictly 'false'
        if ([...arguments].pop() === false) {
            return;
        }
        updateSelectedInfo();
        SPACE.update();
        auto_save();
    }

    function rotateSelection(x, y, z) {
        if (viewMode !== VIEWS.ARRANGE) return;
        forSelectedGroups(function (w) {
            w.rotate(x, y, z);
            API.event.emit('widget.rotate', {widget: w, x, y, z});
        });
        updateSelectedBounds();
        platformUpdateBounds();
        platform.compute_max_z();
        API.event.emit('selection.rotate', {x, y, z});
        updateSelectedInfo();
        SPACE.update();
        auto_save();
    }

    function exportSelection(format = "stl") {
        let widgets = API.selection.widgets();
        if (widgets.length === 0) {
            widgets = API.widgets.all();
        }
        let facets = 0;
        let outs = [];
        widgets.forEach(widget => {
            let mesh = widget.mesh;
            let geo = mesh.geometry;
            outs.push({geo, widget});
            facets += geo.attributes.position.count;
        });
        if (format === "obj") {
            let obj = [];
            let vpad = 0;
            for (let out of outs) {
                let meta = out.widget.meta;
                let name = meta.file || 'unnamed';
                obj.push(`g ${name}`);
                let { position } = out.geo.attributes;
                let pvals = position.array;
                for (let i=0, il=position.count; i<il; i += 3) {
                    let pi = i * position.itemSize;
                    obj.push(`v ${pvals[pi++]} ${pvals[pi++]} ${pvals[pi++]}`);
                    obj.push(`v ${pvals[pi++]} ${pvals[pi++]} ${pvals[pi++]}`);
                    obj.push(`v ${pvals[pi++]} ${pvals[pi++]} ${pvals[pi++]}`);
                    obj.push(`f ${i+1+vpad} ${i+2+vpad} ${i+3+vpad}`);
                }
                vpad += position.count;
            }
            return obj.join('\n');
        }
        let stl = new Uint8Array(80 + 4 + facets/3 * 50);
        let dat = new DataView(stl.buffer);
        let pos = 84;
        dat.setInt32(80, facets/3, true);
        for (let out of outs) {
            let { position } = out.geo.attributes;
            let pvals = position.array;
            for (let i=0, il=position.count; i<il; i += 3) {
                let pi = i * position.itemSize;
                let p0 = new THREE.Vector3(pvals[pi++], pvals[pi++], pvals[pi++]);
                let p1 = new THREE.Vector3(pvals[pi++], pvals[pi++], pvals[pi++]);
                let p2 = new THREE.Vector3(pvals[pi++], pvals[pi++], pvals[pi++]);
                let norm = THREE.computeFaceNormal(p0, p1, p2);
                let xo = 0, yo = 0, zo = 0;
                if (outs.length > 1) {
                    let {x, y, z} = out.widget.track.pos;
                    xo = x;
                    yo = y;
                    zo = z;
                }
                dat.setFloat32(pos +  0, norm.x, true);
                dat.setFloat32(pos +  4, norm.y, true);
                dat.setFloat32(pos +  8, norm.z, true);
                dat.setFloat32(pos + 12, p0.x + xo, true);
                dat.setFloat32(pos + 16, p0.y + yo, true);
                dat.setFloat32(pos + 20, p0.z + zo, true);
                dat.setFloat32(pos + 24, p1.x + xo, true);
                dat.setFloat32(pos + 28, p1.y + yo, true);
                dat.setFloat32(pos + 32, p1.z + zo, true);
                dat.setFloat32(pos + 36, p2.x + xo, true);
                dat.setFloat32(pos + 40, p2.y + yo, true);
                dat.setFloat32(pos + 44, p2.z + zo, true);
                pos += 50;
            }
        }
        return stl;
    }

    /** ******************************************************************
     * Platform Functions
     ******************************************************************* */

     function platformUpdateOrigin() {
         platform.update_bounds();

         let dev = settings.device;
         let proc = settings.process;
         let ruler = settings.controller.showRulers;
         let stock = settings.stock;
         let stockCenter = stock.center || {};
         let hasStock = stock.x && stock.y && stock.z;
         let isBelt = dev.bedBelt;
         let center = MODE === MODES.FDM ? dev.originCenter || dev.bedRound :
            MODE === MODES.SLA ? false :
            MODE === MODES.CAM ? proc.outputOriginCenter :
            dev.originCenter || proc.outputOriginCenter;
         let x = 0;
         let y = 0;
         let z = 0;
         if (MODE === MODES.CAM && proc.camOriginTop) {
             z = (hasStock ? stock.z : topZ) + 0.01;
         }
         if (!center) {
             if (hasStock) {
                 x = (-stock.x / 2) + stockCenter.x;
                 y = (stock.y / 2) - stockCenter.y;
             } else {
                 if (MODE === MODES.LASER && proc.outputOriginBounds) {
                     let b = settings.bounds;
                     x = b.min.x,
                     y = -b.min.y
                 } else {
                     x = -dev.bedWidth / 2;
                     y = dev.bedDepth / 2;
                 }
             }
         } else if (hasStock) {
             x = stockCenter.x;
             y = -stockCenter.y;
         } else if (isBelt) {
             y = dev.bedDepth / 2;
         }
         settings.origin = {x, y, z};
         SPACE.platform.setRulers(ruler, ruler, 1/unitScale(), 'X', isBelt ? 'Z' : 'Y');
         if (settings.controller.showOrigin && MODE !== MODES.SLA) {
             SPACE.platform.setOrigin(x,y,z,true);
         } else {
             SPACE.platform.setOrigin(x,y,z,false);
         }
     }

     function platformUpdateTopZ(zdelta) {
         // preserve topZD and re-use when not supplied as argument
         topZD = zdelta !== undefined ? zdelta : topZD;
         let stock = settings.stock;
         let hasStock = stock.x && stock.y && stock.z;
         forAllWidgets(function(widget) {
             if (MODE === MODES.CAM) {
                 let bounds = widget.getBoundingBox();
                 let wzmax = bounds.max.z;
                 let topz = hasStock ? stock.z : topZ;
                 let zdelta = settings.process.camZOffset || 0;
                 switch (settings.process.camZAnchor) {
                    case 'top':
                        widget.setTopZ(stock.z - zdelta);
                        break;
                    case 'middle':
                        widget.setTopZ(stock.z - (stock.z - wzmax) / 2);
                        break;
                    case 'bottom':
                        widget.setTopZ(wzmax + zdelta);
                        break;
                 }
             } else {
                 widget.setTopZ(0);
             }
         });
     }

    function platformUpdateSize(updateDark = true) {
        let dev = settings.device,
            isBelt = dev.bedBelt,
            width, depth,
            height = Math.round(Math.max(dev.bedHeight, dev.bedWidth/100, dev.bedDepth/100));
        SPACE.platform.setRound(dev.bedRound);
        SPACE.platform.setSize(
            width = parseInt(dev.bedWidth),
            depth = parseInt(dev.bedDepth),
            height = parseFloat(dev.bedHeight),
            parseFloat(dev.maxHeight)
        );
        let proc = settings.process,
            ctrl = settings.controller,
            ruler = ctrl.showRulers,
            unitMM = ctrl.units === 'mm',
            gridMajor = unitMM ? 25 : 25.4,
            gridMinor = unitMM ? 5 : 25.4 / 10;
        if (updateDark) {
            if (ctrl.dark) {
                SPACE.platform.set({ light: 0.06 });
                SPACE.platform.setFont({rulerColor:'#888888'});
                SPACE.platform.setGrid(gridMajor, gridMinor, 0x666666, 0x333333);
                SPACE.platform.opacity(0.05);
                SPACE.sky.set({ color: 0, ambient: { intensity: 0.5 } });
                DOC.body.classList.add('dark');
            } else {
                SPACE.platform.set({ light: 0.06 });
                SPACE.platform.setFont({rulerColor:'#333333'});
                SPACE.platform.setGrid(gridMajor, gridMinor, 0x999999, 0xcccccc);
                SPACE.platform.opacity(0.2);
                SPACE.sky.set({ color: 0xffffff, ambient: { intensity: 1 } });
                DOC.body.classList.remove('dark');
            }
            SPACE.platform.setSize();
        }
        SPACE.platform.setRulers(ruler, ruler, 1 / unitScale(), 'X', isBelt ? 'Z' : 'Y');
        // SPACE.platform.setGZOff(height/2 - 0.1);
        platform.update_origin();
    }

    function platformUpdateBounds() {
        let bounds = new THREE.Box3();
        forAllWidgets(function(widget) {
            let wp = widget.track.pos;
            let wb = widget.mesh.getBoundingBox().clone();
            wb.min.x += wp.x;
            wb.max.x += wp.x;
            wb.min.y += wp.y;
            wb.max.y += wp.y;
            bounds.union(wb);
        });
        return settings.bounds = bounds;
    }

    function platformSelect(widget, shift, recurse = true) {
        if (viewMode !== VIEWS.ARRANGE) {
            return;
        }
        // apply select to entire group
        if (recurse && widget && widget.group.length > 1) {
            for (let w of widget.group) {
                platformSelect(w, true, false);
            }
            return;
        }
        let mesh = widget.mesh,
            sel = (selectedMeshes.indexOf(mesh) >= 0);
        if (sel) {
            if (shift) {
                platform.deselect(widget, recurse)
            } else if (selectedMeshes.length > 1) {
                platform.deselect(undefined, recurse);
                platform.select(widget, false, recurse);
            }
        } else {
            // prevent selection in slice view
            if (!mesh.material.visible) return;
            if (!shift) platform.deselect(undefined, recurse);
            selectedMeshes.push(mesh);
            API.event.emit('widget.select', widget);
            widget.setColor(color.selected);
            updateSelectedInfo();
        }
        platformUpdateSelected();
        SPACE.update();
    }

    function platformSelectedCount() {
        return viewMode === VIEWS.ARRANGE ? selectedMeshes.length : 0;
    }

    function platformUpdateSelected() {
        let selreal = selection.widgets();
        let selwid = selection.widgets(true);
        let selcount = selwid.length;
        let extruders = settings.device.extruders;
        UI.trash.style.display = selreal.length ? 'flex' : '';
        if (selcount) {
            UI.nozzle.classList.add('lt-active');
            if (feature.meta && selcount === 1) {
                let sel = selwid[0];
                let name = sel.meta.file || sel.meta.url;
                if (name) {
                    name = name
                        .toLowerCase()
                        .replace(/_/g,' ')
                        .replace(/.png/,'')
                        .replace(/.stl/,'');
                    let sp = name.indexOf('/');
                    if (sp >= 0) {
                        name = name.substring(sp + 1);
                    }
                    UI.mesh.name.innerText = name;
                }
                UI.mesh.points.innerText = sel.meta.vertices;
                UI.mesh.faces.innerText = sel.meta.vertices / 3;
            } else {
                UI.mesh.name.innerText = `[${selcount}]`;
                UI.mesh.points.innerText = '-';
                UI.mesh.faces.innerText = '-';
            }
        } else {
            UI.mesh.name.innerText = '[0]';
            UI.mesh.points.innerText = '-';
            UI.mesh.faces.innerText = '-';
            UI.nozzle.classList.remove('lt-active');
        }
        UI.nozzle.style.display = extruders && extruders.length > 1 ? 'flex' : '';
        if (extruders) {
            for (let i=0; i<extruders.length; i++) {
                let b = $(`sel-ext-${i}`);
                if (b) b.classList.remove('pop-sel');
            }
            forSelectedWidgets(w => {
                w.setColor(color.selected);
                let ext = API.widgets.annotate(w.id).extruder || 0;
                let b = $(`sel-ext-${ext}`);
                if (b) b.classList.add('pop-sel');
                w.saveState();
            }, true);
        }
    }

    function platformDeselect(widget, recurse = true) {
        if (viewMode !== VIEWS.ARRANGE) {
            // don't de-select and re-color widgets in,
            // for example, sliced or preview modes
            return;
        }
        // apply deselect to entire group
        if (recurse && widget && widget.group.length > 1) {
            for (let w of widget.group) {
                platformDeselect(w, false);
            }
            return;
        }
        if (!widget) {
            forAllWidgets(function(widget) {
                platform.deselect(widget);
            });
            return;
        }
        let mesh = widget.mesh,
            si = selectedMeshes.indexOf(mesh),
            sel = (si >= 0);
        if (sel) {
            selectedMeshes.splice(si,1);
            API.event.emit('widget.deselect', widget);
        }
        widget.setColor(color.deselected);
        platformUpdateSelected();
        SPACE.update();
        updateSelectedInfo();
    }

    function platformLoad(url, onload) {
        if (url.toLowerCase().indexOf(".stl") > 0) {
            platform.load_stl(url, onload);
        } else {
            ajax(url, function(vertices) {
                vertices = js2o(vertices).toFloat32();
                let widget = newWidget().loadVertices(vertices);
                widget.meta.url = url;
                platform.add(widget);
                if (onload) onload(vertices, widget);
            });
        }
    }

    function platformLoadSTL(url, onload, formdata) {
        let scale = 1 / unitScale();
        new LOAD.STL().load(url, function(vertices, filename) {
            if (vertices) {
                let widget = newWidget().loadVertices(vertices);
                widget.meta.file = filename;
                platform.add(widget);
                if (onload) {
                    onload(vertices, widget);
                }
            }
        }, formdata, scale);
    }

    function platformLoadURL(url, options = {}) {
        platform.group();
        LOAD.URL.load(url, options).then((objects) => {
            let widgets = [];
            for (let object of objects) {
                let widget = newWidget(undefined, options.group).loadVertices(object.mesh);
                widget.meta.file = object.file;
                platform.add(widget);
                widgets.push(widget);
            }
            platform.group_done();
            API.event.emit("load.url", { url, options, widgets });
        }).catch(error => {
            API.show.alert(error);
        });
    }

    function platformComputeMaxZ() {
        topZ = 0;
        forAllWidgets(function(widget) {
            topZ = Math.max(topZ, widget.mesh.getBoundingBox().max.z);
        });
        SPACE.platform.setMaxZ(topZ);
    }

    function platformGroup() {
        grouping = true;
    }

    // called after all new widgets are loaded to update group positions
    function platformGroupDone(skipLayout) {
        grouping = false;
        Widget.Groups.loadDone();
        if (feature.drop_layout && !skipLayout) {
            platform.layout();
        }
    }

    function platformAdd(widget, shift, nolayout) {
        widget.anno.extruder = widget.anno.extruder || 0;
        WIDGETS.push(widget);
        SPACE.world.add(widget.mesh);
        platform.select(widget, shift);
        platform.compute_max_z();
        API.event.emit('widget.add', widget);
        platformChanged();
        auto_save();
        if (nolayout) {
            return;
        }
        if (!grouping) {
            platformGroupDone();
            if (!settings.controller.autoLayout) {
                positionNewWidget(widget);
            }
        }
    }

    function positionNewWidget(widget) {
        if (WIDGETS.length <= 1) return;
        let DEG2RAD = Math.PI / 180;
        let { bedWidth, bedDepth } = settings.device;
        let devOff = bedWidth / 2;
        let wbb = widget.getBoundingBox();
        let dim = { x: wbb.max.x - wbb.min.x, y: wbb.max.y - wbb.min.y };
        let hdim = { x: dim.x / 2, y: dim.y / 2 };
        let bounds = BASE.newBounds(), target = BASE.newBounds();
        // look for best position for new widget that doesn't collide
        outer: for (let rad=10; rad<200; rad += 10) {
            inner: for (let d=0; d<360; d += 1) {
                let dx = Math.cos(d * DEG2RAD) * rad;
                let dy = Math.sin(d * DEG2RAD) * rad;
                bounds.set(dx - hdim.x, dx + hdim.x, dy - hdim.y, dy + hdim.y);
                for (let w=0, wl=WIDGETS.length; w<wl; w++) {
                    let wt = WIDGETS[w];
                    if (wt === widget) {
                        continue;
                    }
                    let tpo = wt.track.pos;
                    let tbb = wt.getBoundingBox();
                    let dim = { x: (tbb.max.x - tbb.min.x) / 2, y : (tbb.max.y - tbb.min.y) / 2 };
                    target.set(tpo.x - dim.x, tpo.x + dim.x, tpo.y - dim.y, tpo.y + dim.y);
                    if (target.overlaps(bounds, 5)) {
                        continue inner;
                    }
                }
                widget._move(dx, dy, widget.track.pos.z, true);
                break outer;
            }
        }
    }

    function platformDelete(widget) {
        if (!widget) {
            return;
        }
        if (Array.isArray(widget)) {
            let mc = widget.slice(), i;
            for (i=0; i<mc.length; i++) {
                platform.delete(mc[i].widget || mc[i]);
            }
            return;
        }
        KIRI.work.clear(widget);
        WIDGETS.remove(widget);
        Widget.Groups.remove(widget);
        SPACE.world.remove(widget.mesh);
        selectedMeshes.remove(widget.mesh);
        updateSliderMax();
        platform.compute_max_z();
        if (MODE !== MODES.FDM) {
            platform.layout();
        }
        SPACE.update();
        platformUpdateSelected();
        if (feature.drop_layout) platform.layout();
        API.event.emit('widget.delete', widget);
        platformChanged();
        auto_save();
    }

    function platformChanged() {
        let fts = $('ft-select');
        fts.innerHTML = '';
        for (let w of WIDGETS) {
            let b = DOC.createElement('button');
            fts.appendChild(b);
            b.innerText = w.meta.file || 'no name';
            let color;
            b.onmouseenter = function() {
                color = w.getColor();
                w.setColor(0x0088ff);
            };
            b.onmouseleave = function() {
                w.setColor(color);
            };
            b.onclick = function() {
                platformSelect(w, true, false);
                color = w.getColor();
            };
        }
    }

    function platformSelectAll() {
        forAllWidgets(function(w) { platform.select(w, true, false) })
    }

    function platformLayout(event, space = settings.controller.spaceLayout) {
        let auto = UI.autoLayout.checked,
            proc = settings.process,
            dev = settings.device,
            isBelt = dev.bedBelt,
            oldmode = viewMode,
            layout = (viewMode === VIEWS.ARRANGE && auto);

        switch (MODE) {
            case MODES.SLA:
                space = space || (proc.slaSupportLayers && proc.slaSupportDensity ? 2 : 1);
                break;
            case MODES.CAM:
            case MODES.LASER:
                space = space || proc.outputTileSpacing || 1;
                break;
            case MODES.FDM:
                space = space || ((proc.sliceSupportExtra || 0) * 2) + 1;
                // auto resize device to support a larger object
                if (isBelt) {
                    fitDeviceToWidgets();
                }
                break;
        }

        setViewMode(VIEWS.ARRANGE);
        hideSlices();
        auto_save();

        // only auto-layout when in arrange mode
        if (oldmode !== VIEWS.ARRANGE) {
            API.event.emit('platform.layout');
            return SPACE.update();
        }

        // do not layout when switching back from slice view
        if (!auto || (!space && !layout)) {
            API.event.emit('platform.layout');
            return SPACE.update();
        }

        let gap = space;

        // in CNC mode with >1 widget, force layout with spacing @ 1.5x largest tool diameter
        if (MODE === MODES.CAM && WIDGETS.length > 1) {
            let spacing = space || 1, CAM = KIRI.driver.CAM;
            if (proc.camRoughOn) spacing = Math.max(spacing, CAM.getToolDiameter(settings, proc.camRoughTool));
            if (proc.camOutlineOn) spacing = Math.max(spacing, CAM.getToolDiameter(settings, proc.camOutlineTool));
            gap = spacing * 1.5;
        }

        // space parts to account for anchor in belt mode
        if (isBelt) {
            gap += proc.firstLayerBeltLead || 0;
        }

        let i, m, sz = isBelt ? {x:1, y:100000} : SPACE.platform.size(),
            mp = [sz.x, sz.y],
            ms = [mp[0] / 2, mp[1] / 2],
            c = Widget.Groups.blocks().sort(MOTO.Sort),
            p = new KIRI.Pack(ms[0], ms[1], gap).fit(c);

        while (!p.packed) {
            ms[0] *= 1.1;
            ms[1] *= 1.1;
            p = new KIRI.Pack(ms[0], ms[1], gap).fit(c);
        }

        for (i = 0; i < c.length; i++) {
            m = c[i];
            m.fit.x += m.w / 2 + p.pad;
            m.fit.y += m.h / 2 + p.pad;
            m.move(p.max.w / 2 - m.fit.x, p.max.h / 2 - m.fit.y, 0, true);
            // m.material.visible = true;
        }

        if (isBelt) {
            let bounds = platformUpdateBounds(),
                movey = -(dev.bedDepth / 2 + bounds.min.y);
            forAllWidgets(widget => {
                // only move the root widget in the group
                if (widget.id === widget.group.id) {
                    widget.move(0, movey, 0);
                }
            });
        }

        platform.update_origin();

        API.event.emit('platform.layout');
        SPACE.update();
    }

    /** ******************************************************************
     * Settings Functions
     ******************************************************************* */

    // given a settings region, update values of matching bound UI fields
    function updateFieldsFromSettings(setrec, uirec = UI, trace) {
        if (!setrec) {
            return console.trace("missing scope");
        }
        for (let key in setrec) {
            if (!setrec.hasOwnProperty(key)) {
                continue;
            }
            let val = setrec[key];
            if (!uirec.hasOwnProperty(key)) {
                continue;
            }
            let uie = uirec[key], typ = uie ? uie.type : null;
            if (typ === 'text') {
                if (uie.setv) {
                    uie.setv(val);
                } else {
                    uie.value = val;
                }
            } else if (typ === 'checkbox') {
                uie.checked = val;
            } else if (typ === 'select-one') {
                uie.innerHTML = '';
                let source = uie.parentNode.getAttribute('source'),
                    list = uie._source || settings[source] || lists[source],
                    chosen = null;
                if (list) list.forEach(function(el, index) {
                    let id = el.id || el.name;
                    let ev = el.value || id;
                    if (val == id) {
                        chosen = index;
                    }
                    let opt = DOC.createElement('option');
                    opt.appendChild(DOC.createTextNode(el.name));
                    opt.setAttribute('value', ev);
                    uie.appendChild(opt);
                });
                if (chosen) {
                    uie.selectedIndex = chosen;
                }
            } else if (typ === 'textarea') {
                if (Array.isArray(val)) {
                    uie.value = val.join('\n');
                } else {
                    uie.value = '';
                }
            }
        }
    }

    function isEquals(o1, o2) {
        if (o1 == o2) return true;
        if (Array.isArray(o1) && Array.isArray(o2)) {
            if (o1.length === o2.length) {
                for (let i=0; i<o1.length; i++) {
                    if (o1[i] !== o2[i]) {
                        return false;
                    }
                }
                return true;
            }
        } else if (typeof(o1) === 'object' && typeof(o2) === 'object') {
            let keys = Object.keys(Object.assign({}, o1, o2));
            for (let key of keys) {
                if (o1[key] !== o2[key]) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    /**
     * @returns {Object}
     */
    function updateSettingsFromFields(setrec, uirec = UI, changes) {
        if (!setrec) {
            return console.trace("missing scope");
        }

        let lastChange = UC.lastChange();

        // for each key in setrec object
        for (let key in setrec) {
            if (!setrec.hasOwnProperty(key)) {
                // console.log({no_setrec: key});
                continue;
            }
            if (!uirec.hasOwnProperty(key)) {
                // console.log({no_uirec: key});
                continue;
            }
            let nval = null, uie = uirec[key];
            // skip empty UI values
            if (!uie || uie === '') {
                // console.log({uie_empty: key});
                continue;
            }
            if (uie.type === 'text') {
                nval = uirec[key].convert();
            } else if (uie.type === 'checkbox') {
                nval = uirec[key].checked;
            } else if (uie.type === 'select-one') {
                if (uie.selectedIndex >= 0) {
                    nval = uie.options[uie.selectedIndex].value;
                    let src = uie.parentNode.getAttribute('source');
                    if (src === 'tools') {
                        nval = parseInt(nval);
                    }
                } else {
                    nval = setrec[key];
                }
            } else if (uie.type === 'textarea') {
                nval = uie.value.trim().split('\n').filter(v => v !== '');
            } else {
                continue;
            }
            if (lastChange === uie) {
                if (changes) changes[key] = nval;
            }
            if (!isEquals(setrec[key], nval)) {
                setrec[key] = nval;
                if (changes) {
                    changes[key] = nval;
                }
            }
        }

        return settings;
    }

    function updateFields() {
        updateFieldsFromSettings(settings.device);
        updateFieldsFromSettings(settings.process);
        updateFieldsFromSettings(settings.controller);
        updateExtruderFields(settings.device);
    }

    function updateExtruderFields(device) {
        if (device.extruders && device.extruders[device.internal]) {
            updateFieldsFromSettings(device.extruders[device.internal]);
            UI.extruder.firstChild.innerText = `${LANG.dv_gr_ext} [${device.internal+1}/${device.extruders.length}]`;
            UI.extPrev.disabled = device.internal === 0;
            UI.extPrev.onclick = function() {
                device.internal--;
                updateExtruderFields(device);
            };
            UI.extNext.disabled = device.internal === device.extruders.length - 1;
            UI.extNext.onclick = function() {
                device.internal++;
                updateExtruderFields(device);
            };
            UI.extDel.disabled = UI.extDel.disabled || device.extruders.length < 2;
            UI.extDel.onclick = function() {
                device.extruders.splice(device.internal,1);
                device.internal = Math.min(device.internal, device.extruders.length-1);
                updateExtruderFields(device);
            };
            UI.extAdd.onclick = function() {
                let copy = clone(device.extruders[device.internal]);
                copy.extSelect = [`T${device.extruders.length}`];
                copy.extDeselect = [];
                device.extruders.push(copy);
                device.internal = device.extruders.length - 1;
                updateExtruderFields(device);
            };
        }
    }

    function updateSettings(opt = {}) {
        let { controller, device, process, mode, sproc, cproc } = settings;
        updateSettingsFromFields(controller);
        switch (controller.units) {
            case 'mm': UC.setUnits(1); break;
            case 'in': UC.setUnits(25.4); break;
        }
        if (opt.controller) {
            return;
        }
        updateSettingsFromFields(device, undefined, undefined, true);
        // range-specific values
        if (settings.mode === 'FDM' && viewMode === VIEWS.SLICE) {
            let changes = {};
            let values = process;
            let { layer_lo, layer_hi, layer_max } = API.var;
            let range = { lo: layer_lo, hi: layer_hi };
            let add = false;
            if (layer_lo > 0 || layer_hi < layer_max) {
                values = Object.clone(process);
                add = true;
            }
            updateSettingsFromFields(values, undefined, changes);
            if (range) {
                updateRange(range.lo, range.hi, changes, add);
            }
        } else {
            updateSettingsFromFields(process);
        }
        if (device.extruders && device.extruders[device.internal]) {
            updateSettingsFromFields(device.extruders[device.internal]);
        }
        API.conf.save();
        let compare = sproc[mode][cproc[mode]];
        let same = true;
        if (compare)
        for (let [key, val] of Object.entries(compare).filter(v => v[0] !== 'processName')) {
            let tval = process[key];
            // outputLoopLayers misbehaving and setting null on empty
            if (val === '' && tval == null) {
                continue;
            }
            if (Array.isArray(tval) && Array.isArray(val)) {
                if (JSON.stringify(tval) == JSON.stringify(val)) {
                    continue;
                }
            }
            if (tval != val) {
                // console.log(key, 'expected', val, 'got', tval);
                same = false;
            }
        }
        $('mode-device').innerText = device.deviceName;
        $('mode-profile').innerText = `${cproc[mode]}${same ? '' : ' *'}`;
    }

    function saveSettings() {
        const view = SPACE.view.save();
        if (view.left || view.up) {
            settings.controller.view = view;
        }
        const mode = settings.mode;
        settings.sproc[mode].default = settings.process;
        settings.sproc[mode][settings.process.processName] = settings.process;
        settings.device.bedBelt = UI.deviceBelt.checked;
        settings.device.bedRound = UI.deviceRound.checked;
        settings.device.originCenter = UI.deviceOrigin.checked || UI.deviceRound.checked;
        settings.device.fwRetract = UI.fwRetract.checked;
        SDB.setItem('ws-settings', JSON.stringify(settings));
        API.event.emit('settings.saved', settings);
    }

    function settingsImportZip(data, ask) {
        let alert = API.show.alert("Importing Workspace");
        JSZip.loadAsync(data).then(zip => {
            for (let [key,value] of Object.entries(zip.files)) {
                if (key === "workspace.json") {
                    value.async("string").then(json => {
                        API.hide.alert(alert);
                        settingsImport(JSON.parse(json), ask);
                    });
                }
            }
        });
    }

    // import and convert prusa ini file
    function settingsPrusaConvert(data) {
        let map = {};
        try {
            data.split('\n')
                .filter(l => l.charAt(0) !== '#')
                .map(l => l.split('=').map(v => v.trim()))
                .map(l => {
                    // convert gcode string into a string array
                    if (l[0].indexOf('_gcode') > 0) {
                        l[1] = l[1].replaceAll('\\n','\n').split('\n');
                    }
                    return l;
                })
                .forEach(l => {
                    map[l[0]] = l[1];
                });
        } catch (e) {
            return UC.alert('invalid file');
        }
        // device setup
        let device = Object.clone(KIRI.conf.defaults.fdm.d);
        let dname = device.deviceName = map.printer_model;
        if (dname) {
            let mode = "FDM";
            device.mode = mode;
            device.extruders[0].extNozzle = parseFloat(map.nozzle_diameter);
            device.gcodePre = map.start_gcode;
            device.gcodePost = map.end_gcode;
            device.gcodeLayer = map.layer_gcode || [];
            device.maxHeight = parseInt(map.max_print_height || device.maxHeight);
            if (map.bed_shape) {
                let shape = map.bed_shape.split(',').map(l => l.split('x'));
                device.bedWidth = parseInt(shape[2][0]);
                device.bedDepth = parseInt(shape[2][1]);
            }
        }
        // profile setup
        let process = Object.clone(KIRI.conf.defaults.fdm.p);
        let pname = process.processName = map.print_settings_id;
        if (pname) {
            process.sliceShells = parseInt(map.perimeters);
            process.sliceHeight = parseFloat(map.layer_height);
            process.outputFeedrate = parseInt(map.perimeter_speed);
            process.outputSeekrate = parseInt(map.travel_speed);
            process.outputTemp = parseInt(map.temperature);
            process.outputBedTemp = parseInt(map.bed_temperature);
            process.sliceTopLayers = parseInt(map.top_solid_layers);
            process.sliceBottomLayers = parseInt(map.bottom_solid_layers);
            process.firstSliceHeight = parseFloat(map.first_layer_height);
            process.firstLayerNozzleTemp = parseInt(map.first_layer_temperature);
            process.firstLayerRate = (
                (parseFloat(map.first_layer_speed) / 100) * process.outputFeedrate);
            process.firstLayerBedTemp = parseInt(map.first_layer_bed_temperature);
            process.outputRetractDist = parseFloat(map.retract_length);
            process.outputRetractSpeed = parseFloat(map.retract_speed);
        }
        UC.confirm(`Import "${dname}"?`).then(yes => {
            if (yes) {
                // create device, associated profile, set as current and show dialog
                settings.devices[dname] = device;
                settings.devproc[dname] = pname;
                settings.process = settings.sproc.FDM[pname] = process;
                settings.filter.FDM = dname;
                settings.cproc.FDM = pname;
                API.show.devices();
            }
        });
    }

    function settingsImport(data, ask) {
        if (typeof(data) === 'string') {
            try {
                data = API.util.b64dec(data);
            } catch (e) {
                UC.alert('invalid import format');
                console.log('data',data);
                return;
            }
        }
        if (LOCAL) console.log('import',data);
        let isSettings = (data.settings && data.version && data.time);
        let isProcess = (data.process && data.version && data.time && data.mode && data.name);
        let isDevice = (data.device && data.version && data.time);
        let isWork = (data.work);
        if (!isSettings && !isDevice && !isProcess) {
            UC.alert('invalid settings or device format');
            console.log('data',data);
            return;
        }
        function doit() {
            if (isDevice) {
                if (settings.devices[data.device]) {
                    UC.confirm(`Replace device ${data.device}?`).then(yes => {
                        if (yes) {
                            settings.devices[data.device] = data.code;
                            API.show.devices();
                        }
                    });
                } else {
                    settings.devices[data.device] = data.code;
                    API.show.devices();
                }
            }
            if (isProcess) {
                if (settings.sproc[data.mode][data.name]) {
                    UC.confirm(`Replace process ${data.name}?`).then(yes => {
                        if (yes) {
                            settings.sproc[data.mode][data.name] = data.process;
                            API.conf.show();
                        }
                    });
                } else {
                    settings.sproc[data.mode][data.name] = data.process;
                    API.conf.show();
                }
            }
            if (isSettings) {
                clearWorkspace();
                settings = CONF.normalize(data.settings);
                SDB.setItem('ws-settings', JSON.stringify(settings));
                restoreSettings();
                if (LOCAL) console.log('settings',Object.clone(settings));
                if (isWork) {
                    API.platform.clear();
                    KIRI.codec.decode(data.work).forEach(widget => {
                        platform.add(widget, 0, true);
                    });
                    if (data.view) {
                        SPACE.view.load(data.view);
                    }
                }
                restoreWorkspace(() => {
                    UI.sync();
                }, true);
            }
        }
        if (ask) {
            let opt = {};
            let prompt = isDevice ?
                `Import device "${data.device}"?` : isProcess ?
                `Import process "${data.name}"?` :
                `Import settings made in Kiri:Moto version ${data.version} on<br>${new Date(data.time)}?`;
            if (data.screen) {
                opt.pre = [
                    '<div class="f-col a-center">',
                    `<img src="${data.screen}" style="width:300px"/>`,
                    '</div>'
                ];
            }
            UC.confirm(prompt,undefined,undefined,opt).then((yes) => {
                if (yes) doit();
            });
        } else {
            doit();
        }
    }

    function settingsExport(opts = {}) {
        const note = opts.node || undefined;
        const shot = opts.work || opts.screen ? SPACE.screenshot() : undefined;
        const work = opts.work ? KIRI.codec.encode(WIDGETS,{_json_:true}) : undefined;
        const view = opts.work ? SPACE.view.save() : undefined;
        const setn = Object.clone(settings);
        // stuff in legacy annotations for re-import
        for (let w of WIDGETS) {
            setn.widget[w.id] = w.anno;
        }
        const xprt = {
            settings: setn,
            version: KIRI.version,
            screen: shot,
            space: SPACE.info,
            note: note,
            work: work,
            view: view,
            moto: MOTO.id,
            init: SDB.getItem('kiri-init'),
            time: Date.now()
        };
        return opts.clear ? xprt : API.util.b64enc(xprt);
    }

    function platformLoadFiles(files,group) {
        let loaded = files.length;
        platform.group();
        for (let i=0; i<files.length; i++) {
            const file = files[i],
                reader = new FileReader(),
                lower = files[i].name.toLowerCase(),
                israw = lower.indexOf(".raw") > 0 || lower.indexOf('.') < 0,
                isstl = lower.indexOf(".stl") > 0,
                isobj = lower.indexOf(".obj") > 0,
                is3mf = lower.indexOf(".3mf") > 0,
                issvg = lower.indexOf(".svg") > 0,
                ispng = lower.indexOf(".png") > 0,
                isjpg = lower.indexOf(".jpg") > 0,
                isgcode = lower.indexOf(".gcode") > 0 || lower.indexOf(".nc") > 0,
                isset = lower.indexOf(".b64") > 0 || lower.indexOf(".km") > 0,
                iskmz = lower.indexOf(".kmz") > 0,
                isini = lower.indexOf(".ini") > 0;
            reader.file = files[i];
            reader.onloadend = function (e) {
                function load_dec() {
                    if (--loaded === 0) platform.group_done(isgcode);
                }
                if (israw) {
                    platform.add(
                        newWidget(undefined,group)
                        .loadVertices(JSON.parse(e.target.result).toFloat32())
                    );
                    load_dec();
                }
                else if (API.feature.on_load && (isstl || isobj || is3mf)) {
                    API.feature.on_load(e.target.result, file);
                    load_dec();
                }
                else if (isstl) {
                    if (API.feature.on_add_stl) {
                        API.feature.on_add_stl(e.target.result, file);
                    } else {
                        platform.add(
                            newWidget(undefined,group)
                            .loadVertices(new LOAD.STL().parse(e.target.result,unitScale()))
                            .saveToCatalog(e.target.file.name)
                        );
                    }
                    load_dec();
                }
                else if (isobj) {
                    let objs = LOAD.OBJ.parse(e.target.result);
                    let odon = function() {
                        for (let obj of objs) {
                            let name = e.target.file.name;
                            if (obj.name) {
                                name = obj.name + ' - ' + name;
                            }
                            platform.add(
                                newWidget(undefined,group)
                                .loadVertices(obj.toFloat32(), true)
                                .saveToCatalog(name)
                            );
                        }
                        load_dec();
                    };
                    if (objs.length > 1 && !group) {
                        UC.confirm('group objects?').then(ok => {
                            if (ok) {
                                group = [];
                            }
                            odon();
                        });
                    } else {
                        odon();
                    }
                }
                else if (is3mf) {
                    let odon = function(models) {
                        let msg = API.show.alert('Adding Objects');
                        for (let model of models) {
                            let name = e.target.file.name;
                            if (model.name) {
                                name = model.name + ' - ' + name;
                            }
                            platform.add(
                                newWidget(undefined,group)
                                .loadVertices(model.faces.toFloat32())
                                .saveToCatalog(name)
                            );
                        }
                        load_dec();
                        API.hide.alert(msg);
                    }
                    let msg = API.show.alert('Decoding 3MF');
                    LOAD.TMF.parseAsync(e.target.result).then(models => {
                        API.hide.alert(msg);
                        if (models.length > 1 && !group) {
                            UC.confirm(`group ${models.length} objects?`).then(ok => {
                                if (ok) {
                                    group = [];
                                }
                                odon(models);
                            });
                        } else {
                            odon(models);
                        }
                    });
                }
                else if (isgcode) {
                    loadCode(e.target.result, 'gcode');
                    load_dec();
                }
                else if (issvg) {
                    if (MODE === MODES.LASER) {
                        loadCode(e.target.result, 'svg');
                    } else {
                        let name = e.target.file.name;
                        let svg = LOAD.SVG.parse(e.target.result);
                        let ind = 0;
                        for (let v of svg) {
                            let num = ind++;
                            platform.add(
                                newWidget(undefined, group)
                                .loadVertices(svg[num].toFloat32())
                                .saveToCatalog(num ? `${name}-${num}` : name)
                            );
                        }
                    }
                    load_dec();
                }
                else if (iskmz) settingsImportZip(e.target.result, true);
                else if (isset) settingsImport(e.target.result, true);
                else if (ispng) loadImageDialog(e.target.result, e.target.file.name);
                else if (isjpg) loadImageConvert(e.target.result, e.target.file.name);
                else if (isini) settingsPrusaConvert(e.target.result);
                else API.show.alert(`Unsupported file: ${files[i].name}`);
            };
            if (isstl || ispng || isjpg || iskmz) {
                reader.readAsArrayBuffer(reader.file);
            } else {
                reader.readAsBinaryString(reader.file);
            }
        }
    }

    function loadImageConvert(res, name) {
        let url = URL.createObjectURL(new Blob([res]));

        $('mod-any').innerHTML = `<img id="xsrc" src="${url}"><canvas id="xdst"></canvas>`;

        let img = $('xsrc');
        let can = $('xdst');

        img.onload = () => {
            can.width = img.width;
            can.height = img.height;
            let ctx = can.getContext('2d');
            ctx.drawImage(img, 0, 0);
            fetch(can.toDataURL()).then(r => r.arrayBuffer()).then(data => {
                loadImageDialog(data, name);
            });
        };
    }

    function loadFile() {
        $('load-file').onchange = function(event) {
            console.log(event);
            platformLoadFiles(event.target.files);
        };
        $('load-file').click();
        // alert2("drag/drop STL files onto platform to import\nreload page to return to last saved state");
    }

    function saveWorkspace(quiet) {
        API.conf.save();
        let newWidgets = [],
            oldWidgets = js2o(SDB.getItem('ws-widgets'), []);
        forAllWidgets(function(widget) {
            if (widget.synth) return;
            newWidgets.push(widget.id);
            oldWidgets.remove(widget.id);
            widget.saveState();
            let ann = API.widgets.annotate(widget.id);
            ann.file = widget.meta.file;
            ann.url = widget.meta.url;
        });
        SDB.setItem('ws-widgets', o2js(newWidgets));
        oldWidgets.forEach(function(wid) {
            Widget.deleteFromState(wid);
        });
        // eliminate dangling saved widgets
        ODB.keys(keys => {
            keys.forEach(key => {
                if (newWidgets.indexOf(key.substring(8)) < 0) {
                    ODB.remove(key);
                }
            })
        }, "ws-save-" ,"ws-savf");
        if (!quiet) {
            alert2("workspace saved", 1);
        }
    }

    function restoreSettings(save) {
        let newset = ls2o('ws-settings') || settings;
        // extract legacy widget annotations into widgets
        if (newset.widget) {
            for (let id of Object.keys(newset.widget)) {
                let anno = newset.widget[id];
                let wid = WIDGETS.filter(w => w.id === id)[0];
                if (wid && anno) {
                    wid.anno = anno;
                    console.log('transfer settings annotations to widget', id);
                    delete newset.widget[id];
                    wid.saveState();
                } else {
                    console.log('missing widget for annotations', id);
                }
            }
        }
        settings = CONF.normalize(newset);
        // override camera from settings
        if (settings.controller.view) {
            SDB.removeItem('ws-camera');
        }
        // merge custom filters from localstorage into settings
        localFilters.forEach(function(fname) {
            let fkey = "gcode-filter-"+fname, ov = ls2o(fkey);
            if (ov) settings.devices[fname] = ov;
            SDB.removeItem(fkey)
        });
        SDB.removeItem(localFilterKey);
        // save updated settings
        if (save) API.conf.save();

        return newset;
    }

    function restoreWorkspace(ondone, skip_widget_load) {
        let newset = restoreSettings(false),
            camera = newset.controller.view,
            toload = ls2o('ws-widgets',[]),
            loaded = 0,
            position = true;

        updateFields();
        platform.update_size();

        SPACE.view.reset();
        if (camera) {
            SPACE.view.load(camera);
        } else {
            SPACE.view.home();
        }

        if (skip_widget_load) {
            if (ondone) {
                ondone();
            }
            return;
        }

        // remove any widgets from platform
        forAllWidgets(function(widget) {
            platform.delete(widget);
        });

        // remove widget keys if they are not going to be restored (TODO: remove in 3.1)
        if (settings.widget)
        Object.keys(settings.widget).filter(k => toload.indexOf(k) < 0).forEach(k => {
            delete settings.widget[k];
        });

        // load any widget by name that was saved to the workspace
        toload.forEach(function(widgetid) {
            Widget.loadFromState(widgetid, function(widget) {
                if (widget) {
                    platform.add(widget, 0, position);
                    let ann = API.widgets.annotate(widgetid);
                    widget.meta.file = ann.file;
                    widget.meta.url = ann.url;
                }
                if (++loaded === toload.length) {
                    platform.deselect();
                    if (ondone) {
                        ondone();
                        setTimeout(() => {
                            platform.update_top_z();
                            SPACE.update();
                        }, 1);
                    }
                }
            }, position);
        });

        return toload.length > 0;
    }

    function clearWorkspace() {
        // free up worker cache/mem
        KIRI.work.clear();
        platform.select_all();
        platform.delete(selectedMeshes);
    }

    function modalShowing() {
        return UI.modal.style.display === 'flex';
    }

    function showModal(which) {
        let mod = UI.modal,
            style = mod.style,
            visible = modalShowing(),
            info = { pct: 0 };

        ["help","setup","tools","prefs","saves","files","print","local","any"].forEach(function(name) {
            UI[name].style.display = name === which ? 'flex' : '';
        });

        function ondone() {
            API.event.emit('modal.show', which);
        }

        if (visible) {
            return ondone();
        }

        style.height = '0';
        style.display = 'flex';

        new TWEEN.Tween(info).
            easing(TWEEN.Easing.Quadratic.InOut).
            to({ pct: 100 }, 100).
            onUpdate(() => { style.height = `${info.pct}%` }).
            onComplete(ondone).
            start();
    }

    function hideModal() {
        if (!modalShowing()) {
            return;
        }
        let mod = UI.modal, style = mod.style, info={pct:100};
        new TWEEN.Tween(info).
            easing(TWEEN.Easing.Quadratic.InOut).
            to({pct:0}, 100).
            onUpdate(() => { style.height = `${info.pct}%` }).
            onComplete(() => { style.display = '' }).
            start();
    }

    function showCatalog() {
        showModal("files");
    }

    function getSettings() {
        return settings;
    }

    function putSettings(newset) {
        settings = CONF.normalize(newset);
        API.conf.save()
        API.space.restore(null, true);
    }

    function editSettings(e) {
        let mode = getMode(),
            name = e.target.getAttribute("name"),
            load = settings.sproc[mode][name],
            edit = prompt(`settings for "${name}"`, JSON.stringify(load));
        if (edit) {
            try {
                settings.sproc[mode][name] = JSON.parse(edit);
                if (name === settings.process.processName) {
                    API.conf.load(null, name);
                }
                API.conf.save();
            } catch (e) {
                UC.alert('malformed settings object');
            }
        }
    }

    function exportSettings(e) {
        let mode = getMode(),
            name = e.target.getAttribute("name"),
            data = API.util.b64enc({
                process: settings.sproc[mode][name],
                version: KIRI.version,
                moto: MOTO.id,
                time: Date.now(),
                mode,
                name
            });
        UC.prompt("Export Process Filename", name).then(name => {
            if (name) {
                API.util.download(data, `${name}.km`);
            }
        });
    }

    function loadSettings(e, named) {
        let mode = getMode(),
            name = e ? e.target.getAttribute("load") : named || currentProcessName() || "default",
            load = settings.sproc[mode][name];

        if (!load) return;

        // cloning loaded process into settings requires user to save
        // process before switching devices or risk losing any changes
        settings.process = clone(load);
        // update process name
        settings.process.processName = name;
        // save named process with the current device
        settings.devproc[currentDeviceName()] = name;
        // preserve name of last library loaded
        if (name !== 'default') {
            settings.cproc[mode] = name;
        }
        // allow mode driver to take any necessary actions
        API.event.emit("settings.load", settings);

        // update UI fields to reflect current settings
        updateFields();
        API.conf.update();

        if (e) triggerSettingsEvent();
    }

    function deleteSettings(e) {
        let name = e.target.getAttribute("del");
        delete settings.sproc[getMode()][name];
        updateSettingsList();
        API.conf.save();
        triggerSettingsEvent();
    }

    function updateSettingsList() {
        let list = [], s = settings, sp = s.sproc[getMode()] || {}, table = UI.settingsList;
        table.innerHTML = '';
        for (let k in sp) {
            if (sp.hasOwnProperty(k)) list.push(k);
        }
        list.filter(n => n !=='default').sort().forEach(function(sk) {
            let row = DOC.createElement('div'),
                load = DOC.createElement('button'),
                edit = DOC.createElement('button'),
                xprt = DOC.createElement('button'),
                del = DOC.createElement('button'),
                name = sk;

            load.setAttribute('load', sk);
            load.onclick = (ev) => {
                API.conf.load(undefined, sk);
                updateSettingsList();
                hideModal();
            }
            load.appendChild(DOC.createTextNode(sk));
            if (sk == settings.process.processName) {
                load.setAttribute('class', 'selected')
            }
            UI.settingsName.value = settings.process.processName;

            del.setAttribute('del', sk);
            del.setAttribute('title', "remove '"+sk+"'");
            del.innerHTML = '<i class="far fa-trash-alt"></i>';
            del.onclick = deleteSettings;

            edit.setAttribute('name', sk);
            edit.setAttribute('title', 'edit');
            edit.innerHTML = '<i class="far fa-edit"></i>';
            edit.onclick = editSettings;

            xprt.setAttribute('name', sk);
            xprt.setAttribute('title', 'export');
            xprt.innerHTML = '<i class="fas fa-download"></i>';
            xprt.onclick = exportSettings;

            row.setAttribute("class", "flow-row");
            row.appendChild(edit);
            row.appendChild(load);
            row.appendChild(xprt);
            row.appendChild(del);
            table.appendChild(row);
        });
    }

    function showSettings() {
        updateSettingsList();
        showModal("saves");
        UI.settingsName.focus();
    }

    function showHelp() {
        showHelpFile(`local`,() => {});
    }

    function showHelpFile(local,then) {
        if (!local) {
            WIN.open("//docs.grid.space/", "_help");
            return;
        }
        $('kiri-version').innerHTML = `${LANG.version} ${KIRI.version}`;
        showModal('help');
        API.event.emit('help.show', local);
    }

    function showLocal() {
        showModal('local');
        API.probe.local((err,data) => {
            let devc = 0;
            let bind = [];
            let html = ['<table>'];
            html.push(`<thead><tr><th>device</th><th>type</th><th>status</th><th></th></tr></thead>`);
            html.push(`<tbody>`);
            let recs = [];
            for (let k in data) {
                recs.push(data[k].stat);
            }
            recs.sort((a,b) => {
                return a.device.name < b.device.name ? -1 : 1;
            });
            for (let r of recs) {
                bind.push({uuid: r.device.uuid, host: r.device.addr[0], port: r.device.port});
                html.push(`<tr>`);
                html.push(`<td>${r.device.name}</td>`);
                html.push(`<td>${r.device.mode}</td>`);
                html.push(`<td>${r.state}</td>`);
                html.push(`<td><button id="${r.device.uuid}">admin</button></td>`);
                html.push(`</tr>`);
                devc++;
            }
            html.push(`</tbody>`);
            html.push(`</table>`);
            if (devc) {
                $('mod-local').innerHTML = html.join('');
            } else {
                $('mod-local').innerHTML = `<br><b>no local devices</b>`;
            }
            bind.forEach(rec => {
                $(rec.uuid).onclick = () => {
                    window.open(`http://${rec.host}:${rec.port||4080}/`);
                };
            });
        });
    }

    function setViewMode(mode) {
        const oldMode = viewMode;
        const isCAM = settings.mode === 'CAM';
        viewMode = mode;
        platform.deselect();
        updateSelectedInfo();
        // disable clear in non-arrange modes
        $('view-clear').style.display = mode === VIEWS.ARRANGE ? '' : 'none';
        switch (mode) {
            case VIEWS.ARRANGE:
                complete = {};
                UI.back.style.display = '';
                UI.render.style.display = '';
                KIRI.client.clear();
                STACKS.clear();
                hideSlider();
                updateSpeeds();
                setVisibleLayer();
                setWidgetVisibility(true);
                setOpacity(1);
                break;
            case VIEWS.SLICE:
                UI.back.style.display = 'flex';
                if (!isCAM) UI.render.classList.remove('lt-enabled');
                updateSpeeds();
                updateSliderMax();
                setWidgetVisibility(true);
                break;
            case VIEWS.PREVIEW:
                UI.back.style.display = 'flex';
                if (!isCAM) UI.render.classList.remove('lt-enabled');
                setWidgetVisibility(true);
                break;
            default:
                console.log("invalid view mode: "+mode);
                return;
        }
        API.event.emit('view.set', mode);
        DOC.activeElement.blur();
    }

    function getMode() {
        return settings.mode;
    }

    function getModeLower() {
        return getMode().toLowerCase();
    }

    function switchMode(mode) {
        setMode(mode, platform.update_size);
    }

    function setMode(mode, lock, then) {
        if (!MODES[mode]) {
            console.log("invalid mode: "+mode);
            mode = 'FDM';
        }
        // change mode constants
        settings.mode = mode;
        MODE = MODES[mode];
        DRIVER = KIRI.driver[mode];
        // update mode display
        $('app-mode-name').innerHTML = mode === 'CAM' ? 'CNC' : mode;
        // highlight relevant device mode button
        ["fdm","sla","cam","laser"].forEach(dev => {
            let cl = $(`mode-${dev}`).classList;
            if (dev === mode.toLowerCase()) {
                cl.add("dev-sel");
            } else {
                cl.remove("dev-sel");
            }
        });
        // restore cached device profile for this mode
        if (settings.cdev[mode]) {
            settings.device = clone(settings.cdev[mode]);
            API.event.emit('device.set', currentDeviceName());
        }
        // really belongs in CAM driver (lots of work / abstraction needed)
        // updateStockVisibility();
        // updates right-hand menu by enabling/disabling fields
        setViewMode(VIEWS.ARRANGE);
        UC.setMode(MODE);
        // sanitize and persist settings
        API.conf.load();
        API.conf.save();
        // other housekeeping
        triggerSettingsEvent();
        platformUpdateSelected();
        updateSelectedBounds(WIDGETS);
        updateFields();
        // because device dialog, if showing, needs to be updated
        if (modalShowing()) {
            API.show.devices();
        }
        API.space.restore(null, true);
        API.event.emit("mode.set", mode);
        if (then) {
            then();
        }
    }

    function currentDeviceName() {
        return settings.filter[getMode()];
    }

    function currentDeviceCode() {
        return settings.devices[currentDeviceName()];
    }

    function currentProcessName() {
        return settings.cproc[getMode()];
    }

    function currentProcessCode() {
        return settings.sproc[getMode()][currentProcessName()];
    }

    function setControlsVisible(show) {
        $('mid-lcol').style.display = show ? 'flex' : 'none';
        $('mid-rcol').style.display = show ? 'flex' : 'none';
    }

    function downloadBlob(data, filename) {
        let url = WIN.URL.createObjectURL(new Blob([data], {type: "octet/stream"}));
        $('mod-any').innerHTML = `<a id="_dexport_" href="${url}" download="${filename}">x</a>`;
        $('_dexport_').click();
    }

    // prevent safari from exiting full screen mode
    DOC.onkeydown = function (evt) { if (evt.keyCode == 27) evt.preventDefault() }

    // run optional module functions NOW before kiri-init has run
    if (Array.isArray(self.kirimod)) {
        kirimod.forEach(function(mod) { mod(kiri.api) });
    }

    // new module loading
    kiri.loader.forEach(mod => { mod(kiri.api)} );
    kiri.load = (mod) => { mod(kiri.api) };

    // upon restore, seed presets
    API.event.emit('preset', API.conf.dbo());
})();
