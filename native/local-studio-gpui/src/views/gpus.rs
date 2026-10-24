use std::rc::Rc;

use gpui::{App, IntoElement, Role, SharedString, div, prelude::*, px};

use crate::components::card::Card;
use crate::components::status_mark::{MarkShape, StatusMark, ToneKind};
use crate::components::table::{Align, Column, Row, table_header};
use crate::components::text::context;
use crate::format::{self, NBSP, UNKNOWN};
use crate::model::{ControllerView, GpuRow};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, space};

fn columns() -> Rc<[Column]> {
    Rc::from([
        Column::new("GPU", Some(56.), Align::Start).numeric(),
        Column::new("Memory", Some(120.), Align::End),
        Column::new("Util", Some(64.), Align::End),
        Column::new("Temp", Some(64.), Align::End),
        Column::new("Power", None, Align::End),
    ])
}

fn total_power(view: &ControllerView) -> Option<String> {
    let draws: Option<Vec<(f64, f64)>> = view.gpus.iter().map(|gpu| gpu.power).collect();
    draws.filter(|draws| !draws.is_empty()).map(|draws| {
        let (draw, limit) = draws
            .iter()
            .fold((0., 0.), |(d, l), (draw, limit)| (d + draw, l + limit));
        format::watts_pair(draw, limit)
    })
}

fn gpu_row(columns: &Rc<[Column]>, gpu: &GpuRow, cx: &App) -> Row {
    let memory = format::gigabytes_pair(gpu.memory.0, gpu.memory.1);
    let util = gpu
        .util_pct
        .map_or_else(|| UNKNOWN.to_string(), |pct| format::percent(pct / 100.));
    let temp = gpu
        .temp_c
        .map_or_else(|| UNKNOWN.to_string(), format::celsius);
    let power = gpu.power.map_or_else(
        || UNKNOWN.to_string(),
        |(draw, limit)| format::watts_pair(draw, limit),
    );
    let label = format!(
        "GPU {}, memory {memory}, utilization {util}, temperature {temp}, power {power}",
        gpu.index
    );
    Row::new(("gpu", gpu.index as usize), columns.clone(), label)
        .cell(context(gpu.index.to_string(), cx))
        .cell(memory)
        .cell(util)
        .cell(temp)
        .cell(power)
}

pub fn gpus_card(view: &ControllerView, cx: &App) -> impl IntoElement {
    let colors = cx.theme().colors;
    let columns = columns();
    let title = view.gpu_label.clone().unwrap_or_else(|| "GPUs".to_string());
    let card = Card::new("gpus", title);
    let card = match total_power(view) {
        Some(power) => card.subtitle(format!("{power} drawn")),
        None => card,
    };
    if view.gpus.is_empty() {
        return card.child(
            div()
                .pt(px(space::S2))
                .text_role(TextRole::Body)
                .text_color(colors.text_secondary)
                .child(format!("No GPUs{NBSP}reported.")),
        );
    }
    card.child(
        div()
            .id("gpu-table")
            .role(Role::Table)
            .aria_label("GPUs")
            .pt(px(space::S2))
            .flex()
            .flex_col()
            .child(table_header(&columns, cx))
            .children(view.gpus.iter().map(|gpu| gpu_row(&columns, gpu, cx))),
    )
    .children(view.warnings.iter().map(|warning| {
        let warning: SharedString = warning.clone().into();
        div()
            .pt(px(space::S2))
            .flex()
            .items_center()
            .gap(px(space::S2))
            .text_role(TextRole::Body)
            .text_color(colors.warn.text)
            .child(StatusMark::new(MarkShape::Triangle, ToneKind::Warn))
            .child(warning)
    }))
}
