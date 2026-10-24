use gpui::{
    App, BorderStyle, Bounds, Corners, Hsla, IntoElement, PathBuilder, Pixels, RenderOnce,
    SharedString, Window, canvas, div, point, prelude::*, px, quad, size as dims,
    transparent_black,
};

use crate::model::Status;
use crate::theme::{ActiveTheme, Colors, TextRole, TextRoleExt, size, space, tabular};

const STROKE: f32 = 2.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarkShape {
    Filled,
    Ring,
    Half,
    Cross,
    Square,
    Triangle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToneKind {
    Ok,
    Warn,
    Err,
    Info,
    Neutral,
}

impl ToneKind {
    pub fn mark(self, colors: &Colors) -> Hsla {
        match self {
            ToneKind::Ok => colors.ok.mark,
            ToneKind::Warn => colors.warn.mark,
            ToneKind::Err => colors.err.mark,
            ToneKind::Info => colors.info.mark,
            ToneKind::Neutral => colors.text_secondary,
        }
    }

    pub fn text(self, colors: &Colors) -> Hsla {
        match self {
            ToneKind::Ok => colors.ok.text,
            ToneKind::Warn => colors.warn.text,
            ToneKind::Err => colors.err.text,
            ToneKind::Info => colors.info.text,
            ToneKind::Neutral => colors.text_secondary,
        }
    }
}

#[derive(IntoElement)]
pub struct StatusMark {
    status: MarkShape,
    tone: ToneKind,
    size: f32,
}

impl StatusMark {
    pub fn new(status: MarkShape, tone: ToneKind) -> Self {
        StatusMark {
            status,
            tone,
            size: size::MARK,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }
}

pub fn status_parts(status: &Status) -> (MarkShape, ToneKind, SharedString) {
    match status {
        Status::Running => (MarkShape::Filled, ToneKind::Ok, "Running".into()),
        Status::Idle => (MarkShape::Ring, ToneKind::Neutral, "Idle".into()),
        Status::Loading {
            percent: Some(percent),
        } => (
            MarkShape::Half,
            ToneKind::Info,
            format!("Loading {percent}\u{00a0}%").into(),
        ),
        Status::Loading { percent: None } => (MarkShape::Half, ToneKind::Info, "Loading".into()),
        Status::Failed { .. } => (MarkShape::Cross, ToneKind::Err, "Failed".into()),
        Status::Offline { .. } => (MarkShape::Square, ToneKind::Err, "Offline".into()),
        Status::NeedsKey => (
            MarkShape::Triangle,
            ToneKind::Warn,
            "Needs fleet key".into(),
        ),
    }
}

fn paint_mark(shape: MarkShape, color: Hsla, bounds: Bounds<Pixels>, window: &mut Window) {
    let full = bounds.size.width / 2.;
    let stroke = px(STROKE);
    let clear = transparent_black();
    let solid = BorderStyle::Solid;
    match shape {
        MarkShape::Filled => window.paint_quad(quad(bounds, full, color, px(0.), clear, solid)),
        MarkShape::Ring => window.paint_quad(quad(bounds, full, clear, stroke, color, solid)),
        MarkShape::Square => window.paint_quad(quad(bounds, px(0.), clear, stroke, color, solid)),
        MarkShape::Half => {
            window.paint_quad(quad(bounds, full, clear, stroke, color, solid));
            let left = Bounds::new(bounds.origin, dims(full, bounds.size.height));
            let corners = Corners {
                top_left: full,
                bottom_left: full,
                top_right: px(0.),
                bottom_right: px(0.),
            };
            window.paint_quad(quad(left, corners, color, px(0.), clear, solid));
        }
        MarkShape::Cross => {
            let mut path = PathBuilder::stroke(stroke);
            path.move_to(bounds.origin);
            path.line_to(bounds.bottom_right());
            path.move_to(bounds.top_right());
            path.line_to(bounds.bottom_left());
            match path.build() {
                Ok(path) => window.paint_path(path, color),
                Err(error) => eprintln!("cannot draw status mark: {error:#}"),
            }
        }
        MarkShape::Triangle => {
            let mut path = PathBuilder::fill();
            path.add_polygon(
                &[
                    point(bounds.left() + full, bounds.top()),
                    bounds.bottom_right(),
                    bounds.bottom_left(),
                ],
                true,
            );
            match path.build() {
                Ok(path) => window.paint_path(path, color),
                Err(error) => eprintln!("cannot draw status mark: {error:#}"),
            }
        }
    }
}

impl RenderOnce for StatusMark {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = self.tone.mark(&cx.theme().colors);
        let shape = self.status;
        canvas(
            |_, _, _| (),
            move |bounds, _, window, _| paint_mark(shape, color, bounds, window),
        )
        .size(px(self.size))
        .flex_none()
    }
}

#[derive(IntoElement)]
pub struct Badge {
    shape: MarkShape,
    tone: ToneKind,
    word: SharedString,
}

impl Badge {
    pub fn new(shape: MarkShape, tone: ToneKind, word: impl Into<SharedString>) -> Self {
        Badge {
            shape,
            tone,
            word: word.into(),
        }
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = self.tone.text(&cx.theme().colors);
        div()
            .h(px(size::BADGE))
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::S2))
            .whitespace_nowrap()
            .text_role(TextRole::Body)
            .font_features(tabular())
            .text_color(color)
            .child(StatusMark::new(self.shape, self.tone))
            .child(self.word)
    }
}
