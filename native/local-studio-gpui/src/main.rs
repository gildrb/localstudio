mod actions;
mod assets;
mod client;
mod components;
mod format;
mod model;
mod platform;
mod theme;
mod views;

use std::cell::Cell;
use std::process::ExitCode;
use std::rc::Rc;

use gpui::{App, AppContext};

use crate::client::Fleet;
use crate::theme::{Theme, ThemeChoice};
use crate::views::shell::Shell;

fn main() -> ExitCode {
    let smoke = std::env::args().skip(1).any(|arg| arg == "--smoke");
    if smoke {
        let failures = theme::apca::audit();
        for failure in &failures {
            eprintln!(
                "smoke: {} {:?} Lc {:.1} below {:.1}",
                failure.pair, failure.appearance, failure.lc, failure.floor
            );
        }
        if !failures.is_empty() {
            return ExitCode::FAILURE;
        }
    }
    let drawn = Rc::new(Cell::new(false));
    let failed = Rc::new(Cell::new(false));
    let (frame, outcome, broken) = (drawn.clone(), failed.clone(), failed.clone());
    gpui_platform::application()
        .with_assets(assets::Assets)
        .run(move |cx: &mut App| {
            let failures = platform::init(cx);
            for failure in &failures {
                eprintln!("{failure}");
            }
            if smoke && !failures.is_empty() {
                broken.set(true);
                cx.quit();
                return;
            }
            cx.set_global(Theme::new(ThemeChoice::System, cx.window_appearance()));
            let options = platform::window_options(cx);
            let opened = cx.open_window(options, move |window, cx| {
                if smoke {
                    window.on_next_frame(move |_, cx| {
                        println!("smoke: ok");
                        frame.set(true);
                        cx.quit();
                    });
                }
                let fleet = cx.new(|cx| Fleet::new(!smoke, cx));
                cx.new(|cx| Shell::new(fleet, window, cx))
            });
            match opened {
                Ok(_) => cx.activate(true),
                Err(error) => {
                    eprintln!("cannot open window: {error:#}");
                    outcome.set(true);
                    cx.quit();
                }
            }
        });
    if !failed.get() && (drawn.get() || !smoke) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
