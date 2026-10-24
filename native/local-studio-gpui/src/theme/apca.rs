use gpui::{Hsla, Rgba};

use super::{Appearance, Colors, colors};

pub struct ContrastFailure {
    pub pair: &'static str,
    pub appearance: Appearance,
    pub lc: f32,
    pub floor: f32,
}

fn channel(value: f32) -> f32 {
    value.clamp(0., 1.).powf(2.4)
}

fn luminance(color: Hsla) -> f32 {
    let Rgba { r, g, b, .. } = color.to_rgb();
    0.212_672_9 * channel(r) + 0.715_152_2 * channel(g) + 0.072_175 * channel(b)
}

fn soft_clamp(y: f32) -> f32 {
    if y >= 0.022 {
        y
    } else {
        y + (0.022 - y).powf(1.414)
    }
}

pub fn lc(text: Hsla, background: Hsla) -> f32 {
    let text_y = soft_clamp(luminance(text));
    let background_y = soft_clamp(luminance(background));
    if (background_y - text_y).abs() < 0.0005 {
        return 0.;
    }
    let contrast = if background_y > text_y {
        let s = (background_y.powf(0.56) - text_y.powf(0.57)) * 1.14;
        if s < 0.1 { 0. } else { s - 0.027 }
    } else {
        let s = (background_y.powf(0.65) - text_y.powf(0.62)) * 1.14;
        if s > -0.1 { 0. } else { s + 0.027 }
    };
    (contrast * 100.).abs()
}

fn pairs(c: &Colors) -> Vec<(&'static str, Hsla, f32)> {
    vec![
        ("text", c.text, 90.),
        ("text_secondary", c.text_secondary, 75.),
        ("text_disabled", c.text_disabled, 45.),
        ("edge", c.edge, 45.),
        ("edge_hover", c.edge_hover, 45.),
        ("focus", c.focus, 60.),
        ("ok.text", c.ok.text, 75.),
        ("ok.mark", c.ok.mark, 45.),
        ("warn.text", c.warn.text, 75.),
        ("warn.mark", c.warn.mark, 45.),
        ("err.text", c.err.text, 75.),
        ("err.mark", c.err.mark, 45.),
        ("info.text", c.info.text, 75.),
        ("info.mark", c.info.mark, 45.),
        ("series[0].line", c.series[0].line, 45.),
        ("series[0].label", c.series[0].label, 75.),
        ("series[1].line", c.series[1].line, 45.),
        ("series[1].label", c.series[1].label, 75.),
    ]
}

fn fills(c: &Colors) -> [(&'static str, Hsla, Hsla, f32); 4] {
    [
        ("accent.rest", c.accent.text, c.accent.rest, 90.),
        ("accent.hover", c.accent.text, c.accent.hover, 90.),
        ("danger.rest", c.danger.text, c.danger.rest, 75.),
        ("danger.hover", c.danger.text, c.danger.hover, 75.),
    ]
}

fn interactions(c: &Colors) -> [(&'static str, f32, f32); 4] {
    [
        (
            "accent hover",
            lc(c.accent.text, c.accent.rest),
            lc(c.accent.text, c.accent.hover),
        ),
        (
            "danger hover",
            lc(c.danger.text, c.danger.rest),
            lc(c.danger.text, c.danger.hover),
        ),
        (
            "destructive hover",
            lc(c.err.text, c.surface),
            lc(c.danger.text, c.danger.rest),
        ),
        (
            "row hover",
            lc(c.text_secondary, c.surface),
            lc(c.text, c.hover),
        ),
    ]
}

pub fn audit() -> Vec<ContrastFailure> {
    let mut failures = Vec::new();
    for appearance in [Appearance::Dark, Appearance::Light] {
        let c = colors(appearance);
        let surfaces = [c.page, c.surface, c.hover, c.selected];
        for (pair, foreground, floor) in pairs(&c) {
            let worst = surfaces
                .iter()
                .map(|surface| lc(foreground, *surface))
                .fold(f32::INFINITY, f32::min);
            if worst < floor {
                failures.push(ContrastFailure {
                    pair,
                    appearance,
                    lc: worst,
                    floor,
                });
            }
        }
        for (pair, text, fill, floor) in fills(&c) {
            let value = lc(text, fill);
            if value < floor {
                failures.push(ContrastFailure {
                    pair,
                    appearance,
                    lc: value,
                    floor,
                });
            }
        }
        for (pair, rest, hover) in interactions(&c) {
            if hover < rest {
                failures.push(ContrastFailure {
                    pair,
                    appearance,
                    lc: hover,
                    floor: rest,
                });
            }
        }
    }
    failures
}
