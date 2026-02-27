const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const Cinnamon = imports.gi.Cinnamon;
const AppFavs = imports.ui.appFavorites;
const Lang = imports.lang;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;

const UUID = "win11-menu@snokos";
function _(s) {
    let t = Gettext.dgettext(UUID, s);
    return (t !== s) ? t : Gettext.gettext(s);
}

// ─────────────────────────────────────────────────────────────────────────────
function Win11MenuApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

Win11MenuApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function (metadata, orientation, panel_height, instance_id) {
        try {
            Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
            this.set_applet_icon_name("start-here-symbolic");
            this.set_applet_tooltip(_("Win11 Menu"));

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this._s = new Settings.AppletSettings(this, metadata.uuid, instance_id);
            let D = Settings.BindingDirection.IN;
            let cb = Lang.bind(this, this._onSettingsChanged);

            let binds = [
                ["menu-width", "menuWidth"],
                ["menu-height", "menuHeight"],
                ["menu-opacity", "menuOpacity"],
                ["bg-color", "bgColor"],
                ["font-family", "fontFamily"],
                ["font-size", "fontSize"],
                ["font-color", "fontColor"],
                ["search-width-percent", "searchWidthPct"],
                ["search-height", "searchHeight"],
                ["search-radius", "searchRadius"],
                ["app-template", "appTemplate"],
                ["grid-columns", "gridColumns"],
                ["grid-icon-size", "gridIconSize"],
                ["grid-item-width", "gridItemWidth"],
                ["grid-item-padding", "gridItemPadding"],
                ["grid-item-radius", "gridItemRadius"],
                ["grid-show-label", "gridShowLabel"],
                ["all-columns", "allColumns"],
                ["all-icon-size", "allIconSize"],
                ["all-item-width", "allItemWidth"],
                ["all-show-label", "allShowLabel"],
                ["fav-apps", "favApps"],
                ["fav-icon-size", "favIconSize"],
                ["fav-spacing", "favSpacing"],
                ["applet-icon", "appletIcon"],
                ["applet-icon-size", "appletIconSize"],
            ];
            binds.forEach(Lang.bind(this, function (p) {
                this._s.bindProperty(D, p[0], p[1], cb, null);
            }));

            this._appSystem = null;
            this._recentMgr = null;
            this._view = "start";

            this._buildUI();

            try {
                this._appSystem = Cinnamon.AppSystem.get_default();
                if (Gio.RecentManager) this._recentMgr = Gio.RecentManager.get_default();
            } catch (e) { global.logError("[Win11Menu] sys: " + e); }

            if (this._appSystem) {
                this._sigInst = this._appSystem.connect("installed-changed", Lang.bind(this, this._reload));
                this._sigFavs = AppFavs.getAppFavorites().connect("changed", Lang.bind(this, this._reload));
            }

            this._reload();
            this._applySettings();
            this._applyPanelSettings();
            global.log("[Win11Menu] OK");
        } catch (e) {
            global.logError("[Win11Menu] Boot: " + e);
        }
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    _onSettingsChanged: function () {
        this._applySettings();
        this._applyPanelSettings();
        this._reload();
    },

    _applyPanelSettings: function () {
        try {
            if (this.appletIcon) {
                if (this.appletIcon.indexOf("/") !== -1) {
                    this.set_applet_icon_path(this.appletIcon);
                } else {
                    this.set_applet_icon_name(this.appletIcon);
                }
            }
            if (this.appletIconSize) {
                // Adjusting icon size on the panel
                this._panel_height = Main.panelManager.getPanel(this.panel_id).height;
                // Cinnamon applets usually scale icon based on panel height, 
                // but we can try to force a size if the applet supports it or by using St.Icon properties if accessible.
                // However, set_applet_icon_symbolic_size or similar isn't always standard for all applet types.
                // Standard TextIconApplet uses this._applet_icon_box to hold the icon.
            }
        } catch (e) {
            global.logError("[Win11Menu] applyPanelSettings: " + e);
        }
    },

    _applySettings: function () {
        if (!this.mainBox) return;

        // Responsive: clamp to screen
        let w = this.menuWidth, h = this.menuHeight;
        try {
            let mon = Main.layoutManager.primaryMonitor;
            if (mon) {
                w = Math.min(w, Math.floor(mon.width * 0.90));
                h = Math.min(h, Math.floor(mon.height * 0.90));
            }
        } catch (e) { }

        this.mainBox.set_size(w, h);

        // Apply background transparency via CSS
        let opacity = (this.menuOpacity !== undefined) ? Math.max(0.0, Math.min(1.0, this.menuOpacity)) : 0.92;
        let bgBase = this.bgColor || "20,20,30";
        this.mainBox.set_style(
            'background-color:rgba(' + bgBase + ',' + opacity + ');' +
            'font-family:"' + this.fontFamily + '";' +
            'font-size:' + this.fontSize + 'pt;' +
            'color:' + this.fontColor + ';'
        );

        if (this.searchEntry) {
            let sw = Math.floor(w * this.searchWidthPct / 100);
            this.searchEntry.set_size(sw, this.searchHeight);
            this.searchEntry.set_style(
                'border-radius:' + this.searchRadius + 'px;' +
                'border:1px solid rgba(100,180,255,0.4);' +
                'background-color:rgba(255,255,255,0.07);'
            );
        }
        if (this.favBox) {
            this.favBox.set_style('spacing:' + this.favSpacing + 'px;');
        }
    },

    // ── Build UI ──────────────────────────────────────────────────────────────
    _buildUI: function () {
        this.mainBox = new St.BoxLayout({ vertical: true, style_class: "w11-box" });

        // Top bar
        this.topBar = new St.BoxLayout({ vertical: false, style_class: "w11-top-bar" });
        this.searchEntry = new St.Entry({
            hint_text: _("Search apps…"),
            style_class: "w11-search",
            can_focus: true
        });
        this.searchEntry.clutter_text.connect("text-changed", Lang.bind(this, this._onSearch));
        this.topBar.add(this.searchEntry, { expand: true });

        // All Apps button with icon
        this.allAppsBtn = new St.Button({ style_class: "w11-all-apps-btn" });
        let bRow = new St.BoxLayout({ vertical: false, style: "spacing:5px;" });
        bRow.add_actor(new St.Icon({ icon_name: "view-grid-symbolic", icon_size: 14 }));
        this._allBtnLbl = new St.Label({ text: _("All apps") });
        bRow.add_actor(this._allBtnLbl);
        this.allAppsBtn.set_child(bRow);
        this.allAppsBtn.connect("clicked", Lang.bind(this, function () {
            this._switchView(this._view === "all" ? "start" : "all");
        }));
        this.topBar.add_actor(this.allAppsBtn);
        this.mainBox.add_actor(this.topBar);

        // Content area
        this.contentBin = new St.Bin({ x_expand: true, y_expand: true });
        this.mainBox.add(this.contentBin, { expand: true });

        this._buildBottomBar();
        this._buildViews();

        this.menu.addActor(this.mainBox);
        this.contentBin.set_child(this.startView);
    },

    _buildBottomBar: function () {
        this.bottomBar = new St.BoxLayout({ vertical: false, style_class: "w11-bottom-bar" });
        let user = new St.BoxLayout({ vertical: false, style: "spacing:10px;" });
        user.add_actor(new St.Icon({ icon_name: "avatar-default-symbolic", icon_size: 28 }));
        user.add_actor(new St.Label({
            text: GLib.get_real_name() || GLib.get_user_name(),
            style: "font-weight:bold;"
        }));
        this.bottomBar.add_actor(user);
        this.bottomBar.add(new St.Bin({ x_expand: true }), { expand: true });
        this.favBox = new St.BoxLayout({ vertical: false, style_class: "w11-fav-box" });
        this.bottomBar.add_actor(this.favBox);

        // Info button
        let infoBtn = new St.Button({ style_class: "w11-power-btn" });
        infoBtn.set_child(new St.Icon({ icon_name: "help-about-symbolic", icon_size: 20 }));
        infoBtn.connect("clicked", Lang.bind(this, this._openAbout));
        this.bottomBar.add_actor(infoBtn);

        let pwr = new St.Button({ style_class: "w11-power-btn" });
        pwr.set_child(new St.Icon({ icon_name: "system-shutdown-symbolic", icon_size: 20 }));
        pwr.connect("clicked", function () { Util.spawnCommandLine("cinnamon-session-quit --power-off"); });
        this.bottomBar.add_actor(pwr);
        this.mainBox.add_actor(this.bottomBar);
    },

    // ── About / Info dialog ───────────────────────────────────────────────────
    _openAbout: function () {
        this.menu.close();
        try {
            let dialog = new ModalDialog.ModalDialog({ styleClass: "w11-about-dialog" });

            let contentBox = new St.BoxLayout({ vertical: true, style: "spacing:16px; padding:24px;" });

            // Logo + Title row
            let titleRow = new St.BoxLayout({ vertical: false, style: "spacing:14px;" });
            let logoIcon = new St.Icon({ icon_name: "start-here-symbolic", icon_size: 56, style: "color:#4da6ff;" });
            titleRow.add_actor(logoIcon);
            let titleCol = new St.BoxLayout({ vertical: true, style: "spacing:4px;" });
            titleCol.add_actor(new St.Label({ text: "Win11 Menu — SnokOS Edition", style: "font-size:17px; font-weight:bold; color:#ffffff;" }));
            titleCol.add_actor(new St.Label({ text: _("Version 1.0.1  ·  Cinnamon Applet"), style: "font-size:11px; color:rgba(200,200,200,0.8);" }));
            titleRow.add_actor(titleCol);
            contentBox.add_actor(titleRow);

            // Separator
            let sep = new St.BoxLayout({ style: "height:1px; background-color:rgba(100,180,255,0.25); margin:0 4px;" });
            contentBox.add_actor(sep);

            // Info rows helper
            let addRow = Lang.bind(this, function (label, value, link) {
                let row = new St.BoxLayout({ vertical: false, style: "spacing:10px; padding:2px 0;" });
                row.add_actor(new St.Label({ text: label, style: "color:rgba(180,210,255,0.85); min-width:110px;" }));
                if (link) {
                    let btn = new St.Button({ style: "color:#4da6ff; text-decoration:underline;" });
                    btn.set_child(new St.Label({ text: value }));
                    btn.connect("clicked", function () { Util.spawnCommandLine("xdg-open '" + link + "'"); });
                    row.add_actor(btn);
                } else {
                    row.add_actor(new St.Label({ text: value, style: "color:#eeeeee;" }));
                }
                contentBox.add_actor(row);
            });

            addRow("👤 Developer:", "SnokOS Team");
            addRow("📧 Gmail:", "SnokSoft@gmail.com", "mailto:SnokSoft@gmail.com");
            addRow("🌐 Website:", "snokos.github.io/SnokOS", "https://snokos.github.io/SnokOS/");
            addRow("🐙 GitHub:", "github.com/SnokOS", "https://github.com/SnokOS");
            addRow("📞 TEL:", "+216 26 360 802");

            dialog.contentLayout.add_actor(contentBox);

            dialog.setButtons([{
                label: _("Close"),
                action: function () { dialog.destroy(); },
                key: Clutter.Escape
            }]);

            dialog.open(global.get_current_time());
        } catch (e) {
            global.logError("[Win11Menu] About dialog error: " + e);
        }
    },

    // ── App Picker (add to favorites) ─────────────────────────────────────────
    openAppPicker: function () {
        if (!this._appSystem) return;
        this.menu.close();
        try {
            let dialog = new ModalDialog.ModalDialog({ styleClass: "w11-picker-dialog" });
            let box = new St.BoxLayout({ vertical: true, style: "spacing:12px; padding:20px; min-width:520px;" });

            // Header
            box.add_actor(new St.Label({ text: _("Add App to Favorites"), style: "font-size:15px; font-weight:bold; color:#fff; padding-bottom:4px;" }));

            // Search field
            let searchEntry = new St.Entry({ hint_text: _("Filter apps…"), style: "border-radius:8px; padding:6px 12px; margin-bottom:4px;" });
            box.add_actor(searchEntry);

            // Scrollable app list
            let scroll = new St.ScrollView({
                style: "max-height:340px;",
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC
            });
            let list = new St.BoxLayout({ vertical: true, style: "spacing:2px;" });
            scroll.add_actor(list);
            box.add_actor(scroll);

            let allApps = this._getApps();

            let populateList = Lang.bind(this, function (filter) {
                list.get_children().forEach(function (c) { c.destroy(); });
                let apps = filter ? allApps.filter(function (a) {
                    return a.get_name().toLowerCase().indexOf(filter.toLowerCase()) !== -1;
                }) : allApps;

                apps.forEach(Lang.bind(this, function (app) {
                    let appId = app.get_id().replace(/\.desktop$/, "");
                    let current = (this.favApps || "").split(",").map(s => s.trim()).filter(s => s.length > 0);
                    let isFav = current.indexOf(appId) !== -1;

                    let row = new St.BoxLayout({ vertical: false, style: "border-radius:6px; padding:6px 10px;" });
                    let icon;
                    try { icon = app.create_icon_texture(22); } catch (e) { }
                    if (!icon) icon = new St.Icon({ icon_name: "application-x-executable", icon_size: 22 });
                    row.add_actor(icon);

                    let lbl = new St.Label({ text: app.get_name(), style: "color:#eee; padding-left:10px; margin-top:2px;" });
                    row.add(lbl, { expand: true });

                    let actionBtn = new St.Button({
                        style_class: isFav ? "w11-power-btn" : "w11-all-apps-btn",
                        style: "padding: 4px 10px;"
                    });
                    actionBtn.set_child(new St.Label({ text: isFav ? _("Remove") : _("Add") }));
                    actionBtn.connect("clicked", Lang.bind(this, function () {
                        if (isFav) {
                            current = current.filter(id => id !== appId);
                        } else {
                            current.push(appId);
                        }
                        this._s.setValue("fav-apps", current.join(","));
                        this._reload();
                        populateList(searchEntry.get_text()); // Refresh list state
                    }));
                    row.add_actor(actionBtn);
                    list.add_actor(row);
                }));
            });

            populateList("");
            searchEntry.clutter_text.connect("text-changed", Lang.bind(this, function () {
                populateList(searchEntry.get_text());
            }));

            dialog.contentLayout.add_actor(box);
            dialog.setButtons([{
                label: _("Cancel"),
                action: function () { dialog.destroy(); },
                key: Clutter.Escape
            }]);
            dialog.open(global.get_current_time());
        } catch (e) {
            global.logError("[Win11Menu] App picker error: " + e);
        }
    },

    // ── Each view has a vertical BoxLayout containing a ScrollView ────────────
    _buildViews: function () {
        // Start View
        this.startView = new St.BoxLayout({ vertical: true });
        let sHdr = new St.BoxLayout({ vertical: false, style_class: "w11-section-hdr" });
        sHdr.add_actor(new St.Label({ text: _("All Applications"), style_class: "w11-section-title" }));
        this.startView.add_actor(sHdr);
        this.startScroll = new St.ScrollView({
            style_class: "w11-grid-scroll",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        this.startInner = new St.BoxLayout({ vertical: true, style_class: "w11-grid" });
        this.startScroll.add_actor(this.startInner);
        this.startView.add(this.startScroll, { expand: true });

        // All Apps View
        this.allAppsView = new St.BoxLayout({ vertical: true });
        let aHdr = new St.BoxLayout({ vertical: false, style_class: "w11-section-hdr" });
        aHdr.add_actor(new St.Label({ text: _("All Applications"), style_class: "w11-section-title" }));
        this.allAppsView.add_actor(aHdr);
        this.allAppsScroll = new St.ScrollView({
            style_class: "w11-grid-scroll",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        this.allAppsInner = new St.BoxLayout({ vertical: true, style_class: "w11-grid" });
        this.allAppsScroll.add_actor(this.allAppsInner);
        this.allAppsView.add(this.allAppsScroll, { expand: true });

        // Search View
        this.searchView = new St.BoxLayout({ vertical: true });
        let srHdr = new St.BoxLayout({ vertical: false, style_class: "w11-section-hdr" });
        srHdr.add_actor(new St.Label({ text: _("Search Results"), style_class: "w11-section-title" }));
        this.searchView.add_actor(srHdr);
        this.searchScroll = new St.ScrollView({
            style_class: "w11-grid-scroll",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        this.searchInner = new St.BoxLayout({ vertical: true, style_class: "w11-grid" });
        this.searchScroll.add_actor(this.searchInner);
        this.searchView.add(this.searchScroll, { expand: true });
    },

    // ── Fill a BoxLayout inner-box with apps in rows ──────────────────────────
    _fillGrid: function (innerBox, apps, cols, iconSize, itemWidth, showLabel) {
        innerBox.get_children().forEach(function (c) { c.destroy(); });

        let row = null;
        apps.forEach(Lang.bind(this, function (app, i) {
            if (i % cols === 0) {
                row = new St.BoxLayout({ vertical: false, style: "padding:2px 8px;" });
                innerBox.add_actor(row);
            }
            let btn = this._makeBtn(app, iconSize, itemWidth, showLabel);
            row.add_actor(btn);
        }));
    },

    // ── Build a single app button (5 templates) ───────────────────────────────
    _makeBtn: function (app, iconSize, itemWidth, showLabel) {
        let tpl = this.appTemplate || "1";
        let btn;
        let icon;
        try { icon = app.create_icon_texture(iconSize); } catch (e) { }
        if (!icon) icon = new St.Icon({ icon_name: "application-x-executable", icon_size: iconSize });

        let baseStyle = "min-width:" + itemWidth + "px; max-width:" + itemWidth + "px;";

        if (tpl === "2") {
            btn = new St.Button({
                style_class: "w11-t2",
                style: baseStyle + "border-radius:" + this.gridItemRadius + "px; padding:" + this.gridItemPadding + "px 6px;"
            });
            let box = new St.BoxLayout({ vertical: true, style: "spacing:5px;" });
            box.add_actor(new St.Bin({ child: icon, x_align: St.Align.MIDDLE, x_fill: true }));
            if (showLabel) {
                let lbl = new St.Label({ text: app.get_name(), style: "text-align:center; font-size:11px; font-weight:600;" });
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                box.add_actor(lbl);
            }
            btn.set_child(box);

        } else if (tpl === "3") {
            btn = new St.Button({
                x_fill: true,
                style_class: "w11-t3",
                style: "border-radius:" + this.gridItemRadius + "px; padding:" + this.gridItemPadding + "px 14px; min-width:" + (itemWidth * 2) + "px;"
            });
            let box = new St.BoxLayout({ vertical: false, style: "spacing:12px;" });
            box.add_actor(icon);
            let nm = new St.Label({ text: app.get_name(), style: "font-weight:600; font-size:12px;" });
            nm.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add(nm, { expand: true });
            btn.set_child(box);

        } else if (tpl === "4") {
            btn = new St.Button({
                style_class: "w11-t4",
                style: baseStyle + "border-radius:24px; padding:10px 8px;"
            });
            let box = new St.BoxLayout({ vertical: true, style: "spacing:4px;" });
            box.add_actor(new St.Bin({ child: icon, x_align: St.Align.MIDDLE, x_fill: true }));
            if (showLabel) {
                let lbl = new St.Label({ text: app.get_name(), style: "text-align:center; font-size:10px;" });
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                box.add_actor(lbl);
            }
            btn.set_child(box);

        } else if (tpl === "5") {
            btn = new St.Button({
                style_class: "w11-t5",
                style: baseStyle + "border-radius:" + this.gridItemRadius + "px; padding:" + this.gridItemPadding + "px 6px;"
            });
            let box = new St.BoxLayout({ vertical: true, style: "spacing:4px;" });
            box.add_actor(new St.Bin({ child: icon, x_align: St.Align.MIDDLE, x_fill: true }));
            if (showLabel) {
                let lbl = new St.Label({ text: app.get_name(), style: "text-align:center; font-size:10px;" });
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                box.add_actor(lbl);
            }
            btn.set_child(box);

        } else {
            btn = new St.Button({
                style_class: "w11-t1",
                style: baseStyle + "border-radius:" + this.gridItemRadius + "px; padding:" + this.gridItemPadding + "px 6px;"
            });
            let box = new St.BoxLayout({ vertical: true, style: "spacing:4px;" });
            box.add_actor(new St.Bin({ child: icon, x_align: St.Align.MIDDLE, x_fill: true }));
            if (showLabel) {
                let lbl = new St.Label({ text: app.get_name(), style: "text-align:center; font-size:10px;" });
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                box.add_actor(lbl);
            }
            btn.set_child(box);
        }

        btn.connect("clicked", Lang.bind(this, function () {
            try { app.open_new_window(-1); } catch (e) { }
            this.menu.close();
        }));
        return btn;
    },

    // ── Switch view ───────────────────────────────────────────────────────────
    _switchView: function (mode) {
        this._view = mode;
        if (mode === "start") {
            this.contentBin.set_child(this.startView);
            this._allBtnLbl.set_text(_("All apps"));
            this._loadStart();
        } else if (mode === "all") {
            this.contentBin.set_child(this.allAppsView);
            this._allBtnLbl.set_text(_("← Back"));
            this._loadAllApps();
        } else if (mode === "search") {
            this.contentBin.set_child(this.searchView);
        }
    },

    // ── Reload ────────────────────────────────────────────────────────────────
    _reload: function () {
        try {
            if (this._view === "start") this._loadStart();
            else if (this._view === "all") this._loadAllApps();
            this._loadFavs();
        } catch (e) { global.logError("[Win11Menu] reload: " + e); }
    },

    _getApps: function () {
        if (!this._appSystem) return [];
        let apps = this._appSystem.get_all().filter(function (a) {
            return !a.get_nodisplay();
        });
        apps.sort(function (a, b) { return a.get_name().localeCompare(b.get_name()); });
        return apps;
    },

    _loadStart: function () {
        if (!this.startInner) return;
        let apps = this._getApps();
        this._fillGrid(this.startInner, apps,
            Math.max(1, this.gridColumns || 5),
            this.gridIconSize, this.gridItemWidth, this.gridShowLabel);
    },

    _catLabel: function (cat) {
        let map = {
            "AudioVideo": "🎵 Audio Video",
            "Audio": "🎵 Audio",
            "Video": "🎬 Video",
            "Development": "💻 Development",
            "Education": "🎓 Education",
            "Game": "🎮 Game",
            "Graphics": "🖼 Graphics",
            "Network": "🌐 Network",
            "Office": "📄 Office",
            "Science": "🔬 Science",
            "Settings": "⚙ Settings",
            "System": "🖥 System",
            "Utility": "🔧 Utility",
            "Accessibility": "♿ Accessibility",
            "Adobe": "🖼 Adobe",
            "Other": "📦 Other",
        };
        return map[cat] || ("📁 " + cat);
    },

    _getAppCategory: function (app) {
        try {
            let info = app.get_app_info ? app.get_app_info() : null;
            if (info && info.get_categories) {
                let cats = (info.get_categories() || "").split(";").map(function (c) { return c.trim(); })
                    .filter(function (c) { return c.length > 0; });
                let known = ["AudioVideo", "Audio", "Video", "Development", "Education",
                    "Game", "Graphics", "Network", "Office", "Science",
                    "Settings", "System", "Utility", "Adobe", "Accessibility"];
                for (let i = 0; i < cats.length; i++) {
                    if (known.indexOf(cats[i]) !== -1) return cats[i];
                }
                if (cats.length > 0) return cats[0];
            }
        } catch (e) { }
        return "Other";
    },

    _loadAllApps: function () {
        if (!this.allAppsInner || !this._appSystem) return;
        this.allAppsInner.get_children().forEach(function (c) { c.destroy(); });

        let apps = this._getApps();
        let cols = Math.max(1, this.allColumns || 5);

        let groups = {};
        apps.forEach(Lang.bind(this, function (app) {
            let cat = this._getAppCategory(app);
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(app);
        }));

        let catNames = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b); });

        catNames.forEach(Lang.bind(this, function (cat) {
            let hdrBox = new St.BoxLayout({ vertical: false, style_class: "w11-cat-hdr" });
            hdrBox.add_actor(new St.Label({
                text: this._catLabel(cat),
                style_class: "w11-cat-title"
            }));
            let sep = new St.BoxLayout({ style_class: "w11-cat-sep", x_expand: true });
            hdrBox.add(sep, { expand: true });
            this.allAppsInner.add_actor(hdrBox);

            let catApps = groups[cat];
            catApps.sort(function (a, b) { return a.get_name().localeCompare(b.get_name()); });
            let row = null;
            catApps.forEach(Lang.bind(this, function (app, i) {
                if (i % cols === 0) {
                    row = new St.BoxLayout({ vertical: false, style: "padding:2px 8px;" });
                    this.allAppsInner.add_actor(row);
                }
                let btn = this._makeBtn(app, this.allIconSize, this.allItemWidth, this.allShowLabel);
                row.add_actor(btn);
            }));

            this.allAppsInner.add_actor(new St.BoxLayout({ style: "height:8px;" }));
        }));
    },

    _loadFavs: function () {
        if (!this.favBox || !this._appSystem) return;
        this.favBox.get_children().forEach(function (c) { c.destroy(); });
        if (!this.favApps) return;
        let targets = this.favApps.split(",")
            .map(function (s) { return s.trim().toLowerCase(); })
            .filter(function (s) { return s.length > 0; });
        let all = this._appSystem.get_all();
        targets.forEach(Lang.bind(this, function (t) {
            let app = null;
            for (let i = 0; i < all.length; i++) {
                if (all[i].get_id().toLowerCase().indexOf(t) !== -1 ||
                    all[i].get_name().toLowerCase() === t) { app = all[i]; break; }
            }
            if (!app) return;
            let btn = new St.Button({ style_class: "w11-fav-item" });
            let icon;
            try { icon = app.create_icon_texture(this.favIconSize); } catch (e) { }
            if (!icon) icon = new St.Icon({ icon_name: "application-x-executable", icon_size: this.favIconSize });
            btn.set_child(icon);
            btn.connect("clicked", Lang.bind(this, function () {
                try { app.open_new_window(-1); } catch (e) { }
                this.menu.close();
            }));
            this.favBox.add_actor(btn);
        }));

        // "+" add button
        let addBtn = new St.Button({ style_class: "w11-fav-add-btn", style: "border-radius:50%; padding:2px;" });
        addBtn.set_child(new St.Icon({ icon_name: "list-add-symbolic", icon_size: this.favIconSize || 26 }));
        addBtn.connect("clicked", Lang.bind(this, function () {
            this.openAppPicker();
        }));
        this.favBox.add_actor(addBtn);
    },

    // ── Search ────────────────────────────────────────────────────────────────
    _onSearch: function () {
        if (!this.searchEntry || !this._appSystem) return;
        let txt = this.searchEntry.get_text().toLowerCase().trim();
        if (!txt) { this._switchView("start"); return; }
        this._view = "search";
        this.contentBin.set_child(this.searchView);

        let matches = this._appSystem.get_all().filter(function (a) {
            if (a.get_nodisplay()) return false;
            let desc = "";
            try { desc = a.get_description() || ""; } catch (e) { }
            return a.get_name().toLowerCase().indexOf(txt) !== -1 ||
                desc.toLowerCase().indexOf(txt) !== -1;
        }).slice(0, 60);

        this._fillGrid(this.searchInner, matches,
            Math.max(1, this.gridColumns || 5),
            this.gridIconSize, this.gridItemWidth, this.gridShowLabel);
    },

    // ── Click ─────────────────────────────────────────────────────────────────
    on_applet_clicked: function () {
        this._applySettings();
        this.menu.toggle();
        if (this.menu.isOpen && this.searchEntry) {
            this.searchEntry.set_text("");
            if (this._view !== "start") this._switchView("start");
            this.searchEntry.grab_key_focus();
        }
    },

    // ── Destroy ───────────────────────────────────────────────────────────────
    destroy: function () {
        try {
            if (this._sigInst) this._appSystem.disconnect(this._sigInst);
            if (this._sigFavs) AppFavs.getAppFavorites().disconnect(this._sigFavs);
        } catch (e) { }
        Applet.TextIconApplet.prototype.destroy.call(this);
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new Win11MenuApplet(metadata, orientation, panel_height, instance_id);
}
