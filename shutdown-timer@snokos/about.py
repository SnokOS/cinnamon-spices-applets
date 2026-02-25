#!/usr/bin/env python3
import gi  # type: ignore
import sys

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GdkPixbuf  # type: ignore

def main():
    dialog = Gtk.AboutDialog()
    dialog.set_program_name("SnokOS Info")
    dialog.set_version("1.0")
    dialog.set_comments("Shutdown the system after a specified time\n\nGmail: SnokSoft@gmail.com\nTelephone: +216 26 360 802\nGithub: github.com/SnokOS")
    dialog.set_website("https://snokos.github.io/SnokOS")
    dialog.set_website_label("SnokOS Website")
    dialog.set_authors(["SnokOS Team"])
    
    if len(sys.argv) > 1:
        logo_path = sys.argv[1]
        try:
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(logo_path, 128, 128, True)
            dialog.set_logo(pixbuf)
        except Exception as e:
            print(f"Error loading logo: {e}")

    dialog.connect('response', lambda d, r: Gtk.main_quit())
    dialog.show_all()
    Gtk.main()

if __name__ == "__main__":
    main()
