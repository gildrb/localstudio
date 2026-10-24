use std::rc::Rc;

use gpui::{
    Action, App, Entity, IntoElement, ParentElement, SharedString, Window, div, prelude::*, px,
};

use crate::actions::{Dismiss, LoadModel};
use crate::client::Fleet;
use crate::components::button::{Button, ButtonKind};
use crate::components::card::Card;
use crate::components::status_mark::{Badge, status_parts};
use crate::components::table::{Align, Column, Row, table_header};
use crate::components::text::context;
use crate::format::{NBSP, UNKNOWN};
use crate::model::{ControllerView, EngineAction, EngineRow, Status};
use crate::theme::{ActiveTheme, Colors, TextRole, TextRoleExt, size, space};

#[derive(Clone, PartialEq, Action)]
#[action(namespace = local_studio, no_json)]
pub struct ConfirmEngine(pub EngineAction);

fn columns() -> Rc<[Column]> {
    Rc::from([
        Column::new("Model", None, Align::Start),
        Column::new("Engine", Some(96.), Align::Start),
        Column::new("Port", Some(64.), Align::End),
        Column::new("GPUs", Some(64.), Align::Start).numeric(),
        Column::new("State", Some(128.), Align::Start).numeric(),
        Column::new("", Some(88.), Align::End),
    ])
}

fn dispatch(action: Box<dyn Action>) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) {
    move |_, window, cx| window.dispatch_action(action.boxed_clone(), cx)
}

fn action_button(index: usize, row: &EngineRow, fleet: &Entity<Fleet>) -> Button {
    let confirm = Box::new(ConfirmEngine(row.action.clone()));
    match &row.action {
        EngineAction::Stop { .. } => Button::new(("engine-stop", index), "Stop\u{2026}")
            .kind(ButtonKind::Destructive)
            .in_row()
            .on_click(dispatch(confirm)),
        EngineAction::Cancel { .. } => Button::new(("engine-cancel", index), "Cancel\u{2026}")
            .kind(ButtonKind::Destructive)
            .in_row()
            .on_click(dispatch(confirm)),
        EngineAction::Dismiss { job_id } => {
            let fleet = fleet.clone();
            let job_id = job_id.clone();
            Button::new(("engine-dismiss", index), "Dismiss")
                .in_row()
                .on_click(move |_, _, cx| {
                    let job_id = job_id.clone();
                    fleet.update(cx, |fleet, cx| fleet.cancel_job(job_id, cx));
                })
        }
    }
}

fn engine_row(
    index: usize,
    row: &EngineRow,
    columns: &Rc<[Column]>,
    fleet: &Entity<Fleet>,
    cx: &App,
) -> Row {
    let colors = cx.theme().colors;
    let (shape, tone, word) = status_parts(&row.status);
    let failure = match &row.status {
        Status::Failed { message } => Some(message.clone()),
        Status::Running
        | Status::Idle
        | Status::Loading { .. }
        | Status::Offline { .. }
        | Status::NeedsKey => None,
    };
    let engine = row.engine.clone().unwrap_or_else(|| UNKNOWN.to_string());
    let gpus = row.gpus.clone().unwrap_or_else(|| UNKNOWN.to_string());
    let label = format!(
        "{}, {engine}, port {}, GPUs {gpus}, {word}{}",
        row.model,
        row.port,
        failure
            .as_ref()
            .map_or_else(String::new, |message| format!(", {message}"))
    );
    Row::new(("engine", index), columns.clone(), label)
        .height(size::ROW_ACTION)
        .cell(
            div()
                .min_w_0()
                .flex()
                .gap(px(space::S2))
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_color(colors.text)
                        .child(row.model.clone()),
                )
                .children(failure.map(|message| {
                    div()
                        .min_w_0()
                        .truncate()
                        .text_color(colors.err.text)
                        .child(message)
                }))
                .truncate(),
        )
        .cell(context(engine, cx))
        .cell(div().text_color(colors.text).child(row.port.to_string()))
        .cell(context(gpus, cx))
        .cell(Badge::new(shape, tone, word))
        .cell(action_button(index, row, fleet))
}

fn confirm_row(
    index: usize,
    row: &EngineRow,
    fleet: &Entity<Fleet>,
    colors: &Colors,
) -> impl IntoElement {
    let fleet = fleet.clone();
    let action = row.action.clone();
    let (sentence, keep, confirm) = match &row.action {
        EngineAction::Cancel { .. } => (
            format!(
                "Cancel loading {}? Download and startup stop now.",
                row.model
            ),
            "Keep loading",
            "Cancel load",
        ),
        EngineAction::Stop { .. } | EngineAction::Dismiss { .. } => (
            format!("Stop {}? Requests in{NBSP}flight end now.", row.model),
            "Keep running",
            "Stop model",
        ),
    };
    let sentence: SharedString = sentence.into();
    div()
        .id(("engine-confirm", index))
        .h(px(size::ROW_ACTION))
        .px(px(space::S2))
        .flex()
        .items_center()
        .gap(px(space::S2))
        .role(gpui::Role::Alert)
        .aria_label(sentence.clone())
        .text_role(TextRole::Body)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_color(colors.text)
                .child(sentence),
        )
        .child(
            Button::new(("engine-keep", index), keep)
                .in_row()
                .on_click(dispatch(Box::new(Dismiss))),
        )
        .child(
            Button::new(("engine-confirm-act", index), confirm)
                .kind(ButtonKind::DangerConfirm)
                .in_row()
                .on_click(move |_, window, cx| {
                    let action = action.clone();
                    fleet.update(cx, |fleet, cx| match action {
                        EngineAction::Stop { port } => fleet.stop_port(port, cx),
                        EngineAction::Cancel { job_id } | EngineAction::Dismiss { job_id } => {
                            fleet.cancel_job(job_id, cx)
                        }
                    });
                    window.dispatch_action(Box::new(Dismiss), cx);
                }),
        )
}

pub fn engines_card(
    view: &ControllerView,
    confirm: Option<&EngineAction>,
    fleet: &Entity<Fleet>,
    cx: &App,
) -> impl IntoElement {
    let colors = cx.theme().colors;
    let card = Card::new("engines", "Engines");
    if view.engines.is_empty() {
        return card.child(
            div()
                .h(px(size::ROW_ACTION))
                .flex()
                .items_center()
                .gap(px(space::S4))
                .text_role(TextRole::Body)
                .text_color(colors.text_secondary)
                .child("No model loaded.")
                .child(
                    Button::new("engines-load", "Load model\u{2026}")
                        .kind(ButtonKind::Primary)
                        .on_click(dispatch(Box::new(LoadModel))),
                ),
        );
    }
    let columns = columns();
    card.child(table_header(&columns, cx))
        .children(view.engines.iter().enumerate().map(|(index, row)| {
            if confirm == Some(&row.action) {
                confirm_row(index, row, fleet, &colors).into_any_element()
            } else {
                engine_row(index, row, &columns, fleet, cx).into_any_element()
            }
        }))
}
