use gpui::{App, IntoElement, Role, SharedString, Window, div, prelude::*, px};

use crate::actions::{CopyControllerUrl, LoadModel, Refresh};
use crate::components::button::{Button, ButtonKind};
use crate::components::status_mark::{StatusMark, status_parts};
use crate::format::{NBSP, clock};
use crate::model::{ControllerView, Status};
use crate::platform::key_hint;
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, size, space, tabular};

fn sentence(view: &ControllerView) -> String {
    match &view.status {
        Status::Offline { since, reason } => format!(
            "Not answering since {}: {reason}.",
            clock(since.with_timezone(&chrono::Local))
        ),
        Status::NeedsKey => format!("{} rejected the fleet key.", view.url),
        Status::Running | Status::Idle | Status::Loading { .. } | Status::Failed { .. } => {
            let mut parts = vec![view.url.clone()];
            if !view.version.is_empty() {
                parts.push(format!("controller{NBSP}{}", view.version));
            }
            parts.extend(view.gpu_label.clone());
            parts.join(", ")
        }
    }
}

pub fn header(view: &ControllerView, window: &Window, cx: &App) -> impl IntoElement {
    let colors = cx.theme().colors;
    let (shape, tone, word) = status_parts(&view.status);
    let tone_text = tone.text(&colors);
    let reachable = !matches!(view.status, Status::Offline { .. } | Status::NeedsKey);
    let primary = if reachable {
        Button::new("header-load", "Load model\u{2026}")
            .kind(ButtonKind::Primary)
            .hint(key_hint(&LoadModel, window, cx))
            .on_click(|_, window, cx| window.dispatch_action(Box::new(LoadModel), cx))
    } else {
        Button::new("header-retry", "Retry")
            .kind(ButtonKind::Primary)
            .hint(key_hint(&Refresh, window, cx))
            .on_click(|_, window, cx| window.dispatch_action(Box::new(Refresh), cx))
    };
    let title: SharedString = view.name.clone().into();
    div()
        .id("controller-header")
        .role(Role::Group)
        .aria_label(SharedString::from(format!("{}, {word}", view.name)))
        .flex()
        .flex_col()
        .gap(px(space::S1))
        .child(
            div()
                .h(px(size::CONTROL))
                .flex()
                .items_center()
                .gap(px(space::S2))
                .child(StatusMark::new(shape, tone).size(size::MARK_LARGE))
                .child(
                    div()
                        .id("controller-name")
                        .role(Role::Heading)
                        .aria_level(1)
                        .aria_label(title.clone())
                        .min_w_0()
                        .truncate()
                        .text_role(TextRole::Heading)
                        .child(title),
                )
                .child(
                    div()
                        .pl(px(space::S2))
                        .flex_none()
                        .whitespace_nowrap()
                        .text_role(TextRole::Label)
                        .font_features(tabular())
                        .text_color(tone_text)
                        .child(word),
                )
                .child(div().flex_1())
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .gap(px(space::S2))
                        .child(
                            Button::new("header-copy", "Copy URL")
                                .hint(key_hint(&CopyControllerUrl, window, cx))
                                .on_click(|_, window, cx| {
                                    window.dispatch_action(Box::new(CopyControllerUrl), cx)
                                }),
                        )
                        .child(primary),
                ),
        )
        .child(
            div()
                .min_w_0()
                .truncate()
                .text_role(TextRole::Body)
                .text_color(colors.text_secondary)
                .child(sentence(view)),
        )
}
