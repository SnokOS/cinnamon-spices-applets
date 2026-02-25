const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const Main = imports.ui.main;

// Translation fallback
if (typeof _ === 'undefined') {
    var _ = function (str) { return str; };
}

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function (metadata, orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        this.metadata = metadata;

        this.set_applet_icon_name("system-shutdown");
        this.set_applet_tooltip(_("Shutdown Timer"));
        this.set_applet_label(_("Off"));

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._duration = 0;
        this._timerId = 0;
        this._beepsCount = 0;

        this._createMenu();
    },

    _createMenu: function () {
        this.menu.removeAll();

        let presets = [
            { label: "5m", seconds: 5 * 60 },
            { label: "10m", seconds: 10 * 60 },
            { label: "15m", seconds: 15 * 60 },
            { label: "30m", seconds: 30 * 60 },
            { label: "1h", seconds: 60 * 60 },
            { label: "2h", seconds: 120 * 60 },
            { label: "3h", seconds: 180 * 60 },
            { label: "4h", seconds: 240 * 60 },
            { label: "5h", seconds: 300 * 60 }
        ];

        presets.forEach(item => {
            let menuitem = new PopupMenu.PopupMenuItem(item.label);
            menuitem.connect('activate', Lang.bind(this, function () {
                this._startTimer(item.seconds);
            }));
            this.menu.addMenuItem(menuitem);
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Custom Time Input
        let customItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        let box = new St.BoxLayout();

        this.hourEntry = new St.Entry({ text: "", hint_text: "HH", style_class: "hour-entry", can_focus: true });
        this.minEntry = new St.Entry({ text: "", hint_text: "MM", style_class: "min-entry", can_focus: true });

        let setButton = new St.Button({ label: "Set", style_class: "set-button" });

        setButton.connect('clicked', Lang.bind(this, function () {
            let h = parseInt(this.hourEntry.get_text()) || 0;
            let m = parseInt(this.minEntry.get_text()) || 0;
            let totalSeconds = (h * 3600) + (m * 60);
            if (totalSeconds > 0) {
                this._startTimer(totalSeconds);
            }
            this.menu.close();
        }));

        box.add(new St.Label({ text: "Custom: " }));
        box.add(this.hourEntry);
        box.add(new St.Label({ text: ":" }));
        box.add(this.minEntry);
        box.add(setButton);
        customItem.addActor(box);
        this.menu.addMenuItem(customItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let cancelItem = new PopupMenu.PopupMenuItem("Cancel Timer");
        cancelItem.connect('activate', Lang.bind(this, function () {
            this._stopTimer();
        }));
        this.menu.addMenuItem(cancelItem);
    },

    _startTimer: function (seconds) {
        this._stopTimer();
        this._duration = seconds;
        this._beepsCount = 0;
        this._updateLabel();
        this._timerId = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._onTick));
    },

    _stopTimer: function () {
        if (this._timerId > 0) {
            Mainloop.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._duration = 0;
        this.set_applet_label(_("Off"));
        this._setLabelColor("green");
    },

    _onTick: function () {
        if (this._duration <= 0) {
            this._timerId = 0;
            this._shutdown();
            return false;
        }

        this._duration--;
        this._updateLabel();

        // 5 minute warning
        if (this._duration === 5 * 60) {
            this._playBeeps();
        }

        return true;
    },

    _updateLabel: function () {
        let h = Math.floor(this._duration / 3600);
        let m = Math.floor((this._duration % 3600) / 60);
        let s = this._duration % 60;

        let timeStr = "";
        if (h > 0) timeStr += h + "h ";
        timeStr += m + "m " + s + "s";

        this.set_applet_label(timeStr);

        if (this._duration <= 5 * 60) {
            this._setLabelColor("red");
        } else {
            this._setLabelColor("green");
        }
    },

    _setLabelColor: function (color) {
        // We use CSS classes defined in stylesheet.css
        let label = this._applet_label;
        if (color === "red") {
            label.add_style_class_name("panel-label-red");
            label.remove_style_class_name("panel-label-green");
        } else {
            label.add_style_class_name("panel-label-green");
            label.remove_style_class_name("panel-label-red");
        }
    },

    _playBeeps: function () {
        // Play 3 beeps
        for (let i = 0; i < 3; i++) {
            Mainloop.timeout_add(i * 1000, Lang.bind(this, function () {
                global.play_theme_sound("dialog-information");
                return false;
            }));
        }
    },

    _shutdown: function () {
        global.log("Shutdown Timer: Timer expired, triggering shutdown...");
        this._stopTimer();
        Main.notify(_("Shutdown Timer"), _("The timer has expired. Shutting down the system now..."));

        // Using systemctl poweroff for a more robust shutdown
        global.log("Shutdown Timer: Executing systemctl poweroff");
        Util.spawnCommandLine("systemctl poweroff");
    },

    on_applet_clicked: function (event) {
        this.menu.toggle();
    },

    openAbout: function () {
        const Util = imports.misc.util;
        const Mainloop = imports.mainloop;
        let logoPath = this.metadata.path + "/logo.png";
        let scriptPath = this.metadata.path + "/about.py";

        // Delay execution to allow the context menu to fully close and release pointer grabs
        Mainloop.timeout_add(500, () => {
            try {
                Util.spawnCommandLine(`python3 "${scriptPath}" "${logoPath}"`);
            } catch (e) {
                global.log("Error opening custom about dialog: " + e);
            }
            return false;
        });
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}
