use std::collections::BTreeSet;
use std::path::PathBuf;
use std::rc::Rc;

use chrono::{DateTime, Local};
use gpui::{
    App, AppContext, Context, Entity, FocusHandle, IntoElement, Render, Role, ScrollStrategy,
    SharedString, UniformListScrollHandle, Window, div, prelude::*, px, uniform_list,
};

use crate::actions::{CopyLogRow, FocusFilter, SaveLog};
use crate::client::Fleet;
use crate::client::wire::{LogLine, RequestKind};
use crate::components::button::Button;
use crate::components::card::Card;
use crate::components::segmented::{Segment, Segmented};
use crate::components::status_mark::{MarkShape, StatusMark, ToneKind};
use crate::components::table::{Align, Column, Row, table_header};
use crate::components::text::context;
use crate::components::text_field::{TextField, TextFieldEvent};
use crate::format::{self, NBSP};
use crate::model::{LogFilter, log_view};
use crate::platform::{self, key_hint};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, size, space};

const KINDS: [RequestKind; 3] = [RequestKind::Chat, RequestKind::Health, RequestKind::Metrics];
const FIELD_WIDTH: f32 = 240.;
const VISIBLE_ROWS: f32 = 11.;

pub struct Logs {
    fleet: Entity<Fleet>,
    field: Entity<TextField>,
    filter: LogFilter,
    selected: Option<u64>,
    scroll: UniformListScrollHandle,
    focus: FocusHandle,
    notice: Option<SharedString>,
}

fn default_kinds() -> BTreeSet<RequestKind> {
    [RequestKind::Chat, RequestKind::Metrics]
        .into_iter()
        .collect()
}

fn kind_name(kind: RequestKind) -> &'static str {
    match kind {
        RequestKind::Chat => "Chat",
        RequestKind::Health => "Health",
        RequestKind::Metrics => "Metrics",
    }
}

fn time(line: &LogLine) -> String {
    DateTime::parse_from_rfc3339(&line.at).map_or_else(
        |_| format::UNKNOWN.to_string(),
        |at| format::clock(at.with_timezone(&Local)),
    )
}

fn failed(line: &LogLine) -> bool {
    line.status >= 400
}

fn json_line(line: &LogLine) -> String {
    serde_json::json!({
        "id": line.id,
        "at": line.at,
        "kind": kind_name(line.kind).to_lowercase(),
        "status": line.status,
        "method": line.method,
        "path": line.path,
        "client": line.client,
    })
    .to_string()
}

fn columns() -> Rc<[Column]> {
    Rc::from([
        Column::new("Time", Some(80.), Align::Start).numeric(),
        Column::new("Status", Some(96.), Align::Start).numeric(),
        Column::new("Method", Some(64.), Align::Start),
        Column::new("Path", None, Align::Start),
        Column::new("Client", Some(144.), Align::End),
    ])
}

impl Logs {
    pub fn new(fleet: Entity<Fleet>, window: &Window, cx: &mut Context<Self>) -> Self {
        let hint = key_hint(&FocusFilter, window, cx);
        let field = cx.new(|cx| TextField::new("Filter path or client", cx).hint(hint));
        cx.subscribe(&field, |this, _, event: &TextFieldEvent, cx| match event {
            TextFieldEvent::Changed(text) => {
                this.filter.query = text.clone();
                cx.notify();
            }
        })
        .detach();
        cx.observe(&fleet, |_, _, cx| cx.notify()).detach();
        Logs {
            fleet,
            field,
            filter: LogFilter {
                query: String::new(),
                kinds: default_kinds(),
            },
            selected: None,
            scroll: UniformListScrollHandle::new(),
            focus: cx.focus_handle(),
            notice: None,
        }
    }

    pub fn focus_filter(&self, window: &mut Window, cx: &mut App) {
        self.field.update(cx, |field, cx| field.focus(window, cx));
    }

    fn visible(&self, cx: &App) -> Vec<LogLine> {
        self.fleet
            .read(cx)
            .selected()
            .map_or_else(Vec::new, |state| {
                log_view(&state.log, &self.filter)
                    .rows
                    .iter()
                    .filter_map(|index| state.log.get(*index).cloned())
                    .collect()
            })
    }

    fn copy_row(&mut self, _: &CopyLogRow, _: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected else {
            return;
        };
        if let Some(line) = self.visible(cx).into_iter().find(|line| line.id == id) {
            platform::copy_text(json_line(&line), cx);
        }
    }

    pub fn save(&mut self, _: &SaveLog, _: &mut Window, cx: &mut Context<Self>) {
        let lines = self.visible(cx);
        let count = lines.len();
        let body: String = lines.iter().map(|line| json_line(line) + "\n").collect();
        let answer = platform::save_dialog("requests.jsonl", cx);
        cx.spawn(async move |this, cx| {
            let notice = match answer.await {
                Ok(Ok(Some(path))) => {
                    let target: PathBuf = path.clone();
                    let written = cx
                        .background_spawn(async move { std::fs::write(&target, body) })
                        .await;
                    match written {
                        Ok(()) => Some(format!("Saved {count} requests to {}.", path.display())),
                        Err(error) => {
                            Some(format!("Could not save to {}: {error}.", path.display()))
                        }
                    }
                }
                Ok(Ok(None)) => None,
                Ok(Err(error)) => Some(match platform::dialog_error(&error) {
                    platform::DialogError::NoPortal(message) => format!("{message}."),
                    platform::DialogError::Failed(message) => format!("Save failed: {message}."),
                }),
                Err(_) => Some("The save dialog closed without an answer.".to_string()),
            };
            this.update(cx, |this, cx| {
                this.notice = notice.map(SharedString::from);
                cx.notify();
            })
        })
        .detach();
    }

    fn clear_filter(&mut self, cx: &mut Context<Self>) {
        self.filter.kinds = KINDS.into_iter().collect();
        self.field.update(cx, |field, cx| field.clear(cx));
        cx.notify();
    }
}

impl Render for Logs {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors;
        let (shown, total, counts, summary) = self.fleet.read(cx).selected().map_or_else(
            || {
                (
                    Vec::new(),
                    0,
                    Default::default(),
                    "No controller selected.".to_string(),
                )
            },
            |state| {
                let view = log_view(&state.log, &self.filter);
                let shown: Vec<LogLine> = view
                    .rows
                    .iter()
                    .filter_map(|index| state.log.get(*index).cloned())
                    .collect();
                (shown, state.log.len(), view.counts, view.summary)
            },
        );
        let shown = Rc::new(shown);
        let entity = cx.entity();
        let segments = KINDS
            .iter()
            .map(|kind| Segment {
                label: kind_name(*kind).into(),
                count: Some(counts.get(kind).copied().unwrap_or(0)),
                on: self.filter.kinds.contains(kind),
            })
            .collect();
        let toolbar = div()
            .h(px(size::CONTROL))
            .flex()
            .items_center()
            .gap(px(space::S2))
            .child(
                div()
                    .w(px(FIELD_WIDTH))
                    .flex_none()
                    .child(self.field.clone()),
            )
            .child(Segmented::new("log-kinds", segments, true, {
                let entity = entity.clone();
                move |index, _, cx| {
                    entity.update(cx, |this, cx| {
                        let kind = KINDS[index % KINDS.len()];
                        if !this.filter.kinds.remove(&kind) {
                            this.filter.kinds.insert(kind);
                        }
                        cx.notify();
                    })
                }
            }));
        let columns = columns();
        let body = if shown.is_empty() {
            let query = self.filter.query.trim();
            let sentence: SharedString = match (total, query.is_empty()) {
                (0, _) => "No requests yet.".into(),
                (_, false) => format!("No requests match \u{201c}{query}\u{201d}.").into(),
                (_, true) => "No requests of the selected kinds.".into(),
            };
            div()
                .h(px(size::ROW_ACTION))
                .flex()
                .items_center()
                .gap(px(space::S4))
                .px(px(space::S2))
                .text_role(TextRole::Body)
                .text_color(colors.text_secondary)
                .child(sentence)
                .when(total > 0, |this| {
                    let entity = entity.clone();
                    this.child(Button::new("log-clear", "Clear filter").on_click(
                        move |_, _, cx| entity.update(cx, |this, cx| this.clear_filter(cx)),
                    ))
                })
                .into_any_element()
        } else {
            let selected = self.selected;
            uniform_list("log-rows", shown.len(), {
                let shown = shown.clone();
                let columns = columns.clone();
                cx.processor(move |_, range: std::ops::Range<usize>, _, cx| {
                    let colors = cx.theme().colors;
                    range
                        .filter_map(|index| shown.get(index).map(|line| (index, line)))
                        .map(|(index, line)| {
                            let id = line.id;
                            let clock = time(line);
                            let label = format!(
                                "{clock}, status {}, {} {} from {}",
                                line.status, line.method, line.path, line.client
                            );
                            let status = if failed(line) {
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(space::S1))
                                    .whitespace_nowrap()
                                    .text_color(colors.err.text)
                                    .child(StatusMark::new(MarkShape::Cross, ToneKind::Err))
                                    .child(format!("{}{NBSP}failed", line.status))
                            } else {
                                div().text_color(colors.text).child(line.status.to_string())
                            };
                            Row::new(("log", id), columns.clone(), label)
                                .selected(selected == Some(id))
                                .cell(div().text_color(colors.text).child(clock))
                                .cell(status)
                                .cell(context(line.method.clone(), cx))
                                .cell(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .text_color(colors.text)
                                        .child(line.path.clone()),
                                )
                                .cell(context(line.client.clone(), cx))
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.selected = Some(id);
                                    window.focus(&this.focus, cx);
                                    this.scroll.scroll_to_item(index, ScrollStrategy::Nearest);
                                    cx.notify();
                                }))
                        })
                        .collect()
                })
            })
            .track_scroll(&self.scroll)
            .h(px(size::ROW * VISIBLE_ROWS))
            .into_any_element()
        };
        div()
            .id("request-log")
            .key_context("Log")
            .track_focus(&self.focus)
            .role(Role::Table)
            .aria_label("Request log")
            .on_action(cx.listener(Self::copy_row))
            .on_action(cx.listener(Self::save))
            .child(
                Card::new("request-log-card", "Request log")
                    .subtitle(summary)
                    .child(div().h(px(space::S2)))
                    .child(toolbar)
                    .children(self.notice.clone().map(|notice| {
                        div()
                            .pt(px(space::S2))
                            .text_role(TextRole::Body)
                            .text_color(colors.text_secondary)
                            .child(notice)
                    }))
                    .child(div().h(px(space::S2)))
                    .child(table_header(&columns, cx))
                    .child(body),
            )
    }
}
