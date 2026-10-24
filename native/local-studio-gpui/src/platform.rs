use std::borrow::Cow;
use std::path::PathBuf;
use std::rc::Rc;

use futures::channel::oneshot;
use gpui::{
    Action, App, Bounds, ClipboardItem, Decorations, KeyBinding, KeyBindingContextPredicate,
    KeybindingKeystroke, Menu, MenuItem, OsAction, Result, SharedString, SystemMenuType, Tiling,
    TitlebarOptions, Window, WindowBounds, WindowControls, WindowDecorations, WindowOptions, point,
    px, size,
};

use crate::actions::{
    BINDINGS, CloseWindow, CopyControllerUrl, CopyLogRow, FocusFilter, Hide, HideOthers, LoadModel,
    Minimize, Quit, Refresh, SaveLog, ShowAll, ThemeDark, ThemeLight, ThemeSystem,
    ToggleFullscreen,
};
use crate::assets::FONTS;
use crate::theme::{ThemeChoice, size as layout, space};

pub const APP_ID: &str = "dev.sybil.LocalStudio";
const APP_NAME: &str = "Local Studio";
const MAC: bool = cfg!(target_os = "macos");
pub const IN_APP_MENU: bool = !MAC;
const WINDOW: (f32, f32) = (1440., 900.);
const WINDOW_MIN: (f32, f32) = (960., 600.);
const TRAFFIC_LIGHTS: f32 = 80.;
const TRAFFIC_LIGHT_SIZE: f32 = 16.;
const NO_PORTAL: &str = "xdg-desktop-portal";

#[derive(Clone, Copy, Debug)]
pub enum Decor {
    Native,
    ClientDrawn {
        controls: WindowControls,
        tiling: Tiling,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct Chrome {
    pub decor: Decor,
    pub titlebar_height: f32,
    pub leading_inset: f32,
    pub movable: bool,
}

#[derive(Debug)]
pub enum DialogError {
    NoPortal(String),
    Failed(String),
}

fn platform_bindings() -> Vec<(&'static str, Box<dyn Action>)> {
    if MAC {
        vec![
            ("cmd-h", Box::new(Hide)),
            ("alt-cmd-h", Box::new(HideOthers)),
            ("cmd-m", Box::new(Minimize)),
            ("cmd-w", Box::new(CloseWindow)),
            ("cmd-ctrl-f", Box::new(ToggleFullscreen)),
        ]
    } else {
        vec![
            ("f11", Box::new(ToggleFullscreen)),
            ("ctrl-w", Box::new(CloseWindow)),
        ]
    }
}

fn load_bindings(cx: &mut App) -> Vec<String> {
    let mut failures = Vec::new();
    let mut loaded = Vec::new();
    let shared = BINDINGS
        .iter()
        .map(|binding| (binding.keys, (binding.action)(), binding.context));
    let native = platform_bindings()
        .into_iter()
        .map(|(keys, action)| (keys, action, None));
    for (keys, action, context) in shared.chain(native) {
        let predicate = match context.map(KeyBindingContextPredicate::parse) {
            Some(Ok(predicate)) => Some(Rc::new(predicate)),
            Some(Err(error)) => {
                failures.push(format!("invalid key context for {keys}: {error}"));
                continue;
            }
            None => None,
        };
        match KeyBinding::load(keys, action, predicate, false, None, cx) {
            Ok(binding) => loaded.push(binding),
            Err(error) => failures.push(format!("invalid keystroke {keys}: {error}")),
        }
    }
    cx.bind_keys(loaded);
    failures
}

fn on_active_window(cx: &mut App, f: impl FnOnce(&mut Window)) {
    let Some(handle) = cx.active_window() else {
        return;
    };
    if let Err(error) = handle.update(cx, |_, window, _| f(window)) {
        eprintln!("window action failed: {error:#}");
    }
}

pub fn init(cx: &mut App) -> Vec<String> {
    let mut failures = Vec::new();
    let fonts = FONTS.iter().map(|bytes| Cow::Borrowed(*bytes)).collect();
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        failures.push(format!("cannot load bundled fonts: {error:#}"));
    }
    cx.on_action(|_: &Quit, cx: &mut App| cx.quit());
    cx.on_action(|_: &ToggleFullscreen, cx: &mut App| {
        on_active_window(cx, |window| window.toggle_fullscreen())
    });
    cx.on_action(|_: &Minimize, cx: &mut App| {
        on_active_window(cx, |window| window.minimize_window())
    });
    cx.on_action(|_: &CloseWindow, cx: &mut App| on_active_window(cx, Window::remove_window));
    cx.on_action(|_: &Hide, cx: &mut App| cx.hide());
    cx.on_action(|_: &HideOthers, cx: &mut App| cx.hide_other_apps());
    cx.on_action(|_: &ShowAll, cx: &mut App| cx.unhide_other_apps());
    if !MAC {
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
    }
    failures.extend(load_bindings(cx));
    cx.set_menus(menus(ThemeChoice::System));
    failures
}

pub fn window_options(cx: &App) -> WindowOptions {
    let bounds = Bounds::centered(None, size(px(WINDOW.0), px(WINDOW.1)), cx);
    let light_offset = (layout::TITLEBAR - TRAFFIC_LIGHT_SIZE) / 2.;
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitlebarOptions {
            title: Some(APP_NAME.into()),
            appears_transparent: MAC,
            traffic_light_position: MAC.then(|| point(px(space::S3), px(light_offset))),
        }),
        app_id: Some(APP_ID.into()),
        window_decorations: Some(WindowDecorations::Server),
        window_min_size: Some(size(px(WINDOW_MIN.0), px(WINDOW_MIN.1))),
        ..Default::default()
    }
}

pub fn chrome(window: &Window) -> Chrome {
    if MAC {
        return Chrome {
            decor: Decor::Native,
            titlebar_height: layout::TITLEBAR,
            leading_inset: TRAFFIC_LIGHTS,
            movable: true,
        };
    }
    match window.window_decorations() {
        Decorations::Server => Chrome {
            decor: Decor::Native,
            titlebar_height: 0.,
            leading_inset: 0.,
            movable: false,
        },
        Decorations::Client { tiling } => Chrome {
            decor: Decor::ClientDrawn {
                controls: window.window_controls(),
                tiling,
            },
            titlebar_height: layout::TITLEBAR,
            leading_inset: 0.,
            movable: true,
        },
    }
}

pub fn titlebar_double_click(window: &mut Window) {
    if MAC {
        window.titlebar_double_click();
    } else {
        window.zoom_window();
    }
}

pub fn menus(theme: ThemeChoice) -> Vec<Menu> {
    let mut app = Vec::new();
    if MAC {
        app.extend([
            MenuItem::os_submenu("Services", SystemMenuType::Services),
            MenuItem::separator(),
            MenuItem::action("Hide Local Studio", Hide),
            MenuItem::action("Hide Others", HideOthers),
            MenuItem::action("Show All", ShowAll),
            MenuItem::separator(),
        ]);
    }
    app.push(MenuItem::action("Quit Local Studio", Quit));
    let mut window = vec![MenuItem::action("Toggle Full Screen", ToggleFullscreen)];
    if MAC {
        window.splice(
            0..0,
            [
                MenuItem::action("Minimize", Minimize),
                MenuItem::action("Close Window", CloseWindow),
                MenuItem::separator(),
            ],
        );
    }
    vec![
        Menu::new(APP_NAME).items(app),
        Menu::new("File").items([
            MenuItem::action("Load Model\u{2026}", LoadModel),
            MenuItem::separator(),
            MenuItem::action("Save Log\u{2026}", SaveLog),
        ]),
        Menu::new("Edit").items([
            MenuItem::os_action("Copy Log Row", CopyLogRow, OsAction::Copy),
            MenuItem::action("Copy Controller URL", CopyControllerUrl),
            MenuItem::separator(),
            MenuItem::action("Filter Requests", FocusFilter),
        ]),
        Menu::new("View").items([
            MenuItem::action("Refresh", Refresh),
            MenuItem::separator(),
            MenuItem::action("System Theme", ThemeSystem).checked(theme == ThemeChoice::System),
            MenuItem::action("Light Theme", ThemeLight).checked(theme == ThemeChoice::Light),
            MenuItem::action("Dark Theme", ThemeDark).checked(theme == ThemeChoice::Dark),
        ]),
        Menu::new("Window").items(window),
    ]
}

pub fn copy_text(text: String, cx: &mut App) {
    cx.write_to_clipboard(ClipboardItem::new_string(text));
}

pub fn save_dialog(suggested: &str, cx: &mut App) -> oneshot::Receiver<Result<Option<PathBuf>>> {
    let directory = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir);
    cx.prompt_for_new_path(&directory, Some(suggested))
}

pub fn dialog_error(error: &impl std::fmt::Display) -> DialogError {
    let message = format!("{error:#}");
    if message.contains(NO_PORTAL) {
        DialogError::NoPortal("File dialogs need xdg-desktop-portal".to_string())
    } else {
        DialogError::Failed(message)
    }
}

fn key_name(key: &str) -> String {
    match (MAC, key) {
        (true, "up") => "\u{2191}".into(),
        (true, "down") => "\u{2193}".into(),
        (true, "left") => "\u{2190}".into(),
        (true, "right") => "\u{2192}".into(),
        (true, "escape") => "\u{238b}".into(),
        (true, "enter") => "\u{21a9}".into(),
        (false, "escape") => "Esc".into(),
        (_, key) => {
            let mut chars = key.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => String::new(),
            }
        }
    }
}

fn keystroke_label(keystroke: &KeybindingKeystroke) -> String {
    let m = keystroke.modifiers();
    let names: [(bool, &str, &str); 4] = [
        (m.control, "\u{2303}", "Ctrl"),
        (m.alt, "\u{2325}", "Alt"),
        (m.shift, "\u{21e7}", "Shift"),
        (m.platform, "\u{2318}", "Super"),
    ];
    let mut parts: Vec<String> = names
        .iter()
        .filter(|(on, _, _)| *on)
        .map(|(_, mac, linux)| if MAC { *mac } else { *linux }.to_string())
        .collect();
    parts.push(key_name(keystroke.key()));
    parts.join(if MAC { "" } else { "+" })
}

pub fn key_hint(action: &dyn Action, window: &Window, _: &App) -> Option<SharedString> {
    window
        .highest_precedence_binding_for_action(action)
        .map(|binding| {
            binding
                .keystrokes()
                .iter()
                .map(keystroke_label)
                .collect::<Vec<_>>()
                .join("\u{a0}")
                .into()
        })
}
