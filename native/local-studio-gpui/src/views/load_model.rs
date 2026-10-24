use std::rc::Rc;

use gpui::{
    App, Context, Entity, FocusHandle, Focusable, IntoElement, KeyDownEvent, Render, Role, Window,
    div, prelude::*, px,
};

use crate::actions::Dismiss;
use crate::client::Fleet;
use crate::client::wire::Recipe;
use crate::components::button::{Button, ButtonKind};
use crate::components::card::Card;
use crate::components::table::{Align, Column, Row, table_header};
use crate::components::text::context as quiet;
use crate::format::{self, NBSP};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, size, space};

pub struct LoadModel {
    fleet: Entity<Fleet>,
    selected: usize,
    confirming: bool,
    focus: FocusHandle,
}

fn columns() -> Rc<[Column]> {
    Rc::from([
        Column::new("Model", None, Align::Start),
        Column::new("Engine", Some(96.), Align::Start),
        Column::new("GPUs", Some(152.), Align::Start),
        Column::new("Context", Some(80.), Align::End),
        Column::new("Fits", Some(160.), Align::Start),
    ])
}

fn ready(recipe: &Recipe) -> bool {
    recipe.fits && recipe.blocked.is_none()
}

fn reason(recipe: &Recipe) -> String {
    match &recipe.blocked {
        Some(blocked) => blocked.clone(),
        None if recipe.fits => "yes".to_string(),
        None => format!("needs more{NBSP}VRAM"),
    }
}

impl LoadModel {
    pub fn new(fleet: Entity<Fleet>, cx: &mut Context<Self>) -> Self {
        cx.observe(&fleet, |_, _, cx| cx.notify()).detach();
        LoadModel {
            fleet,
            selected: 0,
            confirming: false,
            focus: cx.focus_handle(),
        }
    }

    fn ready_ids(&self, cx: &App) -> Vec<String> {
        self.fleet
            .read(cx)
            .selected()
            .and_then(|state| state.recipes.as_ref())
            .map(|recipes| {
                recipes
                    .recipes
                    .iter()
                    .filter(|recipe| ready(recipe))
                    .map(|recipe| recipe.id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn replace(&self, cx: &App) -> bool {
        self.fleet
            .read(cx)
            .selected()
            .and_then(|state| state.snapshot.as_ref())
            .is_some_and(|snapshot| snapshot.endpoints.iter().any(|endpoint| endpoint.live))
    }

    fn request(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.ready_ids(cx).get(self.selected).cloned() else {
            return;
        };
        let replace = self.replace(cx);
        if replace && !self.confirming {
            self.confirming = true;
            cx.notify();
            return;
        }
        self.fleet
            .update(cx, |fleet, cx| fleet.load(id, replace, cx));
        window.dispatch_action(Box::new(Dismiss), cx);
    }

    fn choose(&mut self, index: usize, cx: &mut Context<Self>) {
        self.selected = index;
        self.confirming = false;
        cx.notify();
    }

    fn keys(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let ids = self.ready_ids(cx);
        let Some(last) = ids.len().checked_sub(1) else {
            return;
        };
        match event.keystroke.key.as_str() {
            "up" => self.choose(self.selected.saturating_sub(1), cx),
            "down" => self.choose((self.selected + 1).min(last), cx),
            "enter" => self.request(window, cx),
            _ => return,
        }
        cx.stop_propagation();
    }
}

impl Focusable for LoadModel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for LoadModel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors;
        let replace = self.replace(cx);
        let recipes: Vec<Recipe> = self
            .fleet
            .read(cx)
            .selected()
            .and_then(|state| state.recipes.as_ref())
            .map(|recipes| recipes.recipes.clone())
            .unwrap_or_default();
        let (ready_rows, other_rows): (Vec<&Recipe>, Vec<&Recipe>) =
            recipes.iter().partition(|recipe| ready(recipe));
        self.selected = self.selected.min(ready_rows.len().saturating_sub(1));
        let columns = columns();
        let action = if replace { "Unload and load" } else { "Load" };
        let row = |index: usize, recipe: &Recipe, selected: bool| {
            let gpus = format!("{}\u{00d7}{NBSP}{}", recipe.cards, recipe.card);
            let context = format::compact(recipe.ctx as f64);
            let fits = reason(recipe);
            let label = format!(
                "{}, {}, {gpus}, context {context}, {fits}",
                recipe.model, recipe.engine
            );
            Row::new(("recipe", index), columns.clone(), label)
                .height(size::ROW_ACTION)
                .selected(selected)
                .cell(div().truncate().child(recipe.model.clone()))
                .cell(quiet(recipe.engine.clone(), cx))
                .cell(quiet(gpus, cx))
                .cell(context)
                .cell(
                    div()
                        .truncate()
                        .text_color(if ready(recipe) {
                            colors.text_secondary
                        } else {
                            colors.warn.text
                        })
                        .child(fits),
                )
        };
        let group = |title: &str| {
            div()
                .pt(px(space::S4))
                .h(px(size::ROW + space::S4))
                .flex()
                .items_center()
                .text_role(TextRole::Label)
                .text_color(colors.text)
                .child(title.to_string())
        };
        let ready_list = ready_rows.iter().enumerate().map(|(index, recipe)| {
            let this = cx.entity();
            row(index, recipe, index == self.selected).on_click(move |_, _, cx| {
                this.update(cx, |this, cx| this.choose(index, cx));
            })
        });
        let other_list = other_rows
            .iter()
            .enumerate()
            .map(|(index, recipe)| row(ready_rows.len() + index, recipe, false));
        let empty = recipes.is_empty().then(|| {
            div()
                .pt(px(space::S2))
                .text_role(TextRole::Body)
                .text_color(colors.text_secondary)
                .child("No recipes in the registry yet.")
        });
        let selected = ready_rows.get(self.selected).copied();
        let state = self.fleet.read(cx).selected();
        let running: Vec<String> = state
            .and_then(|state| state.snapshot.as_ref())
            .map(|snapshot| {
                snapshot
                    .endpoints
                    .iter()
                    .filter(|endpoint| endpoint.live)
                    .flat_map(|endpoint| endpoint.models.clone())
                    .collect()
            })
            .unwrap_or_default();
        let recipes_error = state
            .and_then(|state| state.recipes_error.as_ref())
            .map(|error| format!("Could not read the registry: {error}."));
        let subtitle = match (self.confirming, selected) {
            (true, Some(recipe)) => format!(
                "Unload {} and load {}? Requests in{NBSP}flight end now.",
                running.join(", "),
                recipe.model
            ),
            _ => format!(
                "Up and Down choose, Enter {}, Escape closes.",
                action.to_lowercase()
            ),
        };
        let (keep, go, kind) = if self.confirming {
            ("Keep current model", action, ButtonKind::DangerConfirm)
        } else {
            ("Close", action, ButtonKind::Primary)
        };
        let this = cx.entity();
        let back = cx.entity();
        div()
            .key_context("Panel")
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::keys))
            .child(
                Card::new("load-model", "Load model")
                    .subtitle(subtitle)
                    .after_title(
                        div()
                            .flex()
                            .gap(px(space::S2))
                            .child(Button::new("close-panel", keep).on_click(
                                move |_, window, cx| {
                                    let confirming = back.read(cx).confirming;
                                    if confirming {
                                        back.update(cx, |this, cx| {
                                            this.confirming = false;
                                            cx.notify();
                                        });
                                    } else {
                                        window.dispatch_action(Box::new(Dismiss), cx);
                                    }
                                },
                            ))
                            .children(selected.map(|_| {
                                Button::new("load-selected", go).kind(kind).on_click(
                                    move |_, window, cx| {
                                        this.update(cx, |this, cx| this.request(window, cx));
                                    },
                                )
                            })),
                    )
                    .children(recipes_error.map(|error| {
                        div()
                            .text_role(TextRole::Body)
                            .text_color(colors.err.text)
                            .child(error)
                    }))
                    .child(
                        div()
                            .id("recipe-table")
                            .role(Role::Table)
                            .aria_label("Recipes")
                            .flex()
                            .flex_col()
                            .child(group("Ready to load"))
                            .child(table_header(&columns, cx))
                            .children(ready_list)
                            .when(!other_rows.is_empty(), |this| {
                                this.child(group("In the registry, not one-click yet"))
                                    .children(other_list)
                            })
                            .children(empty),
                    ),
            )
    }
}
