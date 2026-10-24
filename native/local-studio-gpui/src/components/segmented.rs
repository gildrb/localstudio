use std::rc::Rc;

use gpui::{
    App, ElementId, FontWeight, IntoElement, RenderOnce, Role, SharedString, Toggled, Window, div,
    prelude::*, px, svg,
};

use crate::components::{HAIRLINE, focus_ring};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space, tabular};

const SEGMENT_INSET: f32 = 2.;

#[derive(Clone, Debug)]
pub struct Segment {
    pub label: SharedString,
    pub count: Option<usize>,
    pub on: bool,
}

type Toggle = Rc<dyn Fn(usize, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Segmented {
    id: ElementId,
    segments: Vec<Segment>,
    multi: bool,
    on_toggle: Toggle,
}

impl Segmented {
    pub fn new(
        id: impl Into<ElementId>,
        segments: Vec<Segment>,
        multi: bool,
        on_toggle: impl Fn(usize, &mut Window, &mut App) + 'static,
    ) -> Self {
        Segmented {
            id: id.into(),
            segments,
            multi,
            on_toggle: Rc::new(on_toggle),
        }
    }
}

impl RenderOnce for Segmented {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = cx.theme().colors;
        let role = if self.multi {
            Role::Switch
        } else {
            Role::RadioButton
        };
        div()
            .id(self.id)
            .role(Role::Group)
            .h(px(size::CONTROL))
            .p(px(SEGMENT_INSET - HAIRLINE))
            .flex()
            .flex_none()
            .rounded(px(radius::CONTROL))
            .border_1()
            .border_color(c.edge)
            .children(
                self.segments
                    .into_iter()
                    .enumerate()
                    .map(|(index, segment)| {
                        let on_toggle = self.on_toggle.clone();
                        let label = match segment.count {
                            Some(count) => format!("{}, {count}", segment.label),
                            None => segment.label.to_string(),
                        };
                        div()
                            .id(index)
                            .role(role)
                            .aria_label(label)
                            .aria_toggled(if segment.on {
                                Toggled::True
                            } else {
                                Toggled::False
                            })
                            .tab_index(0)
                            .h_full()
                            .px(px(space::S2))
                            .flex()
                            .items_center()
                            .gap(px(space::S2))
                            .whitespace_nowrap()
                            .cursor_pointer()
                            .rounded(px(radius::nested(radius::CONTROL, SEGMENT_INSET)))
                            .text_role(TextRole::Label)
                            .text_color(c.text_secondary)
                            .when(segment.on, |this| {
                                this.bg(c.selected)
                                    .text_color(c.text)
                                    .font_weight(FontWeight::SEMIBOLD)
                            })
                            .when(!segment.on, |this| {
                                this.hover(|style| style.bg(c.hover).text_color(c.text))
                            })
                            .active(|style| style.bg(c.selected).text_color(c.text))
                            .focus_visible(|style| style.shadow(focus_ring(&c)))
                            .on_click(move |_, window, cx| on_toggle(index, window, cx))
                            .when(self.multi && segment.on, |this| {
                                this.child(
                                    svg()
                                        .path("icons/check.svg")
                                        .size(px(size::ICON))
                                        .text_color(c.text),
                                )
                            })
                            .child(segment.label)
                            .children(segment.count.map(|count| {
                                div()
                                    .text_role(TextRole::Caption)
                                    .font_features(tabular())
                                    .text_color(if segment.on { c.text } else { c.text_secondary })
                                    .child(count.to_string())
                            }))
                    }),
            )
    }
}
