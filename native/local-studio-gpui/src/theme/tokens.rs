use gpui::{Hsla, rgb};

use super::Appearance;

#[derive(Clone, Copy, Debug)]
pub struct Tone {
    pub text: Hsla,
    pub mark: Hsla,
}

#[derive(Clone, Copy, Debug)]
pub struct Series {
    pub line: Hsla,
    pub label: Hsla,
    pub dash: Option<[f32; 2]>,
}

#[derive(Clone, Copy, Debug)]
pub struct Fill {
    pub rest: Hsla,
    pub hover: Hsla,
    pub text: Hsla,
}

#[derive(Clone, Copy, Debug)]
pub struct Colors {
    pub page: Hsla,
    pub surface: Hsla,
    pub hover: Hsla,
    pub selected: Hsla,
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub text_disabled: Hsla,
    pub edge: Hsla,
    pub edge_hover: Hsla,
    pub focus: Hsla,
    pub divider: Hsla,
    pub frame: Hsla,
    pub accent: Fill,
    pub danger: Fill,
    pub ok: Tone,
    pub warn: Tone,
    pub err: Tone,
    pub info: Tone,
    pub series: [Series; 2],
}

fn hex(value: u32) -> Hsla {
    rgb(value).into()
}

pub fn colors(appearance: Appearance) -> Colors {
    match appearance {
        Appearance::Dark => dark(),
        Appearance::Light => light(),
    }
}

fn dark() -> Colors {
    Colors {
        page: hex(0x0e0e0e),
        surface: hex(0x161616),
        hover: hex(0x212121),
        selected: hex(0x2b2b2b),
        text: hex(0xf2f2f2),
        text_secondary: hex(0xd6d6d6),
        text_disabled: hex(0xa3a3a3),
        edge: hex(0x9e9e9e),
        edge_hover: hex(0xbdbdbd),
        focus: hex(0xd2e9ff),
        divider: hex(0x5c5c5c),
        frame: hex(0x767676),
        accent: Fill {
            rest: hex(0xd2e9ff),
            hover: hex(0xe0f0ff),
            text: hex(0x0e0e0e),
        },
        danger: Fill {
            rest: hex(0xfac5c5),
            hover: hex(0xffdede),
            text: hex(0x0e0e0e),
        },
        ok: Tone {
            text: hex(0x98e1c9),
            mark: hex(0x10b981),
        },
        warn: Tone {
            text: hex(0xfacb7b),
            mark: hex(0xf59e0b),
        },
        err: Tone {
            text: hex(0xfac5c5),
            mark: hex(0xf37575),
        },
        info: Tone {
            text: hex(0xbcd4fc),
            mark: hex(0x669ef8),
        },
        series: [
            Series {
                line: hex(0x56b4e9),
                label: hex(0xa9d9f4),
                dash: None,
            },
            Series {
                line: hex(0xe69f00),
                label: hex(0xf2ce7d),
                dash: Some([6., 4.]),
            },
        ],
    }
}

fn light() -> Colors {
    Colors {
        page: hex(0xfafafa),
        surface: hex(0xffffff),
        hover: hex(0xf2f2f3),
        selected: hex(0xe8e8ea),
        text: hex(0x171717),
        text_secondary: hex(0x4e4e4e),
        text_disabled: hex(0x808080),
        edge: hex(0x808080),
        edge_hover: hex(0x4e4e4e),
        focus: hex(0x173ea8),
        divider: hex(0xc4c4c4),
        frame: hex(0xc4c4c4),
        accent: Fill {
            rest: hex(0x173ea8),
            hover: hex(0x12307f),
            text: hex(0xffffff),
        },
        danger: Fill {
            rest: hex(0x991b1b),
            hover: hex(0x7f1d1d),
            text: hex(0xffffff),
        },
        ok: Tone {
            text: hex(0x08573d),
            mark: hex(0x087f59),
        },
        warn: Tone {
            text: hex(0x6c4605),
            mark: hex(0xc68009),
        },
        err: Tone {
            text: hex(0x8b2727),
            mark: hex(0xef4444),
        },
        info: Tone {
            text: hex(0x224b8f),
            mark: hex(0x3b82f6),
        },
        series: [
            Series {
                line: hex(0x4897c4),
                label: hex(0x275169),
                dash: None,
            },
            Series {
                line: hex(0xbf8400),
                label: hex(0x674800),
                dash: Some([6., 4.]),
            },
        ],
    }
}
