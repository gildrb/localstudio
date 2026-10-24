use chrono::{DateTime, Local};
use gpui::{
    AnyElement, Context, FocusHandle, IntoElement, KeyDownEvent, Role, SharedString, Window, div,
    prelude::*, px, relative,
};

use crate::client::wire::SeriesPoint;
use crate::components::card::Card;
use crate::components::chart::{Plot, nice_max};
use crate::components::focus_ring;
use crate::components::segmented::{Segment, Segmented};
use crate::format::{self, NBSP, UNKNOWN};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space, tabular};

const PLOT_HEIGHT: f32 = 96.;
const GUTTER: f32 = 48.;
const END_LABEL: f32 = 56.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Range24 {
    Day,
    SixHours,
    Hour,
}

impl Range24 {
    const ALL: [Range24; 3] = [Range24::Day, Range24::SixHours, Range24::Hour];

    fn seconds(self) -> f64 {
        match self {
            Range24::Day => 86_400.,
            Range24::SixHours => 21_600.,
            Range24::Hour => 3_600.,
        }
    }

    fn label(self) -> String {
        let hours = match self {
            Range24::Day => 24,
            Range24::SixHours => 6,
            Range24::Hour => 1,
        };
        format!("{hours}{NBSP}h")
    }
}

struct Sample {
    at: DateTime<Local>,
    x: f64,
    values: [f64; 2],
}

const NAMES: [&str; 2] = ["Decode", "Prefill"];

pub struct Throughput {
    range: Range24,
    cursor: Option<usize>,
    count: usize,
    focus: FocusHandle,
}

impl Throughput {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Throughput {
            range: Range24::Day,
            cursor: None,
            count: 0,
            focus: cx.focus_handle().tab_stop(true),
        }
    }

    fn keys(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Some(last) = self.count.checked_sub(1) else {
            return;
        };
        let current = self.cursor.unwrap_or(last);
        self.cursor = match event.keystroke.key.as_str() {
            "left" => Some(current.saturating_sub(1)),
            "right" if current < last => Some(current + 1),
            "right" | "escape" => None,
            "home" => Some(0),
            "end" => None,
            _ => return,
        };
        cx.stop_propagation();
        cx.notify();
    }

    fn plot(
        &self,
        index: usize,
        samples: &[Sample],
        domain: (f64, f64),
        cx: &gpui::App,
    ) -> AnyElement {
        let series = cx.theme().colors.series[index];
        let secondary = cx.theme().colors.text_secondary;
        let name = NAMES[index];
        let peak = samples.iter().map(|s| s.values[index]).fold(0., f64::max);
        let max = nice_max(peak);
        let shown = self.cursor.and_then(|i| samples.get(i)).or(samples.last());
        let value = shown.map(|s| s.values[index]);
        let value_text = value.map_or_else(|| UNKNOWN.to_string(), format::rate);
        let spoken = format!(
            "{name}, last {}, peak {}, shown {value_text}",
            self.range.label(),
            format::rate(peak)
        );
        let step = samples
            .windows(2)
            .map(|pair| pair[1].x - pair[0].x)
            .filter(|dx| *dx > 0.)
            .fold(f64::INFINITY, f64::min);
        let mut points = Vec::with_capacity(samples.len());
        for (i, sample) in samples.iter().enumerate() {
            if i > 0 && sample.x - samples[i - 1].x > 2. * step {
                points.push((sample.x, None));
            }
            points.push((sample.x, Some(sample.values[index])));
        }
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(size::ROW))
                    .pl(px(GUTTER + space::S2))
                    .flex()
                    .items_center()
                    .text_role(TextRole::Label)
                    .text_color(series.label)
                    .child(format!("{name}, tok/s")),
            )
            .child(
                div()
                    .h(px(PLOT_HEIGHT))
                    .flex()
                    .gap(px(space::S2))
                    .child(
                        div()
                            .w(px(GUTTER))
                            .flex_none()
                            .flex()
                            .flex_col()
                            .justify_between()
                            .items_end()
                            .text_role(TextRole::Body)
                            .text_color(secondary)
                            .child(format::compact(max))
                            .child("0"),
                    )
                    .child(div().flex_1().min_w_0().h_full().child(Plot {
                        id: ("plot", index).into(),
                        series: index,
                        points,
                        domain,
                        max,
                        cursor: self.cursor.and_then(|i| samples.get(i)).map(|s| s.x),
                        spoken: spoken.into(),
                    }))
                    .child(
                        div()
                            .w(px(END_LABEL))
                            .flex_none()
                            .text_role(TextRole::Label)
                            .text_color(series.label)
                            .whitespace_nowrap()
                            .child(value.map_or_else(|| UNKNOWN.to_string(), format::compact)),
                    ),
            )
            .into_any_element()
    }

    fn ticks(&self, start: f64, end: f64) -> Vec<(f32, String)> {
        let step = match self.range {
            Range24::Day => 21_600.,
            Range24::SixHours => 3_600.,
            Range24::Hour => 900.,
        };
        let offset = DateTime::from_timestamp(end as i64, 0).map_or(0., |at| {
            f64::from(at.with_timezone(&Local).offset().local_minus_utc())
        });
        let span = (end - start).max(f64::EPSILON);
        let mut at = ((start + offset) / step).ceil() * step - offset;
        let mut ticks = Vec::new();
        while at <= end {
            if let Some(time) = DateTime::from_timestamp(at as i64, 0) {
                let label = time.with_timezone(&Local).format("%H:%M").to_string();
                ticks.push((((at - start) / span) as f32, label));
            }
            at += step;
        }
        ticks
    }

    pub fn render_card(
        &mut self,
        series: &[SeriesPoint],
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let colors = cx.theme().colors;
        let points: Vec<(DateTime<Local>, f64, f64)> = series
            .iter()
            .filter_map(|point| {
                DateTime::parse_from_rfc3339(&point.at).ok().map(|at| {
                    (
                        at.with_timezone(&Local),
                        point.decode_tps,
                        point.prefill_tps,
                    )
                })
            })
            .collect();
        let end = points.last().map_or(0., |(at, _, _)| at.timestamp() as f64);
        let start = end - self.range.seconds();
        let samples: Vec<Sample> = points
            .into_iter()
            .map(|(at, decode, prefill)| Sample {
                at,
                x: at.timestamp() as f64,
                values: [decode, prefill],
            })
            .filter(|sample| sample.x >= start)
            .collect();
        self.count = samples.len();
        self.cursor = self.cursor.filter(|i| *i < samples.len());
        let readout = match (self.cursor.and_then(|i| samples.get(i)), samples.is_empty()) {
            (Some(s), _) => format!(
                "{}, Decode {}, Prefill {}",
                s.at.format("%H:%M"),
                format::rate(s.values[0]),
                format::rate(s.values[1])
            ),
            (None, true) => "No samples in this range.".to_string(),
            (None, false) => "Left and Right inspect a time.".to_string(),
        };
        let domain = (start, end);
        let ticks = self.ticks(start, end);
        let selected = self.range;
        let entity = cx.entity();
        let segments = Range24::ALL
            .iter()
            .map(|range| Segment {
                label: range.label().into(),
                count: None,
                on: *range == selected,
            })
            .collect();
        let toggle = Segmented::new("range", segments, false, move |index, _, cx| {
            entity.update(cx, |this, cx| {
                this.range = Range24::ALL[index];
                this.cursor = None;
                cx.notify();
            });
        });
        let title = format!("Throughput, last {}", self.range.label());
        let body = div()
            .id("throughput-chart")
            .role(Role::Group)
            .aria_label(SharedString::from(readout.clone()))
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::keys))
            .rounded(px(radius::CONTROL))
            .focus_visible(|style| style.shadow(focus_ring(&colors)))
            .font_features(tabular())
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(size::ROW))
                    .flex()
                    .items_center()
                    .whitespace_nowrap()
                    .text_role(TextRole::Body)
                    .text_color(colors.text_secondary)
                    .child(readout),
            );
        if samples.is_empty() {
            return Card::new("throughput", title)
                .after_title(toggle)
                .child(body)
                .into_any_element();
        }
        Card::new("throughput", title)
            .after_title(toggle)
            .child(
                body.child(self.plot(0, &samples, domain, cx))
                    .child(div().h(px(space::S6)))
                    .child(self.plot(1, &samples, domain, cx))
                    .child(
                        div()
                            .h(px(size::ROW))
                            .ml(px(GUTTER + space::S2))
                            .mr(px(END_LABEL + space::S2))
                            .relative()
                            .text_role(TextRole::Body)
                            .text_color(colors.text_secondary)
                            .children(ticks.into_iter().map(|(fraction, label)| {
                                div()
                                    .absolute()
                                    .top_0()
                                    .left(relative(fraction))
                                    .w(px(0.))
                                    .h_full()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(div().flex_none().whitespace_nowrap().child(label))
                            })),
                    ),
            )
            .into_any_element()
    }
}
