use std::rc::Rc;

use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, IntoElement, RenderOnce, Role, SharedString,
    Window, div, prelude::*, px,
};

use crate::components::{HAIRLINE, ring};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space, tabular};

pub const ROW_GROUP: &str = "row";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Start,
    End,
}

#[derive(Clone, Debug)]
pub struct Column {
    pub title: SharedString,
    pub width: Option<f32>,
    pub align: Align,
    pub numeric: bool,
}

impl Column {
    pub fn new(title: &'static str, width: Option<f32>, align: Align) -> Self {
        Column {
            title: title.into(),
            width,
            align,
            numeric: align == Align::End,
        }
    }

    pub fn numeric(mut self) -> Self {
        self.numeric = true;
        self
    }
}

fn cell(column: &Column, content: impl IntoElement) -> Div {
    let cell = div()
        .px(px(space::S2))
        .flex()
        .items_center()
        .whitespace_nowrap()
        .when(column.numeric, |this| this.font_features(tabular()));
    let cell = match column.width {
        Some(width) => cell.w(px(width)).flex_none(),
        None => cell.flex_1().min_w_0().overflow_hidden(),
    };
    match column.align {
        Align::Start => cell.justify_start(),
        Align::End => cell.justify_end(),
    }
    .child(content)
}

pub fn table_header(columns: &[Column], cx: &App) -> impl IntoElement {
    let colors = cx.theme().colors;
    div()
        .h(px(size::ROW))
        .flex()
        .flex_none()
        .items_center()
        .border_b(px(HAIRLINE))
        .border_color(colors.divider)
        .text_role(TextRole::Label)
        .text_color(colors.text_secondary)
        .children(
            columns
                .iter()
                .map(|column| cell(column, column.title.clone())),
        )
}

type RowClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Row {
    id: ElementId,
    columns: Rc<[Column]>,
    cells: Vec<AnyElement>,
    height: f32,
    selected: bool,
    label: SharedString,
    on_click: Option<RowClick>,
}

impl Row {
    pub fn new(
        id: impl Into<ElementId>,
        columns: Rc<[Column]>,
        label: impl Into<SharedString>,
    ) -> Self {
        Row {
            id: id.into(),
            columns,
            cells: Vec::new(),
            height: size::ROW,
            selected: false,
            label: label.into(),
            on_click: None,
        }
    }

    pub fn cell(mut self, content: impl IntoElement) -> Self {
        self.cells.push(content.into_any_element());
        self
    }

    pub fn height(mut self, height: f32) -> Self {
        self.height = height;
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn on_click(mut self, f: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Box::new(f));
        self
    }
}

impl RenderOnce for Row {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors;
        let columns = self.columns;
        let row = div()
            .id(self.id)
            .group(ROW_GROUP)
            .role(Role::Row)
            .aria_label(self.label)
            .aria_selected(self.selected)
            .h(px(self.height))
            .w_full()
            .flex()
            .flex_none()
            .items_center()
            .rounded(px(radius::CONTROL))
            .text_role(TextRole::Body)
            .text_color(colors.text)
            .when(self.selected, |this| {
                this.bg(colors.selected)
                    .shadow(ring(colors.edge_hover, HAIRLINE, true))
            })
            .children(
                columns
                    .iter()
                    .zip(self.cells)
                    .map(|(column, content)| cell(column, content)),
            );
        match self.on_click {
            Some(on_click) => row
                .tab_index(0)
                .cursor_pointer()
                .when(!self.selected, |this| {
                    this.hover(|style| {
                        style
                            .bg(colors.hover)
                            .shadow(ring(colors.edge, HAIRLINE, true))
                    })
                })
                .focus_visible(|style| style.shadow(ring(colors.focus, size::FOCUS, true)))
                .on_click(on_click),
            None => row,
        }
    }
}
