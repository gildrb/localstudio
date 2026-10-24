pub mod button;
pub mod card;
pub mod chart;
pub mod segmented;
pub mod status_mark;
pub mod table;
pub mod text;
pub mod text_field;
pub mod titlebar;

use gpui::{App, BoxShadow, Div, Hsla, div, point, prelude::*, px};

use crate::theme::{ActiveTheme, Colors, size, space};

pub const HAIRLINE: f32 = 1.;

pub fn ring(color: Hsla, width: f32, inset: bool) -> Vec<BoxShadow> {
    vec![BoxShadow {
        color,
        offset: point(px(0.), px(0.)),
        blur_radius: px(0.),
        spread_radius: px(width),
        inset,
    }]
}

pub fn focus_ring(colors: &Colors) -> Vec<BoxShadow> {
    let mut shadows = ring(colors.focus, 2. * size::FOCUS, false);
    shadows.extend(ring(colors.page, size::FOCUS, false));
    shadows
}

pub fn separator(cx: &App) -> Div {
    div()
        .h(px(space::S2))
        .flex_none()
        .flex()
        .items_center()
        .child(div().h(px(HAIRLINE)).w_full().bg(cx.theme().colors.divider))
}
