use gpui::{
    AnyElement, App, ElementId, IntoElement, ParentElement, RenderOnce, Role, SharedString, Window,
    div, prelude::*, px,
};

use crate::components::HAIRLINE;
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space};

pub const PADDING: f32 = space::S4;

#[derive(IntoElement)]
pub struct Card {
    id: ElementId,
    title: SharedString,
    title_after: Option<AnyElement>,
    subtitle: Option<SharedString>,
    body: Vec<AnyElement>,
}

impl Card {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Card {
            id: id.into(),
            title: title.into(),
            title_after: None,
            subtitle: None,
            body: Vec::new(),
        }
    }

    pub fn after_title(mut self, element: impl IntoElement) -> Self {
        self.title_after = Some(element.into_any_element());
        self
    }

    pub fn subtitle(mut self, subtitle: impl Into<SharedString>) -> Self {
        self.subtitle = Some(subtitle.into());
        self
    }
}

impl ParentElement for Card {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.body.extend(elements);
    }
}

impl RenderOnce for Card {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors;
        div()
            .id(self.id)
            .role(Role::Group)
            .aria_label(self.title.clone())
            .min_w_0()
            .flex()
            .flex_col()
            .p(px(PADDING - HAIRLINE))
            .rounded(px(radius::CARD))
            .border_1()
            .border_color(colors.frame)
            .bg(colors.surface)
            .child(
                div()
                    .h(px(size::ROW))
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(space::S4))
                    .child(
                        div()
                            .id("title")
                            .role(Role::Heading)
                            .aria_level(2)
                            .aria_label(self.title.clone())
                            .whitespace_nowrap()
                            .text_role(TextRole::Title)
                            .text_color(colors.text)
                            .child(self.title),
                    )
                    .children(self.title_after),
            )
            .children(self.subtitle.map(|subtitle| {
                div()
                    .text_role(TextRole::Body)
                    .text_color(colors.text_secondary)
                    .child(subtitle)
            }))
            .children(self.body)
    }
}
