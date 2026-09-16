imports.gi.versions.Gtk = '3.0';
const {Gtk} = imports.gi;
Gtk.init(null);
for (const name of ['Left A', 'Left B', 'Right A', 'Right B']) {
    const window = new Gtk.Window({title: name, default_width: 600, default_height: 400});
    window.add(new Gtk.Label({label: name}));
    window.show_all();
}
Gtk.main();
