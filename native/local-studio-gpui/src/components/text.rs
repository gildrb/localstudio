use gpui::{
    App, Div, ElementId, IntoElement, RenderOnce, Role, SharedString, Window, div, prelude::*, px,
};

use crate::components::status_mark::{MarkShape, StatusMark, ToneKind};
use crate::components::table::ROW_GROUP;
use crate::model::{Level, Metric};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, size, space, tabular};

pub const GROUP_WIDTH: f32 = 96.;
pub const NAME_WIDTH: f32 = 88.;
pub const VALUE_WIDTH: f32 = 120.;

pub fn value(text: impl Into<SharedString>, cx: &App) -> Div {
    div()
        .flex_none()
        .whitespace_nowrap()
        .text_role(TextRole::Label)
        .font_features(tabular())
        .text_color(cx.theme().colors.text)
        .child(text.into())
}

pub fn context(text: impl Into<SharedString>, cx: &App) -> Div {
    let colors = cx.theme().colors;
    let strong = colors.text;
    div()
        .min_w_0()
        .truncate()
        .text_role(TextRole::Body)
        .text_color(colors.text_secondary)
        .group_hover(ROW_GROUP, move |style| style.text_color(strong))
        .child(text.into())
}

#[derive(IntoElement)]
pub struct MetricRow {
    id: ElementId,
    group: Option<SharedString>,
    name: SharedString,
    metric: Metric,
}

impl MetricRow {
    pub fn new(id: impl Into<ElementId>, name: impl Into<SharedString>, metric: Metric) -> Self {
        MetricRow {
            id: id.into(),
            group: None,
            name: name.into(),
            metric,
        }
    }

    pub fn group(mut self, group: impl Into<SharedString>) -> Self {
        self.group = Some(group.into());
        self
    }
}

impl RenderOnce for MetricRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors;
        let label = format!("{}, {}", self.name, self.metric.spoken);
        let note = match self.metric.level {
            Level::Normal => context(self.metric.context, cx),
            Level::High => div()
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(space::S2))
                .text_role(TextRole::Body)
                .text_color(colors.warn.text)
                .child(StatusMark::new(MarkShape::Triangle, ToneKind::Warn))
                .child(div().truncate().child(self.metric.context)),
        };
        div()
            .id(self.id)
            .role(Role::Row)
            .aria_label(label)
            .h(px(size::ROW))
            .px(px(space::S2))
            .flex()
            .items_center()
            .child(
                div()
                    .w(px(GROUP_WIDTH))
                    .flex_none()
                    .text_role(TextRole::Label)
                    .text_color(colors.text)
                    .children(self.group),
            )
            .child(
                div()
                    .w(px(NAME_WIDTH))
                    .flex_none()
                    .text_role(TextRole::Body)
                    .text_color(colors.text_secondary)
                    .child(self.name),
            )
            .child(
                div()
                    .w(px(VALUE_WIDTH))
                    .flex_none()
                    .flex()
                    .justify_end()
                    .child(value(self.metric.value, cx)),
            )
            .child(div().flex_1().min_w_0().pl(px(space::S4)).child(note))
    }
}
