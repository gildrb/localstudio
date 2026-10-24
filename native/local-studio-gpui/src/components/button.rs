use gpui::{
    App, ClickEvent, ElementId, IntoElement, RenderOnce, Role, SharedString, Window, div,
    prelude::*, px,
};

use crate::components::focus_ring;
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ButtonKind {
    Outline,
    Primary,
    Destructive,
    DangerConfirm,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Inset {
    Free,
    InRow,
}

type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: SharedString,
    kind: ButtonKind,
    hint: Option<SharedString>,
    inset: Inset,
    on_click: Option<ClickHandler>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Button {
            id: id.into(),
            label: label.into(),
            kind: ButtonKind::Outline,
            hint: None,
            inset: Inset::Free,
            on_click: None,
        }
    }

    pub fn kind(mut self, kind: ButtonKind) -> Self {
        self.kind = kind;
        self
    }

    pub fn hint(mut self, hint: Option<SharedString>) -> Self {
        self.hint = hint;
        self
    }

    pub fn in_row(mut self) -> Self {
        self.inset = Inset::InRow;
        self
    }

    pub fn on_click(mut self, f: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Box::new(f));
        self
    }
}

impl RenderOnce for Button {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = cx.theme().colors;
        let corner = match self.inset {
            Inset::Free => radius::CONTROL,
            Inset::InRow => radius::nested(radius::CONTROL, space::S1),
        };
        let (bg, edge, fg, hover_bg, hover_fg, press_bg) = match self.kind {
            ButtonKind::Outline => (c.surface, c.edge, c.text, c.hover, c.text, c.selected),
            ButtonKind::Primary => (
                c.accent.rest,
                c.accent.rest,
                c.accent.text,
                c.accent.hover,
                c.accent.text,
                c.accent.hover,
            ),
            ButtonKind::Destructive => (
                c.surface,
                c.err.mark,
                c.err.text,
                c.danger.rest,
                c.danger.text,
                c.danger.hover,
            ),
            ButtonKind::DangerConfirm => (
                c.danger.rest,
                c.danger.rest,
                c.danger.text,
                c.danger.hover,
                c.danger.text,
                c.danger.hover,
            ),
        };
        let hover_edge = match self.kind {
            ButtonKind::Outline => c.edge_hover,
            ButtonKind::Primary | ButtonKind::Destructive | ButtonKind::DangerConfirm => hover_bg,
        };
        let button = div()
            .id(self.id)
            .role(Role::Button)
            .aria_label(self.label.clone())
            .tab_index(0)
            .h(px(size::CONTROL))
            .px(px(space::S3))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(space::S2))
            .whitespace_nowrap()
            .rounded(px(corner))
            .border_1()
            .border_color(edge)
            .bg(bg)
            .text_color(fg)
            .text_role(TextRole::Label)
            .focus_visible(|style| style.shadow(focus_ring(&c)))
            .when_some(self.hint.clone(), |this, hint| this.aria_keyshortcuts(hint))
            .child(self.label)
            .when_some(self.hint, |this, hint| {
                this.child(div().text_role(TextRole::Caption).child(hint))
            });
        match self.on_click {
            Some(on_click) => button
                .cursor_pointer()
                .hover(move |style| {
                    style
                        .bg(hover_bg)
                        .border_color(hover_edge)
                        .text_color(hover_fg)
                })
                .active(move |style| style.bg(press_bg).border_color(c.edge_hover))
                .on_click(on_click),
            None => button,
        }
    }
}
