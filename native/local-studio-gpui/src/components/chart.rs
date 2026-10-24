use gpui::{
    App, Bounds, ElementId, IntoElement, PathBuilder, Pixels, RenderOnce, Role, SharedString,
    Window, canvas, div, fill, point, prelude::*, px, size,
};

use crate::components::HAIRLINE;
use crate::theme::ActiveTheme;

const LINE_WIDTH: f32 = 2.;

#[derive(IntoElement)]
pub struct Plot {
    pub id: ElementId,
    pub series: usize,
    pub points: Vec<(f64, Option<f64>)>,
    pub domain: (f64, f64),
    pub max: f64,
    pub cursor: Option<f64>,
    pub spoken: SharedString,
}

pub fn nice_max(v: f64) -> f64 {
    if !v.is_finite() || v <= 0. {
        return 1.;
    }
    let magnitude = 10f64.powf(v.log10().floor());
    let step = [1., 2., 5., 10.]
        .into_iter()
        .find(|step| step * magnitude >= v)
        .unwrap_or(10.);
    step * magnitude
}

fn rule(bounds: Bounds<Pixels>, y: Pixels) -> Bounds<Pixels> {
    Bounds::new(
        point(bounds.left(), y),
        size(bounds.size.width, px(HAIRLINE)),
    )
}

impl RenderOnce for Plot {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors;
        let series = colors.series[self.series.min(1)];
        let points = self.points;
        let (low, high) = self.domain;
        let max = self.max;
        let cursor = self.cursor;
        div()
            .id(self.id)
            .role(Role::Image)
            .aria_label(self.spoken)
            .size_full()
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, _, window, _| {
                        window.paint_quad(fill(rule(bounds, bounds.top()), colors.divider));
                        window.paint_quad(fill(
                            rule(bounds, bounds.bottom() - px(HAIRLINE)),
                            colors.divider,
                        ));
                        let span = (high - low).max(f64::EPSILON);
                        let x_of = |x: f64| {
                            bounds.left() + bounds.size.width * (((x - low) / span) as f32)
                        };
                        if let Some(at) = cursor {
                            window.paint_quad(fill(
                                Bounds::new(
                                    point(x_of(at), bounds.top()),
                                    size(px(HAIRLINE), bounds.size.height),
                                ),
                                colors.text_secondary,
                            ));
                        }
                        let mut builder = match series.dash {
                            Some([on, off]) => {
                                PathBuilder::stroke(px(LINE_WIDTH)).dash_array(&[px(on), px(off)])
                            }
                            None => PathBuilder::stroke(px(LINE_WIDTH)),
                        };
                        let mut pen_down = false;
                        for (x, y) in &points {
                            let Some(y) = y else {
                                pen_down = false;
                                continue;
                            };
                            let at = point(
                                x_of(*x),
                                bounds.bottom() - bounds.size.height * ((y / max) as f32),
                            );
                            if pen_down {
                                builder.line_to(at);
                            } else {
                                builder.move_to(at);
                                pen_down = true;
                            }
                        }
                        match builder.build() {
                            Ok(path) => window.paint_path(path, series.line),
                            Err(error) => eprintln!("cannot draw chart line: {error:#}"),
                        }
                    },
                )
                .size_full(),
            )
    }
}
