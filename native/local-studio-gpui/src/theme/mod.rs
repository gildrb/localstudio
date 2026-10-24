pub mod apca;
pub mod layout;
pub mod tokens;

pub use layout::{TextRole, TextRoleExt, UI_FONT, radius, size, space, tabular};
pub use tokens::{Colors, colors};

use gpui::{App, Global, WindowAppearance};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeChoice {
    System,
    Light,
    Dark,
}

pub struct Theme {
    pub choice: ThemeChoice,
    pub colors: Colors,
}

impl Global for Theme {}

impl Theme {
    pub fn new(choice: ThemeChoice, system: WindowAppearance) -> Self {
        let appearance = match (choice, system) {
            (ThemeChoice::Light, _) => Appearance::Light,
            (ThemeChoice::Dark, _) => Appearance::Dark,
            (ThemeChoice::System, WindowAppearance::Light | WindowAppearance::VibrantLight) => {
                Appearance::Light
            }
            (ThemeChoice::System, WindowAppearance::Dark | WindowAppearance::VibrantDark) => {
                Appearance::Dark
            }
        };
        Theme {
            choice,
            colors: colors(appearance),
        }
    }
}

pub trait ActiveTheme {
    fn theme(&self) -> &Theme;
}

impl ActiveTheme for App {
    fn theme(&self) -> &Theme {
        self.global::<Theme>()
    }
}
