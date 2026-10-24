use gpui::{App, IntoElement, Role, div, prelude::*, px};

use crate::client::fleet::POLL;
use crate::components::card::Card;
use crate::components::separator;
use crate::components::text::MetricRow;
use crate::format::NBSP;
use crate::model::ControllerView;
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, space};

const LIVE_MISSING: &str = "This controller does not report live metrics. Update it to see throughput, the request log, Decode, Prefill, First\u{00a0}token and KV\u{00a0}cache.";

pub fn now_card(view: &ControllerView, cx: &App) -> impl IntoElement {
    let colors = cx.theme().colors;
    let now = &view.now;
    Card::new("now", "Now")
        .after_title(
            div()
                .text_role(TextRole::Body)
                .text_color(colors.text_secondary)
                .child(format!("updated every {}{NBSP}s", POLL.as_secs())),
        )
        .when(!view.live_supported, |card| card.subtitle(LIVE_MISSING))
        .when_some(view.live_error.clone(), |card, error| {
            card.subtitle(format!("Live metrics failed: {error}."))
        })
        .child(
            div()
                .id("now-table")
                .role(Role::Table)
                .aria_label("Now")
                .pt(px(space::S2))
                .flex()
                .flex_col()
                .child(
                    MetricRow::new("now-decode", "Decode", now.decode.clone()).group("Throughput"),
                )
                .child(MetricRow::new(
                    "now-prefill",
                    "Prefill",
                    now.prefill.clone(),
                ))
                .child(separator(cx))
                .child(
                    MetricRow::new("now-requests", "Requests", now.requests.clone()).group("Load"),
                )
                .child(MetricRow::new(
                    "now-first-token",
                    "First\u{00a0}token",
                    now.first_token.clone(),
                ))
                .child(separator(cx))
                .child(MetricRow::new("now-vram", "VRAM", now.vram.clone()).group("Memory"))
                .child(MetricRow::new("now-kv", "KV\u{00a0}cache", now.kv.clone())),
        )
}
