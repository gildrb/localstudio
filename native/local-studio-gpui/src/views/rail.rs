use gpui::{
    AnyElement, AppContext, Context, Entity, FocusHandle, IntoElement, KeyDownEvent, OwnedMenuItem,
    Render, Role, SharedString, Window, deferred, div, prelude::*, px, svg,
};

use crate::actions::Dismiss;
use crate::client::Fleet;
use crate::components::button::Button;
use crate::components::status_mark::{StatusMark, status_parts};
use crate::components::text_field::TextField;
use crate::components::{HAIRLINE, focus_ring, ring, separator};
use crate::model::{ControllerView, Status, controller_view};
use crate::platform::{IN_APP_MENU, key_hint};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space, tabular};

const MENU_WIDTH: f32 = size::RAIL - 2. * space::S2;

pub struct Rail {
    fleet: Entity<Fleet>,
    adding: Option<Entity<TextField>>,
    pub focus: FocusHandle,
    menu: Option<FocusHandle>,
}

fn second_line(view: &ControllerView) -> String {
    match &view.status {
        Status::Failed { message } => message.clone(),
        Status::Running | Status::Idle | Status::Loading { .. } if view.model_line.is_empty() => {
            "no model loaded".to_string()
        }
        Status::Offline { .. }
        | Status::NeedsKey
        | Status::Running
        | Status::Idle
        | Status::Loading { .. } => view.model_line.clone(),
    }
}

impl Rail {
    pub fn new(fleet: Entity<Fleet>, cx: &mut Context<Self>) -> Self {
        Rail {
            fleet,
            adding: None,
            focus: cx.focus_handle().tab_stop(true),
            menu: None,
        }
    }

    fn open_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let field = cx.new(|cx| TextField::new("http://host:18091", cx));
        field.update(cx, |field, cx| field.focus(window, cx));
        self.adding = Some(field);
        cx.notify();
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let Some(field) = self.adding.take() else {
            return;
        };
        let url = field.read(cx).text().trim().to_string();
        if !url.is_empty() {
            self.fleet.update(cx, |fleet, cx| fleet.add_peer(url, cx));
        }
        cx.notify();
    }

    fn keys(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let fleet = self.fleet.read(cx);
        let count = fleet.controllers().len();
        let Some(current) = fleet.selected_index() else {
            return;
        };
        let next = match event.keystroke.key.as_str() {
            "up" => current.checked_sub(1),
            "down" => Some(current + 1).filter(|index| *index < count),
            _ => return,
        };
        if let Some(index) = next {
            self.fleet.update(cx, |fleet, cx| fleet.select(index, cx));
        }
        cx.stop_propagation();
    }

    fn toggle_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.menu.take() {
            Some(_) => window.focus(&self.focus, cx),
            None => {
                let focus = cx.focus_handle();
                window.focus(&focus, cx);
                self.menu = Some(focus);
            }
        }
        cx.notify();
    }

    fn menu_popover(
        &self,
        focus: &FocusHandle,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let colors = cx.theme().colors;
        let mut items: Vec<AnyElement> = Vec::new();
        for (m, menu) in cx.get_menus().unwrap_or_default().into_iter().enumerate() {
            if m > 0 {
                items.push(separator(cx).into_any_element());
            }
            items.push(
                div()
                    .h(px(size::ROW))
                    .px(px(space::S2))
                    .flex()
                    .items_center()
                    .text_role(TextRole::Caption)
                    .text_color(colors.text_secondary)
                    .child(menu.name.clone())
                    .into_any_element(),
            );
            for (i, item) in menu.items.into_iter().enumerate() {
                let OwnedMenuItem::Action {
                    name,
                    action,
                    checked,
                    disabled,
                    ..
                } = item
                else {
                    continue;
                };
                let hint = key_hint(action.as_ref(), window, cx);
                let label: SharedString = name.into();
                items.push(
                    div()
                        .id(("menu-item", m * 100 + i))
                        .role(Role::MenuItem)
                        .aria_label(label.clone())
                        .h(px(size::ROW))
                        .px(px(space::S2))
                        .flex()
                        .items_center()
                        .gap(px(space::S2))
                        .rounded(px(radius::nested(radius::CONTROL, space::S1)))
                        .text_role(TextRole::Body)
                        .text_color(if disabled {
                            colors.text_disabled
                        } else {
                            colors.text
                        })
                        .when(!disabled, |this| {
                            this.cursor_pointer()
                                .hover(|style| {
                                    style
                                        .bg(colors.hover)
                                        .shadow(ring(colors.edge, HAIRLINE, true))
                                })
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.toggle_menu(window, cx);
                                    window.dispatch_action(action.boxed_clone(), cx);
                                }))
                        })
                        .child(
                            div()
                                .size(px(size::ICON))
                                .flex_none()
                                .when(checked, |this| {
                                    this.child(
                                        svg()
                                            .path("icons/check.svg")
                                            .size(px(size::ICON))
                                            .text_color(colors.text),
                                    )
                                }),
                        )
                        .child(div().flex_1().min_w_0().truncate().child(label))
                        .children(hint.map(|hint| {
                            div()
                                .text_role(TextRole::Caption)
                                .text_color(colors.text_secondary)
                                .child(hint)
                        }))
                        .into_any_element(),
                );
            }
        }
        deferred(
            div()
                .id("app-menu")
                .role(Role::Menu)
                .aria_label("Menu")
                .key_context("Panel")
                .track_focus(focus)
                .on_action(
                    cx.listener(|this, _: &Dismiss, window, cx| this.toggle_menu(window, cx)),
                )
                .occlude()
                .absolute()
                .top(px(size::CONTROL + space::S2))
                .left(px(space::S2))
                .w(px(MENU_WIDTH))
                .p(px(space::S1))
                .flex()
                .flex_col()
                .rounded(px(radius::CONTROL))
                .border_1()
                .border_color(colors.frame)
                .bg(colors.surface)
                .children(items),
        )
        .into_any_element()
    }
}

impl Render for Rail {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors;
        let fleet = self.fleet.read(cx);
        let selected = fleet.selected().map(|state| state.url.clone());
        let views: Vec<(bool, ControllerView)> = fleet
            .controllers()
            .iter()
            .map(|state| {
                (
                    Some(&state.url) == selected.as_ref(),
                    controller_view(state),
                )
            })
            .collect();
        let count = views.len();
        let rows = views.into_iter().enumerate().map(|(index, (on, view))| {
            let (shape, tone, word) = status_parts(&view.status);
            let word_color = tone.text(&colors);
            let detail = second_line(&view);
            let label = SharedString::from(format!("{}, {word}, {detail}", view.name));
            let fleet = self.fleet.clone();
            div()
                .id(("rail-row", index))
                .role(Role::ListItem)
                .aria_label(label)
                .aria_selected(on)
                .aria_position_in_set(index + 1)
                .aria_size_of_set(count)
                .group("rail-row")
                .h(px(size::RAIL_ROW))
                .px(px(space::S3 - HAIRLINE))
                .flex()
                .flex_col()
                .justify_center()
                .rounded(px(radius::CONTROL))
                .border_1()
                .border_color(if on {
                    colors.edge_hover
                } else {
                    colors.surface
                })
                .bg(if on { colors.selected } else { colors.surface })
                .when(on, |this| {
                    this.track_focus(&self.focus)
                        .focus_visible(|style| style.shadow(focus_ring(&colors)))
                })
                .when(!on, |this| {
                    this.hover(|style| style.bg(colors.hover).border_color(colors.edge))
                })
                .on_click(move |_, _, cx| fleet.update(cx, |fleet, cx| fleet.select(index, cx)))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::S2))
                        .whitespace_nowrap()
                        .child(StatusMark::new(shape, tone))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_role(TextRole::Label)
                                .when(on, |this| this.font_weight(gpui::FontWeight::SEMIBOLD))
                                .child(view.name.clone()),
                        )
                        .child(
                            div()
                                .flex_none()
                                .text_role(TextRole::Body)
                                .font_features(tabular())
                                .text_color(word_color)
                                .child(word),
                        ),
                )
                .child(
                    div()
                        .pl(px(size::MARK + space::S2))
                        .min_w_0()
                        .truncate()
                        .text_role(TextRole::Body)
                        .text_color(colors.text_secondary)
                        .group_hover("rail-row", |style| style.text_color(colors.text))
                        .child(detail),
                )
        });
        let footer = match self.adding.clone() {
            Some(field) => div()
                .flex()
                .flex_col()
                .gap(px(space::S2))
                .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                    match event.keystroke.key.as_str() {
                        "enter" => this.submit(cx),
                        "escape" => {
                            this.adding = None;
                            cx.notify();
                        }
                        _ => {}
                    }
                }))
                .child(
                    div()
                        .text_role(TextRole::Body)
                        .text_color(colors.text_secondary)
                        .child("Controller URL, Enter adds, Esc cancels"),
                )
                .child(field)
                .into_any_element(),
            None => Button::new("rail-add", "Add controller\u{2026}")
                .on_click(cx.listener(|this, _, window, cx| this.open_form(window, cx)))
                .into_any_element(),
        };
        let menu = self
            .menu
            .clone()
            .map(|focus| self.menu_popover(&focus, window, cx));
        div()
            .id("rail")
            .role(Role::List)
            .aria_label("Controllers")
            .relative()
            .w(px(size::RAIL))
            .flex_none()
            .h_full()
            .p(px(space::S2))
            .flex()
            .flex_col()
            .gap(px(space::S1))
            .bg(colors.surface)
            .border_r_1()
            .border_color(colors.frame)
            .on_key_down(cx.listener(Self::keys))
            .child(
                div()
                    .h(px(size::CONTROL))
                    .flex()
                    .items_center()
                    .justify_between()
                    .pl(px(space::S3))
                    .text_role(TextRole::Label)
                    .child("Controllers")
                    .when(IN_APP_MENU, |this| {
                        this.child(
                            div()
                                .id("menu-button")
                                .group("menu-button")
                                .role(Role::Button)
                                .aria_label("Menu")
                                .aria_expanded(self.menu.is_some())
                                .tab_index(0)
                                .size(px(size::CONTROL))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(px(radius::CONTROL))
                                .cursor_pointer()
                                .hover(|style| {
                                    style
                                        .bg(colors.hover)
                                        .shadow(ring(colors.edge, HAIRLINE, true))
                                })
                                .focus_visible(|style| style.shadow(focus_ring(&colors)))
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.toggle_menu(window, cx)),
                                )
                                .child(
                                    svg()
                                        .path("icons/menu.svg")
                                        .size(px(size::ICON))
                                        .text_color(colors.text_secondary)
                                        .group_hover("menu-button", move |style| {
                                            style.text_color(colors.text)
                                        }),
                                ),
                        )
                    }),
            )
            .children(rows)
            .child(div().pt(px(space::S1)).child(footer))
            .children(menu)
    }
}
